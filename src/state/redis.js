import Redis from 'ioredis';
import config from '../config/index.js';
import logger from '../utils/logger.js';

/**
 * Redis State Manager for Incident Context
 * Stores: incident_id, current_stage, cleric_hypothesis, senso_context
 */

export class RedisStateManager {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.useMemory = false;
    this.memoryStore = new Map();
  }

  async connect() {
    try {
      this.client = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password || undefined,
        retryStrategy: (times) => {
          if (times > 3) return null; // Stop retrying
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        maxRetriesPerRequest: 1,
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        this.useMemory = false;
        logger.info('Redis connected successfully');
      });

      this.client.on('error', (err) => {
        // logger.error('Redis connection error', { error: err.message });
        // Silence detailed errors during connection attempts to avoid noise if we fallback
      });

      // Wait for connection or failure
      await new Promise((resolve, reject) => {
          this.client.once('connect', resolve);
          this.client.once('error', (err) => {
              // If initial connection fails, we fallback
              reject(err);
          });
          // Timeout fallback
          setTimeout(() => reject(new Error('Timeout')), 2000);
      });

      return true;
    } catch (error) {
      logger.warn('Failed to connect to Redis, using in-memory fallback', { error: error.message });
      this.useMemory = true;
      this.isConnected = true; // We are "connected" to the memory store
      return true;
    }
  }

  async disconnect() {
    if (this.client && !this.useMemory) {
      await this.client.quit();
    }
    this.isConnected = false;
  }

  /**
   * Incident State Stages:
   * - TRIGGERED: Initial alert received
   * - INVESTIGATING: Analysis in progress
   * - HYPOTHESIS_RECEIVED: Hypothesis generated
   * - CONTEXT_RETRIEVED: Context lookup complete
   * - SYNTHESIZING: Remediation generation
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
      hypothesis: state.hypothesis || null,
      hypothesis_confidence: state.hypothesis_confidence || null,
      context: state.context || state.sanity_context || null,
      context_match_score: state.context_match_score || null,
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

    if (this.useMemory) {
      this.memoryStore.set(key, JSON.stringify(data));
      logger.debug('Incident state saved (memory)', { incidentId, stage: data.current_stage });
    } else {
      await this.client.set(key, JSON.stringify(data), 'EX', 86400 * 7); // 7 day TTL
      logger.debug('Incident state saved', { incidentId, stage: data.current_stage });
    }
    return data;
  }

  /**
   * Get incident state
   */
  async getIncidentState(incidentId) {
    const key = this._getIncidentKey(incidentId);
    let data;
    if (this.useMemory) {
      data = this.memoryStore.get(key);
    } else {
      data = await this.client.get(key);
    }
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
    const incidents = [];

    if (this.useMemory) {
      for (const [key, data] of this.memoryStore.entries()) {
        if (key.startsWith('incident:')) {
          const incident = JSON.parse(data);
          if (incident.current_stage !== RedisStateManager.STAGES.RESOLVED) {
            incidents.push(incident);
          }
        }
      }
    } else {
      const keys = await this.client.keys('incident:*');
      for (const key of keys) {
        const data = await this.client.get(key);
        if (data) {
          const incident = JSON.parse(data);
          if (incident.current_stage !== RedisStateManager.STAGES.RESOLVED) {
            incidents.push(incident);
          }
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
    if (this.useMemory) {
      this.memoryStore.delete(key);
    } else {
      await this.client.del(key);
    }
    logger.debug('Incident state deleted', { incidentId });
  }

  /**
   * Store pending human approval
   */
  async setPendingApproval(incidentId, approvalData) {
    const key = `approval:${incidentId}`;
    const data = JSON.stringify({
      ...approvalData,
      requested_at: new Date().toISOString(),
    });

    if (this.useMemory) {
      this.memoryStore.set(key, data);
    } else {
      await this.client.set(key, data, 'EX', 3600); // 1 hour TTL
    }
    return true;
  }

  /**
   * Get pending approval
   */
  async getPendingApproval(incidentId) {
    const key = `approval:${incidentId}`;
    let data;
    if (this.useMemory) {
      data = this.memoryStore.get(key);
    } else {
      data = await this.client.get(key);
    }
    return data ? JSON.parse(data) : null;
  }

  /**
   * Clear pending approval
   */
  async clearPendingApproval(incidentId) {
    const key = `approval:${incidentId}`;
    if (this.useMemory) {
      this.memoryStore.delete(key);
    } else {
      await this.client.del(key);
    }
  }
}

// Singleton instance
export const stateManager = new RedisStateManager();
export default stateManager;
