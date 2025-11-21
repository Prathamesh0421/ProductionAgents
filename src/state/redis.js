import Redis from 'ioredis';
import config from '../config/index.js';
import logger from '../utils/logger.js';

/**
 * Redis State Manager for Incident Context
 * Stores: incident_id, current_stage, cleric_hypothesis, senso_context
 */

class RedisStateManager {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      this.client = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password || undefined,
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        maxRetriesPerRequest: 3,
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        logger.info('Redis connected successfully');
      });

      this.client.on('error', (err) => {
        logger.error('Redis connection error', { error: err.message });
      });

      this.client.on('close', () => {
        this.isConnected = false;
        logger.warn('Redis connection closed');
      });

      // Test connection
      await this.client.ping();
      return true;
    } catch (error) {
      logger.error('Failed to connect to Redis', { error: error.message });
      throw error;
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.quit();
      this.isConnected = false;
    }
  }

  /**
   * Incident State Stages:
   * - TRIGGERED: Initial alert received
   * - INVESTIGATING: Cleric is analyzing
   * - HYPOTHESIS_RECEIVED: Cleric posted findings
   * - CONTEXT_RETRIEVED: Senso lookup complete
   * - SYNTHESIZING: Anthropic generating remediation
   * - EXECUTING: Coder running fix
   * - VERIFYING: Lightpanda checking
   * - RESOLVED: Incident fixed
   * - ESCALATED: Human intervention required
   */
  static STAGES = {
    TRIGGERED: 'TRIGGERED',
    INVESTIGATING: 'INVESTIGATING',
    HYPOTHESIS_RECEIVED: 'HYPOTHESIS_RECEIVED',
    CONTEXT_RETRIEVED: 'CONTEXT_RETRIEVED',
    SYNTHESIZING: 'SYNTHESIZING',
    EXECUTING: 'EXECUTING',
    VERIFYING: 'VERIFYING',
    RESOLVED: 'RESOLVED',
    ESCALATED: 'ESCALATED',
  };

  _getIncidentKey(incidentId) {
    return `incident:${incidentId}`;
  }

  /**
   * Create or update incident state
   */
  async setIncidentState(incidentId, state) {
    const key = this._getIncidentKey(incidentId);
    const data = {
      incident_id: incidentId,
      current_stage: state.current_stage || RedisStateManager.STAGES.TRIGGERED,
      cleric_hypothesis: state.cleric_hypothesis || null,
      cleric_confidence: state.cleric_confidence || null,
      senso_context: state.senso_context || null,
      senso_match_score: state.senso_match_score || null,
      remediation_code: state.remediation_code || null,
      anthropic_reasoning: state.anthropic_reasoning || null,
      coder_workspace_id: state.coder_workspace_id || null,
      verification_status: state.verification_status || null,
      created_at: state.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      alert_payload: state.alert_payload || null,
      service_id: state.service_id || null,
      title: state.title || null,
      urgency: state.urgency || null,
    };

    await this.client.set(key, JSON.stringify(data), 'EX', 86400 * 7); // 7 day TTL
    logger.debug('Incident state saved', { incidentId, stage: data.current_stage });
    return data;
  }

  /**
   * Get incident state
   */
  async getIncidentState(incidentId) {
    const key = this._getIncidentKey(incidentId);
    const data = await this.client.get(key);
    return data ? JSON.parse(data) : null;
  }

  /**
   * Update specific fields of incident state
   */
  async updateIncidentState(incidentId, updates) {
    const current = await this.getIncidentState(incidentId);
    if (!current) {
      throw new Error(`Incident ${incidentId} not found`);
    }
    return this.setIncidentState(incidentId, { ...current, ...updates });
  }

  /**
   * Transition incident to a new stage
   */
  async transitionStage(incidentId, newStage, additionalData = {}) {
    const current = await this.getIncidentState(incidentId);
    if (!current) {
      throw new Error(`Incident ${incidentId} not found`);
    }

    const stageHistory = current.stage_history || [];
    stageHistory.push({
      from: current.current_stage,
      to: newStage,
      timestamp: new Date().toISOString(),
    });

    return this.setIncidentState(incidentId, {
      ...current,
      ...additionalData,
      current_stage: newStage,
      stage_history: stageHistory,
    });
  }

  /**
   * Get all active incidents
   */
  async getActiveIncidents() {
    const keys = await this.client.keys('incident:*');
    const incidents = [];

    for (const key of keys) {
      const data = await this.client.get(key);
      if (data) {
        const incident = JSON.parse(data);
        if (incident.current_stage !== RedisStateManager.STAGES.RESOLVED) {
          incidents.push(incident);
        }
      }
    }

    return incidents;
  }

  /**
   * Delete incident state
   */
  async deleteIncidentState(incidentId) {
    const key = this._getIncidentKey(incidentId);
    await this.client.del(key);
    logger.debug('Incident state deleted', { incidentId });
  }

  /**
   * Store pending human approval
   */
  async setPendingApproval(incidentId, approvalData) {
    const key = `approval:${incidentId}`;
    await this.client.set(key, JSON.stringify({
      ...approvalData,
      requested_at: new Date().toISOString(),
    }), 'EX', 3600); // 1 hour TTL
    return true;
  }

  /**
   * Get pending approval
   */
  async getPendingApproval(incidentId) {
    const key = `approval:${incidentId}`;
    const data = await this.client.get(key);
    return data ? JSON.parse(data) : null;
  }

  /**
   * Clear pending approval
   */
  async clearPendingApproval(incidentId) {
    const key = `approval:${incidentId}`;
    await this.client.del(key);
  }
}

// Singleton instance
export const stateManager = new RedisStateManager();
export default stateManager;
