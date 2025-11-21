import logger from '../utils/logger.js';
import stateManager, { RedisStateManager } from '../state/redis.js';
import { orchestrator } from '../services/orchestrator.js';

/**
 * Slack Webhook Handler
 * Handles approval button interactions for human-in-the-loop
 */

export class SlackWebhookHandler {
  /**
   * Express middleware for Slack interactions
   */
  getMiddleware() {
    return async (req, res) => {
      try {
        // Slack sends payload as form-urlencoded
        const payload = JSON.parse(req.body.payload || '{}');

        if (payload.type !== 'block_actions') {
          return res.status(200).send();
        }

        const action = payload.actions?.[0];
        if (!action) {
          return res.status(200).send();
        }

        const actionId = action.action_id;
        const incidentId = action.value;
        const user = payload.user?.name || payload.user?.username || 'unknown';

        logger.info('Slack action received', {
          actionId,
          incidentId,
          user,
        });

        // Handle approval actions
        if (actionId === 'approve_remediation') {
          await this.handleApproval(incidentId, user, true);
          return res.status(200).json({
            response_type: 'in_channel',
            replace_original: true,
            text: `:white_check_mark: Remediation approved by <@${user}> for incident ${incidentId}`,
          });
        }

        if (actionId === 'reject_remediation') {
          await this.handleApproval(incidentId, user, false);
          return res.status(200).json({
            response_type: 'in_channel',
            replace_original: true,
            text: `:x: Remediation rejected by <@${user}> for incident ${incidentId}`,
          });
        }

        res.status(200).send();
      } catch (error) {
        logger.error('Slack webhook error', { error: error.message });
        res.status(500).json({ error: 'Internal error' });
      }
    };
  }

  /**
   * Handle approval/rejection
   */
  async handleApproval(incidentId, approver, approved) {
    const approval = await stateManager.getPendingApproval(incidentId);
    if (!approval) {
      logger.warn('No pending approval found', { incidentId });
      return;
    }

    await stateManager.clearPendingApproval(incidentId);

    if (approved) {
      // Proceed with execution
      await stateManager.updateIncidentState(incidentId, {
        human_approved: true,
        approved_by: approver,
        approved_at: new Date().toISOString(),
      });

      // Trigger execution
      await orchestrator.executeRemediation(incidentId);
    } else {
      // Mark as escalated
      await stateManager.transitionStage(incidentId, RedisStateManager.STAGES.ESCALATED, {
        human_rejected: true,
        rejected_by: approver,
        rejected_at: new Date().toISOString(),
      });
    }
  }
}

export const slackHandler = new SlackWebhookHandler();
export default slackHandler;
