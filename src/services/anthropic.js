import axios from 'axios';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import { ConfigurationError, ExternalServiceError } from '../utils/errors.js';

/**
 * Anthropic Claude API Client
 * The "Brain" - Decision & Synthesis engine
 *
 * DEPENDENCY: Stream B will implement full prompt engineering
 * Stream A provides the interface and Chain-of-Thought structure
 */

export class AnthropicClient {
  constructor() {
    this.apiKey = config.anthropic.apiKey;
    this.model = config.anthropic.model;
    this.client = axios.create({
      baseURL: 'https://api.anthropic.com',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      timeout: 120000, // 2 min timeout for complex reasoning
    });
  }

  /**
   * System prompt for SRE reasoning
   * Enforces Chain-of-Thought and safety considerations
   */
  getSystemPrompt() {
    return `You are a Senior Site Reliability Engineer with extensive experience in incident response and remediation. You are cautious, methodical, and prioritize system stability above all else.

When analyzing incidents and generating remediation code, you MUST follow these steps:

## Step 1: Analyze the Investigation
Summarize the root cause hypothesis from the investigation data. Identify the specific component, service, or resource that is failing.

## Step 2: Review the Runbook Context
Cross-reference the hypothesis with the provided runbooks. Note any approved procedures that apply. If the runbook contradicts the hypothesis, flag this as a concern.

## Step 3: Evaluate Risks
List potential risks of the proposed remediation:
- Data loss potential
- Service disruption scope
- Rollback complexity
- Security implications

Rate the overall risk as: LOW, MEDIUM, or HIGH

## Step 4: Generate Reproduction and Remediation Code
If risk is acceptable, generate two scripts:

1. A Reproduction Script:
   - Must reproduce the issue (fail) when the bug is present.
   - Must pass (exit code 0) when the bug is fixed.
   - Wrap in <reproduction_block> tags.

2. A Remediation Script:
   - The code must be idempotent (safe to run multiple times).
   - Include error handling.
   - Log all actions taken.
   - Have a dry-run mode where possible.
   - Wrap in <execution_block> tags.

## Step 5: Verification Steps
Describe how to verify the fix worked.

IMPORTANT SAFETY RULES:
- Never generate code that could cause irreversible data loss
- Never hardcode credentials or secrets
- Always prefer graceful restarts over hard kills
- If uncertain, recommend human review instead of autonomous execution`;
  }

  /**
   * Generate remediation code using Chain-of-Thought reasoning
   *
   * @param {object} hypothesis - Parsed Cleric hypothesis
   * @param {string} runbookContext - Formatted Senso results
   * @param {object} incidentContext - Additional incident metadata
   * @returns {Promise<{code: string, reasoning: string, risk: string, confidence: number}>}
   */
  async generateRemediation(hypothesis, runbookContext, incidentContext = {}) {
    if (!this.apiKey) {
      logger.warn('Anthropic not configured - cannot generate remediation');
      return null;
    }

    const userPrompt = this._buildRemediationPrompt(hypothesis, runbookContext, incidentContext);

    try {
      logger.info('Requesting remediation from Anthropic', {
        model: this.model,
        hypothesisLength: hypothesis.hypothesis?.length || 0,
      });

      const response = await this.client.post('/v1/messages', {
        model: this.model,
        max_tokens: 4096,
        system: this.getSystemPrompt(),
        messages: [
          { role: 'user', content: userPrompt }
        ],
      });

      const content = response.data.content[0]?.text || '';

      // Parse the response
      const result = this._parseRemediationResponse(content);

      logger.info('Remediation generated', {
        hasCode: !!result.code,
        risk: result.risk,
        reasoningLength: result.reasoning.length,
      });

      return result;
    } catch (error) {
      logger.error('Anthropic request failed', {
        error: error.message,
        status: error.response?.status,
      });
      throw new ExternalServiceError('Anthropic', 'Remediation generation failed', error);
    }
  }

  /**
   * Build the remediation prompt
   */
  _buildRemediationPrompt(hypothesis, runbookContext, incidentContext) {
    return `# Incident Analysis Request

## Current Incident
- Title: ${incidentContext.title || 'Unknown'}
- Service: ${incidentContext.service_name || 'Unknown'}
- Urgency: ${incidentContext.urgency || 'Unknown'}
- Triggered: ${incidentContext.triggered_at || 'Unknown'}

## Investigation Hypothesis (from automated analysis)
${hypothesis.hypothesis || 'No hypothesis available'}

Root Cause: ${hypothesis.rootCause || 'Not identified'}
Affected Services: ${hypothesis.affectedServices?.join(', ') || 'Unknown'}
Recommended Action: ${hypothesis.recommendation || 'None specified'}
Investigation Confidence: ${hypothesis.confidence || 0}%

## Relevant Runbooks and Documentation
${runbookContext}

---

Please analyze this incident and generate a remediation script following the Chain-of-Thought process defined in your instructions. If the risk is HIGH or you are uncertain, clearly state that human approval is required.`;
  }

  /**
   * Parse the remediation response
   */
  _parseRemediationResponse(content) {
    const result = {
      raw: content,
      code: null,
      language: 'python', // Default
      reasoning: '',
      risk: 'UNKNOWN',
      confidence: 50,
      verificationSteps: [],
      requiresApproval: false,
    };

    // Extract code block and language attribute
    const codeMatch = content.match(/<execution_block(?:\s+language=["']?(\w+)["']?)?>([\s\S]*?)<\/execution_block>/);
    if (codeMatch) {
      result.language = codeMatch[1] || 'python';
      result.code = codeMatch[2].trim();
    }

    // Extract risk level
    const riskMatch = content.match(/(?:overall\s*)?risk[:\s]+(?:is\s+)?(LOW|MEDIUM|HIGH)/i);
    if (riskMatch) {
      result.risk = riskMatch[1].toUpperCase();
    }

    // Check for human approval requirement
    result.requiresApproval =
      result.risk === 'HIGH' ||
      /human\s*(review|approval|intervention)\s*(is\s*)?(required|recommended|needed)/i.test(content) ||
      /uncertain|unsure|not\s*confident/i.test(content);

    // Extract reasoning (everything before the code block)
    if (codeMatch) {
      result.reasoning = content.substring(0, codeMatch.index).trim();
    } else {
      result.reasoning = content;
    }

    // Estimate confidence based on language
    if (/certain|confident|clearly|definitely/i.test(content)) {
      result.confidence = 85;
    } else if (/likely|probably|should/i.test(content)) {
      result.confidence = 70;
    } else if (/might|could|possibly/i.test(content)) {
      result.confidence = 50;
    }

    // Reduce confidence if risk is high
    if (result.risk === 'HIGH') {
      result.confidence = Math.min(result.confidence, 40);
    }

    return result;
  }
}

export const anthropicClient = new AnthropicClient();
export default anthropicClient;
