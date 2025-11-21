import logger from '../utils/logger.js';

/**
 * Parser for Cleric's PagerDuty Notes
 * Extracts structured data from natural language investigation notes
 */
class ClericParser {
  /**
   * Check if a PagerDuty note is from Cleric
   * @param {Object} note - PagerDuty note object
   * @returns {boolean}
   */
  isClericNote(note) {
    if (!note || !note.content) return false;
    // Cleric usually identifies itself or uses a specific format
    // Adjust this logic based on actual Cleric output if available
    // For now, we'll look for keywords or assume specific bot user if we had that info
    return note.content.includes('Cleric Investigation') || 
           note.content.includes('Root Cause Analysis') ||
           note.content.toLowerCase().includes('cleric');
  }

  /**
   * Parse the content of a Cleric note
   * @param {string} content - The raw note content
   * @returns {Object} Structured data
   */
  parseNote(content) {
    try {
      // Default structure
      const result = {
        parseSuccess: false,
        confidence: 0,
        rootCause: null,
        hypothesis: null,
        recommendation: null,
        affectedServices: [],
      };

      if (!content) return result;

      // Extract Confidence (e.g., "Confidence: 85%" or "Confidence Score: 0.9")
      const confidenceMatch = content.match(/Confidence(?:\s*Score)?:\s*(\d+(?:\.\d+)?)(?:%)?/i);
      if (confidenceMatch) {
        let val = parseFloat(confidenceMatch[1]);
        // Normalize to 0-100
        if (val <= 1 && content.includes('0.')) val *= 100; 
        result.confidence = val;
      }

      // Extract Root Cause
      const rootCauseMatch = content.match(/(?:Root Cause|Cause):\s*([^\n]+)/i);
      if (rootCauseMatch) {
        result.rootCause = rootCauseMatch[1].trim();
      }

      // Extract Hypothesis (often synonymous with Root Cause or a separate section)
      const hypothesisMatch = content.match(/(?:Hypothesis|Analysis):\s*([^\n]+)/i);
      if (hypothesisMatch) {
        result.hypothesis = hypothesisMatch[1].trim();
      } else if (result.rootCause) {
        result.hypothesis = result.rootCause;
      }

      // Extract Recommendation
      const recommendationMatch = content.match(/(?:Recommendation|Suggested Action):\s*([^\n]+)/i);
      if (recommendationMatch) {
        result.recommendation = recommendationMatch[1].trim();
      }

      // Extract Affected Services
      const servicesMatch = content.match(/(?:Affected Services|Services):\s*([^\n]+)/i);
      if (servicesMatch) {
        result.affectedServices = servicesMatch[1].split(',').map(s => s.trim());
      }

      // Check if we got minimum required data
      if (result.rootCause || result.hypothesis) {
        result.parseSuccess = true;
      }

      return result;
    } catch (error) {
      logger.error('Error parsing Cleric note', { error: error.message });
      return { parseSuccess: false };
    }
  }

  /**
   * Generate a search query for Senso based on the parsed note
   * @param {Object} parsedNote 
   * @returns {string}
   */
  generateSensoQuery(parsedNote) {
    if (!parsedNote) return '';
    
    const parts = [];
    if (parsedNote.rootCause) parts.push(parsedNote.rootCause);
    if (parsedNote.affectedServices && parsedNote.affectedServices.length > 0) {
      parts.push(parsedNote.affectedServices.join(' '));
    }
    
    // Fallback or enhancement
    if (parts.length === 0 && parsedNote.hypothesis) {
      return parsedNote.hypothesis;
    }

    return parts.join(' ');
  }
}

export const clericParser = new ClericParser();
export default clericParser;
