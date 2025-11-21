import axios from 'axios';
import config from '../config/index.js';
import logger from '../utils/logger.js';

/**
 * PagerDuty API Client
 * For making API calls to update incidents
 */

export class PagerDutyClient {
  constructor() {
    this.apiKey = config.pagerduty.apiKey;
    this.client = axios.create({
      baseURL: 'https://api.pagerduty.com',
      headers: {
        'Authorization': `Token token=${this.apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.pagerduty+json;version=2',
      },
      timeout: 30000,
    });
  }

  /**
   * Add a note to an incident
   */
  async addNote(incidentId, content, email = 'self-healing-engine@system.local') {
    if (!this.apiKey) {
      logger.warn('PagerDuty API key not configured');
      return null;
    }

    try {
      const response = await this.client.post(`/incidents/${incidentId}/notes`, {
        note: {
          content,
        },
      }, {
        headers: {
          'From': email,
        },
      });

      logger.info('Note added to incident', { incidentId });
      return response.data;
    } catch (error) {
      logger.error('Failed to add note to incident', {
        error: error.message,
        incidentId,
      });
      throw error;
    }
  }

  /**
   * Resolve an incident
   */
  async resolveIncident(incidentId, email = 'self-healing-engine@system.local') {
    if (!this.apiKey) {
      logger.warn('PagerDuty API key not configured');
      return null;
    }

    try {
      const response = await this.client.put(`/incidents/${incidentId}`, {
        incident: {
          type: 'incident_reference',
          status: 'resolved',
        },
      }, {
        headers: {
          'From': email,
        },
      });

      logger.info('Incident resolved', { incidentId });
      return response.data;
    } catch (error) {
      logger.error('Failed to resolve incident', {
        error: error.message,
        incidentId,
      });
      throw error;
    }
  }

  /**
   * Get incident details
   */
  async getIncident(incidentId) {
    if (!this.apiKey) {
      return null;
    }

    try {
      const response = await this.client.get(`/incidents/${incidentId}`);
      return response.data.incident;
    } catch (error) {
      logger.error('Failed to get incident', {
        error: error.message,
        incidentId,
      });
      throw error;
    }
  }
}

export const pagerdutyClient = new PagerDutyClient();
export default pagerdutyClient;
