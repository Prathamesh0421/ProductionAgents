/**
 * Remediation Prompt Builder
 *
 * Builds structured Chain-of-Thought prompts for Claude
 * to generate safe, verifiable remediation scripts
 */

import { getSystemPrompt } from './system-prompts.js';

/**
 * Remediation Prompt Builder
 */
export class RemediationPromptBuilder {
  constructor(options = {}) {
    this.includeExamples = options.includeExamples ?? true;
    this.maxRunbookLength = options.maxRunbookLength || 4000;
  }

  /**
   * Build the complete prompt for remediation generation
   *
   * @param {object} params
   * @param {object} params.hypothesis - Cleric hypothesis data
   * @param {object} params.runbookContext - Senso search results
   * @param {object} params.incidentContext - Incident metadata
   * @returns {{systemPrompt: string, userPrompt: string}}
   */
  build({ hypothesis, runbookContext, incidentContext }) {
    // Select appropriate system prompt
    const systemPrompt = getSystemPrompt({
      failureTypes: hypothesis.failureTypes || [],
      isSecurityRelated: this._isSecurityRelated(hypothesis, incidentContext),
      isDatabaseRelated: this._isDatabaseRelated(hypothesis, incidentContext),
    });

    // Build user prompt with Chain-of-Thought structure
    const userPrompt = this._buildUserPrompt(hypothesis, runbookContext, incidentContext);

    return { systemPrompt, userPrompt };
  }

  /**
   * Build the user prompt with CoT structure
   */
  _buildUserPrompt(hypothesis, runbookContext, incidentContext) {
    const sections = [];

    // Header
    sections.push('# Incident Remediation Request');
    sections.push('');

    // Incident context
    sections.push('## Current Incident');
    sections.push(this._formatIncidentContext(incidentContext));
    sections.push('');

    // Investigation hypothesis
    sections.push('## Investigation Hypothesis');
    sections.push(this._formatHypothesis(hypothesis));
    sections.push('');

    // Runbook context
    sections.push('## Relevant Runbooks and Documentation');
    sections.push(this._formatRunbooks(runbookContext));
    sections.push('');

    // Chain-of-Thought instructions
    sections.push('---');
    sections.push('');
    sections.push('## Your Task');
    sections.push('');
    sections.push('Analyze this incident and generate a remediation plan. Follow these steps EXACTLY:');
    sections.push('');
    sections.push(this._getChainOfThoughtInstructions());
    sections.push('');

    // Output format
    sections.push('## Output Format Requirements');
    sections.push('');
    sections.push('1. Use markdown headers for each step');
    sections.push('2. Wrap executable code in `<execution_block>` tags');
    sections.push('3. Clearly state the RISK level (LOW, MEDIUM, or HIGH)');
    sections.push('4. If HIGH risk or uncertain, explicitly state "Human approval required"');
    sections.push('');

    // Examples (if enabled)
    if (this.includeExamples) {
      sections.push(this._getExampleOutput());
    }

    return sections.join('\n');
  }

  /**
   * Format incident context section
   */
  _formatIncidentContext(context) {
    const lines = [];

    lines.push(`- **Incident ID:** ${context.incident_id || 'Unknown'}`);
    lines.push(`- **Title:** ${context.title || 'Unknown'}`);
    lines.push(`- **Service:** ${context.service_name || context.service || 'Unknown'}`);
    lines.push(`- **Urgency:** ${context.urgency || 'Unknown'}`);
    lines.push(`- **Status:** ${context.status || 'Unknown'}`);
    lines.push(`- **Triggered:** ${context.triggered_at || 'Unknown'}`);

    if (context.escalation_policy) {
      lines.push(`- **Escalation Policy:** ${context.escalation_policy}`);
    }

    if (context.previous_incidents) {
      lines.push(`- **Similar Recent Incidents:** ${context.previous_incidents}`);
    }

    return lines.join('\n');
  }

  /**
   * Format hypothesis section
   */
  _formatHypothesis(hypothesis) {
    const lines = [];

    if (hypothesis.hypothesis) {
      lines.push('### Analysis');
      lines.push(hypothesis.hypothesis);
      lines.push('');
    }

    if (hypothesis.rootCause) {
      lines.push(`**Root Cause:** ${hypothesis.rootCause}`);
    }

    if (hypothesis.affectedServices?.length > 0) {
      lines.push(`**Affected Services:** ${hypothesis.affectedServices.join(', ')}`);
    }

    if (hypothesis.metricsCorrelation) {
      lines.push(`**Correlated Metrics:** ${hypothesis.metricsCorrelation}`);
    }

    if (hypothesis.errorPatterns?.length > 0) {
      lines.push('**Error Patterns:**');
      for (const pattern of hypothesis.errorPatterns.slice(0, 3)) {
        lines.push(`- \`${pattern}\``);
      }
    }

    if (hypothesis.recommendation) {
      lines.push(`**Recommended Action:** ${hypothesis.recommendation}`);
    }

    lines.push(`**Investigation Confidence:** ${hypothesis.confidence || 50}%`);

    return lines.join('\n');
  }

  /**
   * Format runbooks section
   */
  _formatRunbooks(runbookContext) {
    if (!runbookContext?.results || runbookContext.results.length === 0) {
      return '_No relevant runbooks found. Use your expertise and standard SRE practices._';
    }

    const lines = [];
    let totalLength = 0;

    for (const [index, runbook] of runbookContext.results.entries()) {
      const header = `### Runbook ${index + 1}: ${runbook.title || 'Untitled'}`;
      const meta = [
        `- **Source:** ${runbook.source || 'Unknown'}`,
        `- **Relevance Score:** ${((runbook.score || 0) * 100).toFixed(1)}%`,
      ].join('\n');

      let content = runbook.content || '_No content available_';

      // Truncate individual runbooks if too long
      const maxPerRunbook = Math.floor(this.maxRunbookLength / runbookContext.results.length);
      if (content.length > maxPerRunbook) {
        content = content.substring(0, maxPerRunbook) + '\n\n_[Truncated - see full runbook in source]_';
      }

      const entry = [header, meta, '', content, ''].join('\n');

      // Check total length
      if (totalLength + entry.length > this.maxRunbookLength) {
        lines.push('_Additional runbooks omitted for brevity_');
        break;
      }

      lines.push(entry);
      totalLength += entry.length;

      if (index < runbookContext.results.length - 1) {
        lines.push('---');
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Chain-of-Thought instructions
   */
  _getChainOfThoughtInstructions() {
    return `### Step 1: Analyze the Investigation
<thinking>
- What is the specific failure mode identified?
- Which component/service is the root cause?
- Is this hypothesis consistent with the symptoms?
- What is my confidence in this diagnosis?
</thinking>

### Step 2: Review Runbook Context
<thinking>
- Do the provided runbooks address this specific issue?
- Are there any contradictions between the runbooks and the hypothesis?
- What approved procedures apply?
- Are there any warnings or caveats in the runbooks?
</thinking>

### Step 3: Evaluate Risks
<thinking>
- What could go wrong if I apply this fix?
- What is the blast radius (how many users/services affected)?
- Is this action reversible? How difficult is rollback?
- Are there any security implications?
- What is the worst-case scenario?
</thinking>

Rate the overall risk: **LOW** / **MEDIUM** / **HIGH**

### Step 4: Generate Remediation Code
If risk is acceptable, generate the remediation script. The code MUST:
- Be idempotent (safe to run multiple times)
- Include error handling with clear exit codes
- Log all actions for audit trail
- Use environment variables for any configuration
- Have a dry-run mode if possible

Wrap code in: \`<execution_block>\` ... \`</execution_block>\`

### Step 5: Verification Steps
Describe how to verify the fix worked:
- What metrics should improve?
- What endpoints should be checked?
- How long to wait before confirming success?`;
  }

  /**
   * Example output for few-shot learning
   */
  _getExampleOutput() {
    return `
## Example Output Format

<example>
### Step 1: Analyze the Investigation
<thinking>
The investigation indicates a database connection pool exhaustion on the payment-api service. The hypothesis confidence is 85%, which is reasonably high. The correlation with the "max connections reached" error pattern supports this diagnosis.
</thinking>

### Step 2: Review Runbook Context
<thinking>
Runbook #1 directly addresses connection pool issues and recommends recycling idle connections before scaling the pool. This aligns with the hypothesis. No contradictions found.
</thinking>

### Step 3: Evaluate Risks
<thinking>
- Recycling connections may cause brief request failures (< 1 second)
- Blast radius: Only payment-api service
- Reversible: Yes, connections will re-establish automatically
- Security: No implications
- Worst case: Brief spike in errors during recycling
</thinking>

Risk Level: **LOW**

### Step 4: Generate Remediation Code

<execution_block>
#!/bin/bash
set -euo pipefail

SERVICE="payment-api"
LOG_FILE="/var/log/remediation-\${SERVICE}-$(date +%Y%m%d-%H%M%S).log"

log() { echo "[$(date -Iseconds)] $1" | tee -a "$LOG_FILE"; }

log "Starting connection pool remediation for $SERVICE"

# Gracefully recycle idle connections
kubectl exec -n production deploy/$SERVICE -- \\
  curl -X POST localhost:8080/admin/connections/recycle \\
  -H "Authorization: Bearer $ADMIN_TOKEN" || {
    log "ERROR: Failed to recycle connections"
    exit 1
  }

log "Connection pool recycled successfully"
exit 0
</execution_block>

### Step 5: Verification Steps
1. Monitor \`db_connection_pool_active\` metric - should decrease within 30 seconds
2. Check \`payment_api_error_rate\` - should return to baseline within 2 minutes
3. Verify health endpoint returns 200: \`GET /health\`
</example>`;
  }

  /**
   * Check if incident is security-related
   */
  _isSecurityRelated(hypothesis, context) {
    const securityKeywords = ['security', 'auth', 'ddos', 'attack', 'breach', 'unauthorized', 'injection', 'xss'];
    const text = JSON.stringify({ hypothesis, context }).toLowerCase();
    return securityKeywords.some(kw => text.includes(kw));
  }

  /**
   * Check if incident is database-related
   */
  _isDatabaseRelated(hypothesis, context) {
    const dbKeywords = ['database', 'db', 'sql', 'postgres', 'mysql', 'mongo', 'redis', 'query', 'deadlock', 'connection pool'];
    const text = JSON.stringify({ hypothesis, context }).toLowerCase();
    return dbKeywords.some(kw => text.includes(kw));
  }
}

/**
 * Build a diagnosis-only prompt (no remediation)
 */
export function buildDiagnosisPrompt(hypothesis, incidentContext) {
  return `# Incident Diagnosis Request

## Incident Details
- **ID:** ${incidentContext.incident_id || 'Unknown'}
- **Title:** ${incidentContext.title || 'Unknown'}
- **Service:** ${incidentContext.service_name || 'Unknown'}
- **Urgency:** ${incidentContext.urgency || 'Unknown'}

## Investigation Data
${hypothesis.hypothesis || 'No hypothesis available'}

## Your Task

Provide a detailed diagnosis WITHOUT generating remediation code. Structure your response as:

1. **Summary**: One-paragraph summary of the incident
2. **Root Cause Analysis**: Most likely cause with confidence level
3. **Causal Chain**: Sequence of events leading to the failure
4. **Impact Assessment**: Current and potential escalation impact
5. **Recommended Next Steps**: What should the on-call engineer do next?

Do NOT include any <execution_block> tags.`;
}

export default RemediationPromptBuilder;
