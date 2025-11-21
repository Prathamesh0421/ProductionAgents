import { WebClient } from '@slack/web-api';
import config from '../config/index.js';
import logger from '../utils/logger.js';

/**
 * Slack Client
 * Used for human-in-the-loop approval flow
 */

export class SlackClient {
  constructor() {
    this.token = config.slack.botToken;
    this.approvalChannel = config.slack.approvalChannel;
    this.client = this.token ? new WebClient(this.token) : null;
  }

  /**
   * Request human approval for a remediation
   * Posts an interactive message with Approve/Reject buttons
   *
   * @param {string} incidentId - Incident identifier
   * @param {object} details - Remediation details to display
   * @returns {Promise<{messageTs: string, channel: string}>}
   */
  async requestApproval(incidentId, details) {
    if (!this.client) {
      logger.warn('Slack not configured - cannot request approval');
      return null;
    }

    const {
      title,
      hypothesis,
      risk,
      code,
      reasoning,
      serviceName,
    } = details;

    try {
      const response = await this.client.chat.postMessage({
        channel: this.approvalChannel,
        text: `Remediation Approval Required: ${title}`,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: ':warning: Remediation Approval Required',
              emoji: true,
            },
          },
          {
            type: 'section',
            fields: [
              {
                type: 'mrkdwn',
                text: `*Incident ID:*\n${incidentId}`,
              },
              {
                type: 'mrkdwn',
                text: `*Service:*\n${serviceName || 'Unknown'}`,
              },
              {
                type: 'mrkdwn',
                text: `*Risk Level:*\n${risk || 'Unknown'}`,
              },
              {
                type: 'mrkdwn',
                text: `*Title:*\n${title || 'Untitled'}`,
              },
            ],
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Hypothesis:*\n${hypothesis?.substring(0, 500) || 'No hypothesis available'}`,
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Reasoning:*\n${reasoning?.substring(0, 500) || 'No reasoning available'}`,
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Proposed Remediation Code:*\n\`\`\`${code?.substring(0, 1000) || 'No code generated'}\`\`\``,
            },
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: ':white_check_mark: Approve',
                  emoji: true,
                },
                style: 'primary',
                action_id: 'approve_remediation',
                value: incidentId,
              },
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: ':x: Reject',
                  emoji: true,
                },
                style: 'danger',
                action_id: 'reject_remediation',
                value: incidentId,
              },
            ],
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: 'Self-Healing DevOps Engine | Human approval required due to low confidence or high risk',
              },
            ],
          },
        ],
      });

      logger.info('Approval request sent to Slack', {
        incidentId,
        channel: this.approvalChannel,
        messageTs: response.ts,
      });

      return {
        messageTs: response.ts,
        channel: response.channel,
      };
    } catch (error) {
      logger.error('Failed to send Slack approval request', {
        error: error.message,
        incidentId,
      });
      throw error;
    }
  }

  /**
   * Send a notification about incident status
   */
  async sendNotification(channel, message, blocks = null) {
    if (!this.client) {
      logger.warn('Slack not configured');
      return null;
    }

    try {
      const response = await this.client.chat.postMessage({
        channel: channel || this.approvalChannel,
        text: message,
        blocks,
      });

      return response;
    } catch (error) {
      logger.error('Failed to send Slack notification', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Update an existing message (e.g., after approval)
   */
  async updateMessage(channel, ts, text, blocks = null) {
    if (!this.client) {
      return null;
    }

    try {
      const response = await this.client.chat.update({
        channel,
        ts,
        text,
        blocks,
      });

      return response;
    } catch (error) {
      logger.error('Failed to update Slack message', {
        error: error.message,
      });
      throw error;
    }
  }
}

export const slackClient = new SlackClient();
export default slackClient;
