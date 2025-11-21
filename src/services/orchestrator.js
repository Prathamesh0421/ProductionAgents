import config from '../config/index.js';
import logger from '../utils/logger.js';
import stateManager, { RedisStateManager } from '../state/redis.js';
import sensoClient from './senso.js';
import aiClient from './llm.js';
import coderClient from './coder.js';
import lightpandaClient from './lightpanda.js';
import slackClient from './slack.js';
import pagerdutyClient from './pagerduty.js';

/**
 * Orchestrator - The Nervous System
 * Coordinates the OODA loop between all services
 * Implements the Confidence Protocol for autonomous vs human-approval decisions
 */

export class Orchestrator {
  constructor() {
    this.confidenceThreshold = config.confidence.autoExecuteThreshold;
    this.sensoMatchThreshold = config.confidence.sensoMatchThreshold;
  }

  /**
   * Process hypothesis from Cleric
   * This is the "Orient" phase - retrieve context from Senso
   *
   * @param {string} incidentId
   * @param {object} parsedHypothesis
   * @param {string} sensoQuery
   */
  async processHypothesis(incidentId, parsedHypothesis, sensoQuery) {
    try {
      logger.info('Processing hypothesis', { incidentId, sensoQuery: sensoQuery.substring(0, 100) });

      // Query Senso for relevant runbooks
      const sensoResults = await sensoClient.search(sensoQuery, 5);

      // Update state with Senso context
      await stateManager.transitionStage(
        incidentId,
        RedisStateManager.STAGES.CONTEXT_RETRIEVED,
        {
          senso_context: sensoResults.results,
          senso_match_score: sensoResults.maxScore * 100, // Convert to percentage
          senso_query: sensoQuery,
        }
      );

      // Format context for Anthropic
      const runbookContext = sensoClient.formatForPrompt(sensoResults.results);

      // Get incident state for additional context
      const incidentState = await stateManager.getIncidentState(incidentId);

      // Proceed to synthesis phase
      await this.synthesizeRemediation(incidentId, parsedHypothesis, runbookContext, incidentState);
    } catch (error) {
      logger.error('Failed to process hypothesis', {
        error: error.message,
        incidentId,
      });

      // Escalate on failure
      await stateManager.transitionStage(incidentId, RedisStateManager.STAGES.ESCALATED, {
        error: error.message,
        error_stage: 'context_retrieval',
      });
    }
  }

  /**
   * Synthesize remediation using Anthropic
   * This is the "Decide" phase
   */
  async synthesizeRemediation(incidentId, hypothesis, runbookContext, incidentState) {
    try {
      logger.info('Synthesizing remediation', { incidentId });

      await stateManager.transitionStage(incidentId, RedisStateManager.STAGES.SYNTHESIZING);

      // Call Anthropic to generate remediation
      const remediation = await anthropicClient.generateRemediation(
        hypothesis,
        runbookContext,
        incidentState
      );

      if (!remediation || !remediation.code) {
        logger.warn('No remediation code generated', { incidentId });
        await stateManager.transitionStage(incidentId, RedisStateManager.STAGES.ESCALATED, {
          error: 'No remediation code generated',
          anthropic_reasoning: remediation?.reasoning,
        });
        return;
      }

      // Update state with remediation details
      await stateManager.updateIncidentState(incidentId, {
        remediation_code: remediation.code,
        anthropic_reasoning: remediation.reasoning,
        remediation_risk: remediation.risk,
        remediation_confidence: remediation.confidence,
      });

      // Apply Confidence Protocol
      const shouldAutoExecute = this.evaluateConfidence(
        hypothesis.confidence,
        incidentState.senso_match_score,
        remediation.confidence,
        remediation.risk
      );

      if (shouldAutoExecute && !remediation.requiresApproval) {
        // Proceed to execution
        logger.info('Auto-executing remediation (high confidence)', { incidentId });
        await this.executeRemediation(incidentId);
      } else {
        // Request human approval
        logger.info('Requesting human approval', {
          incidentId,
          reason: remediation.requiresApproval ? 'AI requested' : 'Low confidence',
        });
        await this.requestHumanApproval(incidentId, remediation, hypothesis, incidentState);
      }
    } catch (error) {
      logger.error('Failed to synthesize remediation', {
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
   * Evaluate confidence using the Confidence Protocol
   * Returns true if safe to auto-execute
   */
  evaluateConfidence(clericConfidence, sensoMatchScore, remediationConfidence, risk) {
    // If risk is HIGH, never auto-execute
    if (risk === 'HIGH') {
      logger.debug('Confidence Protocol: HIGH risk - requires approval');
      return false;
    }

    // Check Cleric confidence
    if ((clericConfidence || 0) < this.confidenceThreshold) {
      logger.debug('Confidence Protocol: Cleric confidence below threshold', {
        clericConfidence,
        threshold: this.confidenceThreshold,
      });
      return false;
    }

    // Check Senso match score
    if ((sensoMatchScore || 0) < this.sensoMatchThreshold) {
      logger.debug('Confidence Protocol: Senso match score below threshold', {
        sensoMatchScore,
        threshold: this.sensoMatchThreshold,
      });
      return false;
    }

    // Check remediation confidence
    if ((remediationConfidence || 0) < 70) {
      logger.debug('Confidence Protocol: Remediation confidence too low', {
        remediationConfidence,
      });
      return false;
    }

    logger.debug('Confidence Protocol: All checks passed - safe to auto-execute');
    return true;
  }

  /**
   * Request human approval via Slack
   */
  async requestHumanApproval(incidentId, remediation, hypothesis, incidentState) {
    try {
      // Store pending approval in Redis
      await stateManager.setPendingApproval(incidentId, {
        remediation_code: remediation.code,
        hypothesis: hypothesis.hypothesis,
        risk: remediation.risk,
      });

      // Send Slack message
      const result = await slackClient.requestApproval(incidentId, {
        title: incidentState.title,
        hypothesis: hypothesis.hypothesis,
        risk: remediation.risk,
        code: remediation.code,
        reasoning: remediation.reasoning,
        serviceName: incidentState.service_name,
      });

      // Update state
      await stateManager.updateIncidentState(incidentId, {
        pending_approval: true,
        approval_requested_at: new Date().toISOString(),
        approval_slack_ts: result?.messageTs,
      });

      logger.info('Human approval requested', { incidentId });
    } catch (error) {
      logger.error('Failed to request human approval', {
        error: error.message,
        incidentId,
      });

      // Fallback: still escalate
      await stateManager.transitionStage(incidentId, RedisStateManager.STAGES.ESCALATED, {
        error: 'Failed to request approval: ' + error.message,
      });
    }
  }

  /**
   * Execute remediation in Coder sandbox
   * This is the "Act" phase
   */
  async executeRemediation(incidentId) {
    try {
      const incidentState = await stateManager.getIncidentState(incidentId);

      if (!incidentState || !incidentState.remediation_code) {
        throw new Error('No remediation code found');
      }

      logger.info('Executing remediation', { incidentId });

      await stateManager.transitionStage(incidentId, RedisStateManager.STAGES.EXECUTING);

      // Pre-flight verification with Lightpanda
      // (Confirm the issue still exists)
      const preFlightCheck = await this.runPreFlightCheck(incidentState);
      if (preFlightCheck && preFlightCheck.success) {
        logger.info('Pre-flight check passed - issue may have resolved itself', { incidentId });
        // Issue resolved itself - update and exit
        await stateManager.transitionStage(incidentId, RedisStateManager.STAGES.RESOLVED, {
          resolution: 'self_healed',
          resolved_at: new Date().toISOString(),
        });
        return;
      }

      // Create Coder workspace
      const workspace = await coderClient.createWorkspace(incidentId, {
        SERVICE_NAME: incidentState.service_name || '',
        INCIDENT_TITLE: incidentState.title || '',
      });

      if (!workspace) {
        throw new Error('Failed to create workspace');
      }

      await stateManager.updateIncidentState(incidentId, {
        coder_workspace_id: workspace.workspaceId,
        coder_workspace_name: workspace.name,
      });

      // Wait for workspace to be ready
      const ready = await coderClient.waitForWorkspace(workspace.name);
      if (!ready) {
        throw new Error('Workspace failed to become ready');
      }

      // Execute the remediation code
      const execResult = await coderClient.executeInWorkspace(
        workspace.name,
        incidentState.remediation_code,
        'python' // Default to Python
      );

      // Update state with execution results
      await stateManager.updateIncidentState(incidentId, {
        execution_result: execResult,
        execution_exit_code: execResult?.exitCode,
        executed_at: new Date().toISOString(),
      });

      // Check execution result
      if (execResult && execResult.exitCode === 0) {
        // Proceed to verification
        await this.verifyRemediation(incidentId);
      } else {
        // Execution failed
        logger.error('Remediation execution failed', {
          incidentId,
          exitCode: execResult?.exitCode,
          stderr: execResult?.stderr,
        });

        await stateManager.transitionStage(incidentId, RedisStateManager.STAGES.ESCALATED, {
          error: 'Execution failed with exit code ' + execResult?.exitCode,
          stderr: execResult?.stderr,
        });
      }

      // Cleanup workspace
      await coderClient.deleteWorkspace(workspace.name);
    } catch (error) {
      logger.error('Remediation execution error', {
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
   * Run pre-flight check to verify issue exists
   */
  async runPreFlightCheck(incidentState) {
    // This would check the service's health endpoint
    // Stream B will implement the specific health check logic
    const healthUrl = incidentState.health_check_url;
    if (!healthUrl) {
      return null; // Skip if no URL configured
    }

    return await lightpandaClient.healthCheck(healthUrl, {
      expectedStatus: 200,
      timeout: 10000,
    });
  }

  /**
   * Verify remediation worked
   * This is the validation after "Act"
   */
  async verifyRemediation(incidentId) {
    try {
      logger.info('Verifying remediation', { incidentId });

      await stateManager.transitionStage(incidentId, RedisStateManager.STAGES.VERIFYING);

      const incidentState = await stateManager.getIncidentState(incidentId);

      // Run post-remediation health check
      const healthUrl = incidentState.health_check_url;
      let verification = { success: true }; // Default to success if no URL

      if (healthUrl) {
        verification = await lightpandaClient.healthCheck(healthUrl, {
          expectedStatus: 200,
          timeout: 30000,
        });
      }

      await stateManager.updateIncidentState(incidentId, {
        verification_status: verification.success ? 'passed' : 'failed',
        verification_result: verification,
        verified_at: new Date().toISOString(),
      });

      if (verification.success) {
        // Success! Resolve the incident
        logger.info('Remediation verified successfully', { incidentId });

        await stateManager.transitionStage(incidentId, RedisStateManager.STAGES.RESOLVED, {
          resolution: 'auto_remediated',
          resolved_at: new Date().toISOString(),
        });

        // Add note to PagerDuty
        await pagerdutyClient.addNote(
          incidentId,
          `Self-Healing Engine successfully remediated this incident.\n\n` +
          `Root Cause: ${incidentState.cleric_root_cause || incidentState.cleric_hypothesis}\n` +
          `Action Taken: Automated remediation executed\n` +
          `Verification: Passed`
        );

        // Optionally resolve in PagerDuty
        // await pagerdutyClient.resolveIncident(incidentId);
      } else {
        // Verification failed
        logger.warn('Remediation verification failed', { incidentId });

        await stateManager.transitionStage(incidentId, RedisStateManager.STAGES.ESCALATED, {
          error: 'Verification failed after remediation',
          verification_result: verification,
        });

        await pagerdutyClient.addNote(
          incidentId,
          `Self-Healing Engine attempted remediation but verification failed.\n` +
          `Manual intervention required.`
        );
      }
    } catch (error) {
      logger.error('Verification error', {
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
   * Handle incident resolution (for learning)
   * Ingest successful resolutions into Senso
   */
  async handleResolution(incidentId, incidentState) {
    try {
      // Only ingest auto-remediated incidents after stability period
      if (incidentState.resolution !== 'auto_remediated') {
        return;
      }

      // Schedule delayed ingestion (24 hours)
      // In production, this would use a job queue
      logger.info('Scheduling post-incident learning', { incidentId });

      // For now, log what would be ingested
      const learningRecord = {
        incident_id: incidentId,
        title: incidentState.title,
        service: incidentState.service_name,
        root_cause: incidentState.cleric_root_cause,
        hypothesis: incidentState.cleric_hypothesis,
        remediation_code: incidentState.remediation_code,
        resolution: incidentState.resolution,
        resolved_at: incidentState.resolved_at,
      };

      logger.debug('Learning record prepared', learningRecord);

      // In production: schedule job to ingest after 24h stability check
      // await jobQueue.schedule('ingest_learning', learningRecord, { delay: 86400000 });
    } catch (error) {
      logger.error('Failed to handle resolution', {
        error: error.message,
        incidentId,
      });
    }
  }

  /**
   * Get status of all active incidents
   */
  async getActiveIncidentsStatus() {
    const incidents = await stateManager.getActiveIncidents();
    return incidents.map(i => ({
      id: i.incident_id,
      title: i.title,
      stage: i.current_stage,
      service: i.service_name,
      updatedAt: i.updated_at,
    }));
  }
}

export const orchestrator = new Orchestrator();
export default orchestrator;
