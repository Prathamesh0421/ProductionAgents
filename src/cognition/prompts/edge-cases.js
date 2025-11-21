/**
 * Edge Case Handler
 *
 * Handles ambiguous, uncertain, and complex scenarios
 * that require special prompt modifications or human escalation
 */

import logger from '../../utils/logger.js';

/**
 * Edge case types and their handling strategies
 */
export const EdgeCaseTypes = {
  AMBIGUOUS_ROOT_CAUSE: 'ambiguous_root_cause',
  MULTIPLE_FAILURES: 'multiple_failures',
  CASCADING_FAILURE: 'cascading_failure',
  NOVEL_FAILURE: 'novel_failure',
  CONFLICTING_EVIDENCE: 'conflicting_evidence',
  LOW_CONFIDENCE: 'low_confidence',
  HIGH_BLAST_RADIUS: 'high_blast_radius',
  DATA_SENSITIVE: 'data_sensitive',
  CUSTOMER_FACING_CRITICAL: 'customer_facing_critical',
};

/**
 * Edge Case Handler
 */
export class EdgeCaseHandler {
  constructor(options = {}) {
    this.confidenceThreshold = options.confidenceThreshold || 60;
    this.blastRadiusThreshold = options.blastRadiusThreshold || 1000; // users affected
  }

  /**
   * Detect edge cases from incident and hypothesis data
   *
   * @param {object} hypothesis - Cleric hypothesis
   * @param {object} incidentContext - Incident metadata
   * @param {object} runbookContext - Senso results
   * @returns {{edgeCases: string[], requiresHuman: boolean, modifications: object}}
   */
  detect(hypothesis, incidentContext, runbookContext) {
    const edgeCases = [];
    let requiresHuman = false;
    const modifications = {};

    // Check for low confidence
    if ((hypothesis.confidence || 50) < this.confidenceThreshold) {
      edgeCases.push(EdgeCaseTypes.LOW_CONFIDENCE);
      modifications.addPromptPrefix = this._getLowConfidencePrefix(hypothesis.confidence);
    }

    // Check for ambiguous root cause
    if (this._isAmbiguousRootCause(hypothesis)) {
      edgeCases.push(EdgeCaseTypes.AMBIGUOUS_ROOT_CAUSE);
      modifications.addDifferentialDiagnosis = true;
    }

    // Check for multiple simultaneous failures
    if (this._hasMultipleFailures(hypothesis)) {
      edgeCases.push(EdgeCaseTypes.MULTIPLE_FAILURES);
      modifications.requestPrioritization = true;
    }

    // Check for cascading failure pattern
    if (this._isCascadingFailure(hypothesis)) {
      edgeCases.push(EdgeCaseTypes.CASCADING_FAILURE);
      modifications.addCascadeAnalysis = true;
    }

    // Check for novel failure (no matching runbooks)
    if (this._isNovelFailure(runbookContext)) {
      edgeCases.push(EdgeCaseTypes.NOVEL_FAILURE);
      modifications.enableCreativeMode = true;
      requiresHuman = true; // Novel failures always need human review
    }

    // Check for conflicting evidence
    if (this._hasConflictingEvidence(hypothesis, runbookContext)) {
      edgeCases.push(EdgeCaseTypes.CONFLICTING_EVIDENCE);
      modifications.addConflictResolution = true;
      requiresHuman = true;
    }

    // Check for high blast radius
    if (this._isHighBlastRadius(incidentContext)) {
      edgeCases.push(EdgeCaseTypes.HIGH_BLAST_RADIUS);
      requiresHuman = true;
    }

    // Check for data-sensitive operations
    if (this._isDataSensitive(hypothesis)) {
      edgeCases.push(EdgeCaseTypes.DATA_SENSITIVE);
      requiresHuman = true;
    }

    // Check for critical customer-facing impact
    if (this._isCriticalCustomerFacing(incidentContext)) {
      edgeCases.push(EdgeCaseTypes.CUSTOMER_FACING_CRITICAL);
      // Don't automatically require human, but flag for extra caution
      modifications.elevateRiskAssessment = true;
    }

    logger.debug('Edge case detection complete', {
      incident_id: incidentContext.incident_id,
      edgeCases,
      requiresHuman,
    });

    return { edgeCases, requiresHuman, modifications };
  }

  /**
   * Modify prompt based on detected edge cases
   */
  modifyPrompt(basePrompt, modifications) {
    let prompt = basePrompt;

    if (modifications.addPromptPrefix) {
      prompt = modifications.addPromptPrefix + '\n\n' + prompt;
    }

    if (modifications.addDifferentialDiagnosis) {
      prompt += '\n\n' + this._getDifferentialDiagnosisSection();
    }

    if (modifications.requestPrioritization) {
      prompt += '\n\n' + this._getPrioritizationSection();
    }

    if (modifications.addCascadeAnalysis) {
      prompt += '\n\n' + this._getCascadeAnalysisSection();
    }

    if (modifications.enableCreativeMode) {
      prompt += '\n\n' + this._getCreativeModeSection();
    }

    if (modifications.addConflictResolution) {
      prompt += '\n\n' + this._getConflictResolutionSection();
    }

    if (modifications.elevateRiskAssessment) {
      prompt = prompt.replace(
        '### Step 3: Evaluate Risks',
        '### Step 3: Evaluate Risks (ELEVATED SCRUTINY REQUIRED)'
      );
    }

    return prompt;
  }

  /**
   * Check if root cause is ambiguous
   */
  _isAmbiguousRootCause(hypothesis) {
    // Multiple potential causes mentioned
    const causeIndicators = ['could be', 'might be', 'possibly', 'or', 'alternatively'];
    const text = (hypothesis.hypothesis || '').toLowerCase();
    const matches = causeIndicators.filter(ind => text.includes(ind));
    return matches.length >= 2;
  }

  /**
   * Check for multiple simultaneous failures
   */
  _hasMultipleFailures(hypothesis) {
    const services = hypothesis.affectedServices || [];
    const failureTypes = hypothesis.failureTypes || [];
    return services.length > 2 || failureTypes.length > 2;
  }

  /**
   * Check for cascading failure pattern
   */
  _isCascadingFailure(hypothesis) {
    const cascadeKeywords = ['cascade', 'propagat', 'domino', 'chain reaction', 'downstream', 'upstream failure'];
    const text = (hypothesis.hypothesis || '').toLowerCase();
    return cascadeKeywords.some(kw => text.includes(kw));
  }

  /**
   * Check if this is a novel failure (no matching runbooks)
   */
  _isNovelFailure(runbookContext) {
    if (!runbookContext?.results || runbookContext.results.length === 0) {
      return true;
    }
    // All runbooks have low relevance
    const maxScore = runbookContext.maxScore || 0;
    return maxScore < 0.5;
  }

  /**
   * Check for conflicting evidence
   */
  _hasConflictingEvidence(hypothesis, runbookContext) {
    if (!runbookContext?.results?.length) return false;

    // Check if runbook recommendations conflict with hypothesis
    const hypothesisText = (hypothesis.hypothesis || '').toLowerCase();
    const recommendationText = (hypothesis.recommendation || '').toLowerCase();

    for (const runbook of runbookContext.results) {
      const runbookText = (runbook.content || '').toLowerCase();

      // Simple conflict detection: opposite recommendations
      const conflicts = [
        ['restart', "don't restart"],
        ['scale up', 'scale down'],
        ['increase', 'decrease'],
        ['enable', 'disable'],
      ];

      for (const [action, opposite] of conflicts) {
        if (
          (hypothesisText.includes(action) && runbookText.includes(opposite)) ||
          (recommendationText.includes(action) && runbookText.includes(opposite))
        ) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check for high blast radius
   */
  _isHighBlastRadius(incidentContext) {
    // High urgency incidents typically have high blast radius
    if (incidentContext.urgency === 'high') {
      return true;
    }

    // Check for critical service indicators
    const criticalServices = ['payment', 'auth', 'checkout', 'api-gateway', 'database'];
    const service = (incidentContext.service_name || incidentContext.service || '').toLowerCase();
    return criticalServices.some(cs => service.includes(cs));
  }

  /**
   * Check for data-sensitive operations
   */
  _isDataSensitive(hypothesis) {
    const sensitiveKeywords = [
      'delete', 'drop', 'truncate', 'purge',
      'user data', 'pii', 'personal', 'payment',
      'credential', 'secret', 'key', 'token',
    ];
    const text = JSON.stringify(hypothesis).toLowerCase();
    return sensitiveKeywords.some(kw => text.includes(kw));
  }

  /**
   * Check for critical customer-facing impact
   */
  _isCriticalCustomerFacing(incidentContext) {
    const customerFacingKeywords = ['checkout', 'payment', 'login', 'signup', 'cart', 'order'];
    const title = (incidentContext.title || '').toLowerCase();
    const service = (incidentContext.service_name || '').toLowerCase();
    return customerFacingKeywords.some(kw => title.includes(kw) || service.includes(kw));
  }

  // Prompt modification sections

  _getLowConfidencePrefix(confidence) {
    return `## LOW CONFIDENCE ALERT

The investigation confidence is only ${confidence}%. This means the root cause identification is uncertain.

REQUIRED ACTIONS:
1. Consider multiple possible causes (differential diagnosis)
2. Recommend diagnostic steps before remediation
3. Default to human approval unless diagnosis can be confirmed
4. Prefer non-invasive investigation over immediate remediation`;
  }

  _getDifferentialDiagnosisSection() {
    return `## Additional Requirement: Differential Diagnosis

The root cause is ambiguous. Before proposing remediation, provide a differential diagnosis:

1. List the top 3 most likely root causes
2. For each, explain:
   - Why it could be the cause
   - What evidence supports it
   - What evidence contradicts it
3. Recommend diagnostic commands to disambiguate
4. Only proceed with remediation if one cause has >70% likelihood`;
  }

  _getPrioritizationSection() {
    return `## Additional Requirement: Failure Prioritization

Multiple failures detected. Before remediation:

1. List all identified failures in order of severity
2. Identify the PRIMARY failure (the one causing others)
3. Determine if failures are:
   - Independent (fix separately)
   - Dependent (fix root first)
   - Correlated (common cause)
4. Generate remediation for the PRIMARY failure only
5. Note which secondary failures should auto-resolve`;
  }

  _getCascadeAnalysisSection() {
    return `## Additional Requirement: Cascade Analysis

This appears to be a cascading failure. Before remediation:

1. Map the failure propagation chain
2. Identify the ORIGIN point of the cascade
3. Assess if the cascade is still propagating
4. Consider whether to:
   - Fix the origin (preferred if cascade stopped)
   - Break the cascade chain (if still propagating)
   - Implement circuit breakers
5. Warn about potential "cascade reversal" effects from the fix`;
  }

  _getCreativeModeSection() {
    return `## Additional Requirement: Novel Failure Analysis

No matching runbooks found for this failure pattern. This requires creative problem-solving:

1. Clearly state this is a NOVEL failure
2. Draw on general SRE principles rather than specific procedures
3. Propose a CONSERVATIVE approach:
   - Diagnostic steps first
   - Minimal intervention
   - Easy rollback
4. Explicitly recommend human review before execution
5. Document this incident thoroughly for future runbook creation

IMPORTANT: For novel failures, the default recommendation should be human investigation, not autonomous remediation.`;
  }

  _getConflictResolutionSection() {
    return `## Additional Requirement: Conflict Resolution

There is conflicting guidance between the investigation hypothesis and the runbooks.

Before proceeding:
1. Explicitly identify the conflict
2. Evaluate which source is more trustworthy in this context:
   - Runbook: Established, tested procedure
   - Hypothesis: Based on current real-time analysis
3. Consider if the conflict indicates:
   - Outdated runbook
   - Misdiagnosis
   - Edge case not covered by runbook
4. REQUIRE human approval to resolve the conflict
5. Document the conflict for runbook review`;
  }
}

/**
 * Quick check if an incident has any edge cases requiring human review
 */
export function requiresHumanReview(hypothesis, incidentContext, runbookContext) {
  const handler = new EdgeCaseHandler();
  const { requiresHuman } = handler.detect(hypothesis, incidentContext, runbookContext);
  return requiresHuman;
}

export default EdgeCaseHandler;
