/**
 * Enhanced Orchestrator Integration
 *
 * Wraps Stream A's orchestrator with Stream B's enhanced cognition services
 * Provides drop-in replacement with advanced prompt engineering and verification
 *
 * Updated for refactored architecture:
 * - Sanity instead of Senso
 * - AI abstraction layer (Anthropic/Gemini)
 * - Parallel research integration
 * - Skyflow PII redaction
 */

import { Orchestrator } from '../../services/orchestrator.js';
import { EnhancedSanityClient } from '../services/enhanced-sanity.js';
import { EnhancedAnthropicClient } from '../services/enhanced-anthropic.js';
import { EnhancedLightpandaClient } from '../services/enhanced-lightpanda.js';
import { IncidentLearner, createLearningScheduler } from '../ingestion/incident-learner.js';
import stateManager, { RedisStateManager } from '../../state/redis.js';
import pagerdutyClient from '../../services/pagerduty.js';
import config from '../../config/index.js';
import logger from '../../utils/logger.js';

/**
 * Enhanced Orchestrator with Stream B capabilities
 */
export class EnhancedOrchestrator extends Orchestrator {
  constructor(options = {}) {
    super();

    // Replace base services with enhanced versions
    this.sanityClient = new EnhancedSanityClient({
      dryRun: options.dryRun || false,
      stabilityPeriodMs: options.stabilityPeriodMs || 24 * 60 * 60 * 1000,
    });

    this.aiClient = new EnhancedAnthropicClient({
      includeExamples: options.includeExamples ?? true,
      confidenceThreshold: options.confidenceThreshold || 60,
    });

    this.lightpandaClient = new EnhancedLightpandaClient({
      maxConcurrency: options.maxConcurrency || 10,
    });

    // Incident learner for post-resolution learning
    this.incidentLearner = new IncidentLearner({
      contextClient: this.sanityClient,
      stabilityPeriodMs: options.stabilityPeriodMs,
    });

    // Learning scheduler
    this.learningScheduler = null;

    // Use config thresholds
    this.contextMatchThreshold = config.confidence.contextMatchThreshold;
  }

  /**
   * Start the incident learning scheduler
   */
  startLearningScheduler(intervalMs = 60 * 60 * 1000) {
    this.learningScheduler = createLearningScheduler({
      contextClient: this.sanityClient,
      intervalMs,
    });
    this.learningScheduler.start();
    logger.info('Incident learning scheduler started');
    return this;
  }

  /**
   * Stop the learning scheduler
   */
  stopLearningScheduler() {
    if (this.learningScheduler) {
      this.learningScheduler.stop();
    }
    return this;
  }

  /**
   * Enhanced hypothesis processing with metadata filtering
   */
  async processHypothesis(incidentId, parsedHypothesis, query) {
    try {
      logger.info('Processing hypothesis (enhanced)', {
        incidentId,
        query: query.substring(0, 100),
      });

      // Check for recurrence (knowledge poisoning prevention)
      const service = parsedHypothesis.affectedServices?.[0];
      const failureType = parsedHypothesis.failureTypes?.[0];

      if (service && failureType) {
        const recurrence = await this.incidentLearner.checkForRecurrence(service, failureType);
        if (recurrence) {
          logger.warn('Recurrence detected - previous resolution marked ineffective', {
            incidentId,
            previousIncident: recurrence.incident_id,
          });
        }
      }

      // Enhanced search with metadata filtering via Sanity
      const contextResults = await this.sanityClient.searchWithFilters(query, {
        service: service,
        failureTypes: parsedHypothesis.failureTypes,
        limit: 5,
      });

      // Update state with context
      await stateManager.transitionStage(
        incidentId,
        RedisStateManager.STAGES.CONTEXT_RETRIEVED,
        {
          sanity_context: contextResults,
          context_match_score: contextResults.maxScore * 100,
          query: query,
        }
      );

      // Get incident state for additional context
      const incidentState = await stateManager.getIncidentState(incidentId);

      // Proceed to enhanced synthesis phase
      await this.synthesizeRemediationEnhanced(
        incidentId,
        parsedHypothesis,
        contextResults,
        incidentState
      );
    } catch (error) {
      logger.error('Failed to process hypothesis (enhanced)', {
        error: error.message,
        incidentId,
      });

      await stateManager.transitionStage(incidentId, RedisStateManager.STAGES.ESCALATED, {
        error: error.message,
        error_stage: 'context_retrieval',
      });
    }
  }

  /**
   * Enhanced synthesis with edge case handling
   */
  async synthesizeRemediationEnhanced(incidentId, hypothesis, contextResults, incidentState) {
    try {
      logger.info('Synthesizing remediation (enhanced)', { incidentId });

      await stateManager.transitionStage(incidentId, RedisStateManager.STAGES.SYNTHESIZING);

      // Use enhanced AI client with edge case handling
      const remediation = await this.aiClient.generateRemediationEnhanced(
        hypothesis,
        contextResults,
        incidentState
      );

      if (!remediation || !remediation.code) {
        logger.warn('No remediation code generated', {
          incidentId,
          edgeCases: remediation?.edgeCases,
        });

        await stateManager.transitionStage(incidentId, RedisStateManager.STAGES.ESCALATED, {
          error: 'No remediation code generated',
          anthropic_reasoning: remediation?.reasoning,
          edge_cases: remediation?.edgeCases,
        });
        return;
      }

      // Validate generated code for safety
      const codeValidation = await this.aiClient.validateGeneratedCode(
        remediation.code,
        { service: incidentState.service_name, title: incidentState.title }
      );

      if (!codeValidation.safe) {
        logger.warn('Generated code failed safety validation', {
          incidentId,
          issues: codeValidation.issues,
          severity: codeValidation.severity,
        });

        // Force human approval for unsafe code
        remediation.requiresApproval = true;
        remediation.safetyIssues = codeValidation.issues;
      }

      // Update state with remediation details
      await stateManager.updateIncidentState(incidentId, {
        remediation_code: remediation.code,
        anthropic_reasoning: remediation.reasoning,
        remediation_risk: remediation.risk,
        remediation_confidence: remediation.confidence,
        edge_cases: remediation.edgeCases,
        code_validation: codeValidation,
      });

      // Enhanced Confidence Protocol
      const shouldAutoExecute = this.evaluateConfidenceEnhanced(
        hypothesis.confidence,
        contextResults.maxScore * 100,
        remediation.confidence,
        remediation.risk,
        remediation.edgeCases
      );

      if (shouldAutoExecute && !remediation.requiresApproval) {
        logger.info('Auto-executing remediation (enhanced confidence passed)', { incidentId });
        await this.executeRemediationEnhanced(incidentId);
      } else {
        logger.info('Requesting human approval (enhanced)', {
          incidentId,
          reason: remediation.requiresApproval ? 'AI/Safety requested' : 'Low confidence',
          edgeCases: remediation.edgeCases,
        });
        await this.requestHumanApproval(incidentId, remediation, hypothesis, incidentState);
      }
    } catch (error) {
      logger.error('Failed to synthesize remediation (enhanced)', {
        error: error.message,
        incidentId,
      });

      await stateManager.transitionStage(incidentId, RedisStateManager.STAGES.ESCALATED, {
        error: error.message,
        error_stage: 'synthesis',
      });
    }
  }

  /**
   * Enhanced confidence evaluation with edge cases
   */
  evaluateConfidenceEnhanced(hypothesisConfidence, contextMatchScore, remediationConfidence, risk, edgeCases = []) {
    // First apply base evaluation
    const baseResult = this.evaluateConfidence(
      hypothesisConfidence,
      contextMatchScore,
      remediationConfidence,
      risk
    );

    if (!baseResult) {
      return false;
    }

    // Additional checks for edge cases
    const criticalEdgeCases = [
      'novel_failure',
      'conflicting_evidence',
      'data_sensitive',
      'high_blast_radius',
    ];

    if (edgeCases.some(ec => criticalEdgeCases.includes(ec))) {
      logger.debug('Confidence Protocol: Critical edge case detected - requires approval', {
        edgeCases,
      });
      return false;
    }

    return true;
  }

  /**
   * Enhanced remediation execution with verification swarm
   */
  async executeRemediationEnhanced(incidentId) {
    try {
      const incidentState = await stateManager.getIncidentState(incidentId);

      if (!incidentState || !incidentState.remediation_code) {
        throw new Error('No remediation code found');
      }

      logger.info('Executing remediation (enhanced)', { incidentId });

      await stateManager.transitionStage(incidentId, RedisStateManager.STAGES.EXECUTING);

      // Get service preset for verification
      const servicePreset = EnhancedLightpandaClient.getServicePreset(
        incidentState.service_name,
        incidentState.service_url || `https://${incidentState.service_name}.internal`
      );

      // Pre-remediation swarm check
      if (servicePreset.urls?.length > 0) {
        const preCheck = await this.lightpandaClient.quickSwarm(servicePreset.urls);

        await stateManager.updateIncidentState(incidentId, {
          pre_verification_status: preCheck.success ? 'healthy' : 'unhealthy',
          pre_verification_result: preCheck.summary,
        });

        // If all checks pass, issue may have self-healed
        if (preCheck.success) {
          logger.info('Pre-flight check passed - issue may have resolved itself', { incidentId });
          await stateManager.transitionStage(incidentId, RedisStateManager.STAGES.RESOLVED, {
            resolution: 'self_healed',
            resolved_at: new Date().toISOString(),
          });
          return;
        }
      }

      // Execute remediation using parent class method
      await super.executeRemediation(incidentId);
    } catch (error) {
      logger.error('Enhanced remediation execution error', {
        error: error.message,
        incidentId,
      });

      await stateManager.transitionStage(incidentId, RedisStateManager.STAGES.ESCALATED, {
        error: error.message,
        error_stage: 'execution',
      });
    }
  }

  /**
   * Enhanced verification with swarm and journeys
   */
  async verifyRemediation(incidentId) {
    try {
      logger.info('Verifying remediation (enhanced)', { incidentId });

      await stateManager.transitionStage(incidentId, RedisStateManager.STAGES.VERIFYING);

      const incidentState = await stateManager.getIncidentState(incidentId);

      // Get service preset
      const servicePreset = EnhancedLightpandaClient.getServicePreset(
        incidentState.service_name,
        incidentState.service_url || `https://${incidentState.service_name}.internal`
      );

      // Run verification swarm
      let verification = { success: true, summary: {} };

      if (servicePreset.urls?.length > 0) {
        verification = await this.lightpandaClient.quickSwarm(servicePreset.urls);
      }

      await stateManager.updateIncidentState(incidentId, {
        verification_status: verification.success ? 'passed' : 'failed',
        verification_result: verification.summary,
        post_verification_result: verification,
        verified_at: new Date().toISOString(),
      });

      if (verification.success) {
        logger.info('Remediation verified successfully (enhanced)', { incidentId });

        await stateManager.transitionStage(incidentId, RedisStateManager.STAGES.RESOLVED, {
          resolution: 'auto_remediated',
          resolved_at: new Date().toISOString(),
        });

        // Add note to PagerDuty
        await pagerdutyClient.addNote(
          incidentId,
          `Self-Healing Engine (Enhanced) successfully remediated this incident.\n\n` +
          `Root Cause: ${incidentState.hypothesis?.rootCause || incidentState.root_cause || 'See investigation'}\n` +
          `Action Taken: Automated remediation executed\n` +
          `Verification: ${verification.passed}/${verification.totalChecks} checks passed`
        );

        // Schedule for learning
        await this.handleResolutionEnhanced(incidentId, incidentState);
      } else {
        logger.warn('Remediation verification failed (enhanced)', {
          incidentId,
          failedChecks: verification.summary.failedChecks,
        });

        await stateManager.transitionStage(incidentId, RedisStateManager.STAGES.ESCALATED, {
          error: 'Verification failed after remediation',
          verification_result: verification,
        });

        await pagerdutyClient.addNote(
          incidentId,
          `Self-Healing Engine attempted remediation but verification failed.\n` +
          `Failed checks: ${verification.failed}/${verification.totalChecks}\n` +
          `Manual intervention required.`
        );
      }
    } catch (error) {
      logger.error('Enhanced verification error', {
        error: error.message,
        incidentId,
      });

      await stateManager.transitionStage(incidentId, RedisStateManager.STAGES.ESCALATED, {
        error: error.message,
        error_stage: 'verification',
      });
    }
  }

  /**
   * Enhanced resolution handling with incident learning
   */
  async handleResolutionEnhanced(incidentId, incidentState) {
    try {
      if (incidentState.resolution !== 'auto_remediated') {
        return;
      }

      // Get full state for learning
      const fullState = await stateManager.getIncidentState(incidentId);

      // Schedule for delayed learning (prevents knowledge poisoning)
      await this.incidentLearner.scheduleForLearning(fullState);

      logger.info('Incident scheduled for learning', { incidentId });
    } catch (error) {
      logger.error('Failed to handle resolution for learning', {
        error: error.message,
        incidentId,
      });
    }
  }
}

// Factory function to create enhanced orchestrator
export function createEnhancedOrchestrator(options = {}) {
  const orchestrator = new EnhancedOrchestrator(options);

  // Start learning scheduler by default
  if (options.enableLearningScheduler !== false) {
    orchestrator.startLearningScheduler(options.learningIntervalMs);
  }

  return orchestrator;
}

// Export singleton with default options
export const enhancedOrchestrator = new EnhancedOrchestrator();
export default EnhancedOrchestrator;
