/**
 * Enhanced Anthropic Client
 *
 * Extends Stream A's Anthropic client with Stream B's prompt engineering
 */

import { AnthropicClient } from '../../services/anthropic.js';
import { RemediationPromptBuilder, buildDiagnosisPrompt } from '../prompts/remediation-prompt.js';
import { EdgeCaseHandler, requiresHumanReview } from '../prompts/edge-cases.js';
import { getSystemPrompt, SystemPrompts } from '../prompts/system-prompts.js';
import logger from '../../utils/logger.js';

/**
 * Enhanced Anthropic Client with advanced prompt engineering
 */
export class EnhancedAnthropicClient extends AnthropicClient {
  constructor(options = {}) {
    super();

    this.promptBuilder = new RemediationPromptBuilder({
      includeExamples: options.includeExamples ?? true,
      maxRunbookLength: options.maxRunbookLength || 4000,
    });

    this.edgeCaseHandler = new EdgeCaseHandler({
      confidenceThreshold: options.confidenceThreshold || 60,
    });
  }

  /**
   * Get contextual system prompt
   */
  getSystemPrompt(context = {}) {
    return getSystemPrompt(context);
  }

  /**
   * Enhanced remediation generation with edge case handling
   *
   * @param {object} hypothesis - Cleric hypothesis
   * @param {object} runbookContext - Senso search results
   * @param {object} incidentContext - Incident metadata
   * @returns {Promise<{code: string, reasoning: string, risk: string, confidence: number, requiresApproval: boolean, edgeCases: string[]}>}
   */
  async generateRemediationEnhanced(hypothesis, runbookContext, incidentContext = {}) {
    // Detect edge cases
    const { edgeCases, requiresHuman, modifications } = this.edgeCaseHandler.detect(
      hypothesis,
      incidentContext,
      runbookContext
    );

    logger.info('Edge case analysis complete', {
      incident_id: incidentContext.incident_id,
      edgeCases,
      requiresHuman,
    });

    // Build prompts
    const { systemPrompt, userPrompt } = this.promptBuilder.build({
      hypothesis,
      runbookContext,
      incidentContext,
    });

    // Apply edge case modifications
    const modifiedPrompt = this.edgeCaseHandler.modifyPrompt(userPrompt, modifications);

    // Generate remediation
    const result = await this._callClaude(systemPrompt, modifiedPrompt);

    // Enhance result with edge case info
    result.edgeCases = edgeCases;
    result.requiresApproval = result.requiresApproval || requiresHuman;

    // If edge cases force human review, ensure it's flagged
    if (requiresHuman && !result.requiresApproval) {
      result.requiresApproval = true;
      result.reasoning = `[AUTOMATIC ESCALATION: ${edgeCases.join(', ')}]\n\n${result.reasoning}`;
    }

    return result;
  }

  /**
   * Generate diagnosis without remediation
   */
  async generateDiagnosisOnly(hypothesis, incidentContext) {
    const systemPrompt = SystemPrompts.DIAGNOSIS_ONLY;
    const userPrompt = buildDiagnosisPrompt(hypothesis, incidentContext);

    const result = await this._callClaude(systemPrompt, userPrompt);

    // Remove any accidentally generated code
    result.code = null;

    return {
      diagnosis: result.reasoning || result.raw,
      confidence: this._estimateDiagnosisConfidence(result.raw),
    };
  }

  /**
   * Validate generated code for safety issues
   */
  async validateGeneratedCode(code, context = {}) {
    const validationPrompt = `You are a security-focused code reviewer. Analyze the following remediation script for safety issues.

## Code to Review
\`\`\`
${code}
\`\`\`

## Context
Service: ${context.service || 'Unknown'}
Incident: ${context.title || 'Unknown'}

## Review Checklist
1. Does it contain any hardcoded credentials or secrets?
2. Could it cause irreversible data loss?
3. Does it have proper error handling?
4. Is it idempotent (safe to run multiple times)?
5. Could it affect unintended systems?
6. Are there any command injection vulnerabilities?

Respond in JSON format:
{
  "safe": true/false,
  "issues": ["issue1", "issue2"],
  "severity": "LOW/MEDIUM/HIGH/CRITICAL",
  "recommendation": "..."
}`;

    const result = await this._callClaude(
      'You are a security code reviewer. Respond only with valid JSON.',
      validationPrompt
    );

    try {
      // Extract JSON from response
      const jsonMatch = result.raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      logger.warn('Failed to parse code validation response', { error: e.message });
    }

    // Default to requiring review if parsing fails
    return {
      safe: false,
      issues: ['Failed to parse validation response'],
      severity: 'MEDIUM',
      recommendation: 'Manual review required',
    };
  }

  /**
   * Internal method to call Claude API
   */
  async _callClaude(systemPrompt, userPrompt) {
    if (!this.apiKey) {
      logger.warn('Anthropic not configured');
      return {
        raw: '',
        code: null,
        reasoning: 'Anthropic API not configured',
        risk: 'UNKNOWN',
        confidence: 0,
        requiresApproval: true,
      };
    }

    try {
      logger.debug('Calling Anthropic API', {
        model: this.model,
        systemPromptLength: systemPrompt.length,
        userPromptLength: userPrompt.length,
      });

      const response = await this.client.post('/v1/messages', {
        model: this.model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const content = response.data.content[0]?.text || '';

      return this._parseRemediationResponse(content);
    } catch (error) {
      logger.error('Anthropic API call failed', {
        error: error.message,
        status: error.response?.status,
      });
      throw error;
    }
  }

  /**
   * Estimate diagnosis confidence from response text
   */
  _estimateDiagnosisConfidence(text) {
    const highConfidencePatterns = [
      /\bclearly\b/i,
      /\bdefinitely\b/i,
      /\bcertain\b/i,
      /\bconfirmed\b/i,
      /\bevidence shows\b/i,
    ];

    const lowConfidencePatterns = [
      /\bmight\b/i,
      /\bcould be\b/i,
      /\bpossibly\b/i,
      /\buncertain\b/i,
      /\bneed more information\b/i,
      /\brequires investigation\b/i,
    ];

    let score = 70; // Base confidence

    for (const pattern of highConfidencePatterns) {
      if (pattern.test(text)) score += 5;
    }

    for (const pattern of lowConfidencePatterns) {
      if (pattern.test(text)) score -= 10;
    }

    return Math.max(20, Math.min(95, score));
  }
}

// Export singleton
export const enhancedAnthropicClient = new EnhancedAnthropicClient();
export default EnhancedAnthropicClient;
