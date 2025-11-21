import logger from '../utils/logger.js';
import config from '../config/index.js';

/**
 * Cleric Note Parser
 * Extracts structured data from Cleric's natural language investigation notes
 */

export class ClericParser {
  constructor() {
    // Patterns to extract structured data from Cleric's notes
    this.patterns = {
      // Root cause extraction
      rootCause: /(?:root\s*cause|primary\s*cause|caused\s*by|origin(?:ated)?(?:\s*from)?)[:\s]*([^\n.]+)/i,

      // Confidence level extraction (e.g., "Confidence: 85%", "high confidence", etc.)
      confidencePercent: /confidence[:\s]*(\d+)%/i,
      confidenceLevel: /\b(high|medium|low)\s*confidence/i,

      // Hypothesis extraction
      hypothesis: /(?:hypothesis|analysis|finding|investigation\s*result)[:\s]*([^\n]+(?:\n(?![A-Z][a-z]*:)[^\n]+)*)/i,

      // Affected services
      affectedServices: /(?:affected\s*service|impacted\s*service|service)[s]?[:\s]*([^\n]+)/i,

      // Metrics correlation
      metrics: /(?:correlated?\s*metric|metric\s*correlation|observed\s*metric)[s]?[:\s]*([^\n]+)/i,

      // Recommended action
      recommendation: /(?:recommend(?:ation|ed)?|suggested?\s*action|next\s*step)[s]?[:\s]*([^\n]+)/i,

      // Timeline/duration
      duration: /(?:duration|started|began|first\s*observed)[:\s]*([^\n]+)/i,

      // Error patterns
      errorPattern: /(?:error\s*pattern|exception|stack\s*trace)[:\s]*([^\n]+(?:\n(?![A-Z][a-z]*:)[^\n]+)*)/i,

      // Database/query issues
      sqlIssue: /(?:sql|query|database|db)[:\s]*([^\n]+)/i,

      // Resource issues (CPU, memory, etc.)
      resourceIssue: /(?:cpu|memory|disk|network|resource)[:\s]*([^\n]+)/i,
    };

    // Confidence level mappings
    this.confidenceMappings = {
      high: 90,
      medium: 70,
      low: 40,
    };
  }

  /**
   * Check if a note is from Cleric Agent
   */
  isClericNote(note) {
    if (!note || !note.user) {
      return false;
    }

    const user = note.user;

    // Check by name
    if (user.name && user.name.toLowerCase().includes('cleric')) {
      return true;
    }

    // Check by email
    if (user.email && user.email === config.cleric.agentEmail) {
      return true;
    }

    // Check by summary/display name
    if (user.summary && user.summary.toLowerCase().includes('cleric')) {
      return true;
    }

    // Check by type (could be automation/integration)
    if (user.type === 'user_reference' || user.type === 'service_reference') {
      // Additional checks for integration users
      const name = user.name || user.summary || '';
      return name.toLowerCase().includes('cleric') ||
             name.toLowerCase().includes('ai-investigator');
    }

    return false;
  }

  /**
   * Parse a Cleric note and extract structured data
   */
  parseNote(noteContent) {
    if (!noteContent || typeof noteContent !== 'string') {
      return null;
    }

    const result = {
      raw: noteContent,
      parsed: {},
      confidence: null,
      hypothesis: null,
      rootCause: null,
      affectedServices: [],
      metrics: [],
      recommendation: null,
      errorPattern: null,
      parseSuccess: false,
    };

    try {
      // Extract confidence
      const confidencePercentMatch = noteContent.match(this.patterns.confidencePercent);
      const confidenceLevelMatch = noteContent.match(this.patterns.confidenceLevel);

      if (confidencePercentMatch) {
        result.confidence = parseInt(confidencePercentMatch[1], 10);
      } else if (confidenceLevelMatch) {
        const level = confidenceLevelMatch[1].toLowerCase();
        result.confidence = this.confidenceMappings[level] || 50;
      }

      // Extract root cause
      const rootCauseMatch = noteContent.match(this.patterns.rootCause);
      if (rootCauseMatch) {
        result.rootCause = this._cleanText(rootCauseMatch[1]);
      }

      // Extract hypothesis
      const hypothesisMatch = noteContent.match(this.patterns.hypothesis);
      if (hypothesisMatch) {
        result.hypothesis = this._cleanText(hypothesisMatch[1]);
      }

      // If no explicit hypothesis, use root cause as hypothesis
      if (!result.hypothesis && result.rootCause) {
        result.hypothesis = result.rootCause;
      }

      // Extract affected services
      const servicesMatch = noteContent.match(this.patterns.affectedServices);
      if (servicesMatch) {
        result.affectedServices = this._parseList(servicesMatch[1]);
      }

      // Extract metrics
      const metricsMatch = noteContent.match(this.patterns.metrics);
      if (metricsMatch) {
        result.metrics = this._parseList(metricsMatch[1]);
      }

      // Extract recommendation
      const recommendationMatch = noteContent.match(this.patterns.recommendation);
      if (recommendationMatch) {
        result.recommendation = this._cleanText(recommendationMatch[1]);
      }

      // Extract error pattern
      const errorMatch = noteContent.match(this.patterns.errorPattern);
      if (errorMatch) {
        result.errorPattern = this._cleanText(errorMatch[1]);
      }

      // Extract SQL/query issues
      const sqlMatch = noteContent.match(this.patterns.sqlIssue);
      if (sqlMatch) {
        result.parsed.sqlIssue = this._cleanText(sqlMatch[1]);
      }

      // Extract resource issues
      const resourceMatch = noteContent.match(this.patterns.resourceIssue);
      if (resourceMatch) {
        result.parsed.resourceIssue = this._cleanText(resourceMatch[1]);
      }

      // Determine parse success
      result.parseSuccess = !!(result.hypothesis || result.rootCause);

      // If we couldn't parse structured data, try to extract key sentences
      if (!result.parseSuccess) {
        result.hypothesis = this._extractKeySentences(noteContent);
        result.parseSuccess = !!result.hypothesis;
      }

      // Estimate confidence if not found
      if (result.confidence === null) {
        result.confidence = this._estimateConfidence(noteContent, result);
      }

      logger.debug('Cleric note parsed', {
        parseSuccess: result.parseSuccess,
        hasHypothesis: !!result.hypothesis,
        confidence: result.confidence,
      });

      return result;
    } catch (error) {
      logger.error('Failed to parse Cleric note', { error: error.message });
      result.error = error.message;
      return result;
    }
  }

  /**
   * Clean extracted text
   */
  _cleanText(text) {
    if (!text) return null;
    return text
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/^[:\-\s]+/, '')
      .replace(/[:\-\s]+$/, '');
  }

  /**
   * Parse comma or newline separated lists
   */
  _parseList(text) {
    if (!text) return [];
    return text
      .split(/[,\n]/)
      .map(item => this._cleanText(item))
      .filter(item => item && item.length > 0);
  }

  /**
   * Extract key sentences when structured parsing fails
   */
  _extractKeySentences(text) {
    // Split into sentences
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);

    // Keywords that indicate important findings
    const keywordPatterns = [
      /correlat/i,
      /caus/i,
      /fail/i,
      /error/i,
      /timeout/i,
      /spike/i,
      /increas/i,
      /decreas/i,
      /block/i,
      /slow/i,
      /latenc/i,
      /unavailable/i,
      /down/i,
    ];

    // Find sentences with important keywords
    const importantSentences = sentences.filter(sentence =>
      keywordPatterns.some(pattern => pattern.test(sentence))
    );

    if (importantSentences.length > 0) {
      return importantSentences.slice(0, 3).map(s => this._cleanText(s)).join('. ');
    }

    // Fallback: return first meaningful sentence
    return sentences.length > 0 ? this._cleanText(sentences[0]) : null;
  }

  /**
   * Estimate confidence based on content analysis
   */
  _estimateConfidence(text, parsedResult) {
    let confidence = 50; // Base confidence

    // Increase confidence for specific indicators
    const confidenceBoosts = [
      { pattern: /definite|certain|clear|obvious/i, boost: 20 },
      { pattern: /likely|probably|appears to be/i, boost: 10 },
      { pattern: /trace.*shows|log.*confirm|metric.*indicat/i, boost: 15 },
      { pattern: /root cause.*identified|found.*cause/i, boost: 20 },
    ];

    const confidenceReductions = [
      { pattern: /possibly|maybe|might|could be/i, reduction: 15 },
      { pattern: /unclear|uncertain|unknown/i, reduction: 20 },
      { pattern: /investigating|still looking|more analysis/i, reduction: 10 },
    ];

    for (const { pattern, boost } of confidenceBoosts) {
      if (pattern.test(text)) {
        confidence += boost;
      }
    }

    for (const { pattern, reduction } of confidenceReductions) {
      if (pattern.test(text)) {
        confidence -= reduction;
      }
    }

    // Boost if we found structured data
    if (parsedResult.rootCause) confidence += 10;
    if (parsedResult.affectedServices.length > 0) confidence += 5;
    if (parsedResult.errorPattern) confidence += 10;

    // Clamp to valid range
    return Math.max(0, Math.min(100, confidence));
  }

  /**
   * Generate a search query for Senso based on parsed data
   */
  generateSensoQuery(parsedNote) {
    const queryParts = [];

    if (parsedNote.rootCause) {
      queryParts.push(parsedNote.rootCause);
    }

    if (parsedNote.hypothesis && parsedNote.hypothesis !== parsedNote.rootCause) {
      queryParts.push(parsedNote.hypothesis);
    }

    if (parsedNote.affectedServices.length > 0) {
      queryParts.push(parsedNote.affectedServices.join(' '));
    }

    if (parsedNote.errorPattern) {
      queryParts.push(parsedNote.errorPattern);
    }

    if (parsedNote.recommendation) {
      queryParts.push('remediation ' + parsedNote.recommendation);
    }

    // Combine and clean
    const query = queryParts
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500); // Limit query length

    return query || 'incident remediation procedure';
  }
}

export const clericParser = new ClericParser();
export default clericParser;
