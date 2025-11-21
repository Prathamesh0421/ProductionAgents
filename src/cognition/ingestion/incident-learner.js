/**
 * Incident Learner
 *
 * Post-incident learning system that ingests resolved incidents into Senso
 * Implements delayed ingestion (24-hour stability period) to prevent knowledge poisoning
 */

import logger from '../../utils/logger.js';
import { sanityClient } from '../../services/sanity.js';
import { redisClient } from '../../state/redis.js';
import { buildIncidentMetadata, DocumentTypes } from './schema.js';

/**
 * Incident Learner class
 */
export class IncidentLearner {
  constructor(options = {}) {
    this.client = options.client || sanityClient;
    this.redis = options.redis || redisClient;
    this.stabilityPeriodMs = options.stabilityPeriodMs || 24 * 60 * 60 * 1000; // 24 hours default
  }

  /**
   * Schedule an incident for learning after stability period
   * Called immediately after incident resolution
   *
   * @param {object} incidentData - Full incident state from Redis
   */
  async scheduleForLearning(incidentData) {
    const learningRecord = {
      incident_id: incidentData.incident_id,
      scheduled_at: new Date().toISOString(),
      ingest_after: new Date(Date.now() + this.stabilityPeriodMs).toISOString(),
      status: 'pending',
      incident_snapshot: incidentData,
    };

    // Store in Redis with TTL slightly longer than stability period
    const key = `learning:${incidentData.incident_id}`;
    const ttl = Math.ceil(this.stabilityPeriodMs / 1000) + 3600; // + 1 hour buffer

    await this.redis.setex(key, ttl, JSON.stringify(learningRecord));

    logger.info('Incident scheduled for learning', {
      incident_id: incidentData.incident_id,
      ingest_after: learningRecord.ingest_after,
    });

    return learningRecord;
  }

  /**
   * Check if incident re-fired within stability period
   * Called when a new incident triggers for the same service
   *
   * @param {string} service - Service identifier
   * @param {string} failureType - Type of failure
   * @returns {Promise<object|null>} - Previous incident if found
   */
  async checkForRecurrence(service, failureType) {
    // Scan for pending learning records with same service/failure
    const pattern = 'learning:*';
    const keys = await this.redis.keys(pattern);

    for (const key of keys) {
      const data = await this.redis.get(key);
      if (!data) continue;

      const record = JSON.parse(data);
      const snapshot = record.incident_snapshot;

      // Check if same service and failure type
      if (snapshot.service === service) {
        const hypothesis = snapshot.cleric_hypothesis;
        if (hypothesis?.failureTypes?.includes(failureType)) {
          logger.warn('Recurrence detected - marking previous resolution as ineffective', {
            previous_incident: record.incident_id,
            service,
            failureType,
          });

          // Mark as ineffective
          record.status = 'ineffective';
          record.recurrence_detected_at = new Date().toISOString();
          await this.redis.setex(key, 86400, JSON.stringify(record)); // Keep for 24h more

          return record;
        }
      }
    }

    return null;
  }

  /**
   * Process pending learning records
   * Should be called by a scheduled job (e.g., every hour)
   */
  async processPendingLearning() {
    const pattern = 'learning:*';
    const keys = await this.redis.keys(pattern);
    const now = new Date();

    const results = {
      processed: 0,
      ingested: 0,
      skipped_not_ready: 0,
      skipped_ineffective: 0,
      errors: [],
    };

    for (const key of keys) {
      const data = await this.redis.get(key);
      if (!data) continue;

      const record = JSON.parse(data);
      results.processed++;

      // Skip if marked ineffective
      if (record.status === 'ineffective') {
        results.skipped_ineffective++;
        logger.debug('Skipping ineffective resolution', {
          incident_id: record.incident_id,
        });
        continue;
      }

      // Check if stability period has passed
      const ingestAfter = new Date(record.ingest_after);
      if (now < ingestAfter) {
        results.skipped_not_ready++;
        continue;
      }

      // Ingest the incident
      try {
        await this.ingestIncident(record.incident_snapshot);
        results.ingested++;

        // Remove the learning record
        await this.redis.del(key);
      } catch (error) {
        results.errors.push({
          incident_id: record.incident_id,
          error: error.message,
        });
        logger.error('Failed to ingest incident', {
          incident_id: record.incident_id,
          error: error.message,
        });
      }
    }

    logger.info('Processed pending learning records', results);
    return results;
  }

  /**
   * Ingest a resolved incident into Senso
   */
  async ingestIncident(incidentData) {
    const hypothesis = incidentData.cleric_hypothesis || {};

    // Build content from incident data
    const content = this._buildIncidentContent(incidentData);

    // Build metadata
    const metadata = buildIncidentMetadata({
      title: `Incident Resolution: ${incidentData.title || incidentData.incident_id}`,
      service: incidentData.service || hypothesis.affectedServices?.[0] || 'unknown',
      relatedServices: hypothesis.affectedServices || [],
      failureTypes: this._inferFailureTypes(hypothesis),
      severity: this._mapUrgencyToSeverity(incidentData.urgency),
      incidentId: incidentData.incident_id,
      rootCause: hypothesis.rootCause,
      remediationApplied: incidentData.remediation_code,
      wasAutoResolved: !incidentData.required_approval,
      resolutionTimeSeconds: this._calculateResolutionTime(incidentData),
    });

    // Ingest to Sanity
    const result = await this.client.ingestContent(content, metadata);

    logger.info('Incident ingested for learning', {
      incident_id: incidentData.incident_id,
      sanity_id: result?.id,
    });

    return result;
  }

  /**
   * Build incident content for ingestion
   */
  _buildIncidentContent(incidentData) {
    const hypothesis = incidentData.cleric_hypothesis || {};
    const parts = [];

    parts.push(`# Incident Resolution Record`);
    parts.push(`## Incident: ${incidentData.title || incidentData.incident_id}`);
    parts.push('');

    parts.push('## Summary');
    parts.push(`- **Service:** ${incidentData.service || 'Unknown'}`);
    parts.push(`- **Triggered:** ${incidentData.triggered_at}`);
    parts.push(`- **Resolved:** ${incidentData.resolved_at || 'Unknown'}`);
    parts.push(`- **Auto-Resolved:** ${incidentData.required_approval ? 'No (required approval)' : 'Yes'}`);
    parts.push('');

    if (hypothesis.rootCause) {
      parts.push('## Root Cause');
      parts.push(hypothesis.rootCause);
      parts.push('');
    }

    if (hypothesis.hypothesis) {
      parts.push('## Investigation Findings');
      parts.push(hypothesis.hypothesis);
      parts.push('');
    }

    if (incidentData.sanity_context) {
      parts.push('## Runbooks Referenced');
      const runbooks = incidentData.sanity_context || [];
      for (const rb of runbooks) {
        parts.push(`- ${rb.title} (score: ${(rb.score * 100).toFixed(1)}%)`);
      }
      parts.push('');
    }

    if (incidentData.remediation_code) {
      parts.push('## Remediation Applied');
      parts.push('```');
      parts.push(incidentData.remediation_code);
      parts.push('```');
      parts.push('');
    }

    if (incidentData.anthropic_reasoning) {
      parts.push('## AI Reasoning');
      // Truncate if too long
      const reasoning = incidentData.anthropic_reasoning.substring(0, 2000);
      parts.push(reasoning);
      if (incidentData.anthropic_reasoning.length > 2000) {
        parts.push('... [truncated]');
      }
      parts.push('');
    }

    parts.push('## Verification');
    parts.push(`- Pre-remediation status: ${incidentData.pre_verification_status || 'Unknown'}`);
    parts.push(`- Post-remediation status: ${incidentData.post_verification_status || 'Unknown'}`);

    return parts.join('\n');
  }

  /**
   * Infer failure types from hypothesis
   */
  _inferFailureTypes(hypothesis) {
    const types = [];
    const text = JSON.stringify(hypothesis).toLowerCase();

    // Pattern matching for common failure types
    const patterns = {
      slow_query: /slow.?query|query.?lock|sql.?timeout/,
      database_deadlock: /deadlock|lock.?wait|blocking.?query/,
      memory_exhaustion: /out.?of.?memory|oom|memory.?exhausted/,
      cpu_saturation: /cpu.?saturat|high.?cpu|cpu.?spike/,
      memory_leak: /memory.?leak|growing.?heap/,
      dependency_timeout: /timeout|connection.?refused|upstream/,
      circuit_breaker_open: /circuit.?breaker|circuit.?open/,
      database_connection_pool: /connection.?pool|pool.?exhausted/,
    };

    for (const [type, pattern] of Object.entries(patterns)) {
      if (pattern.test(text)) {
        types.push(type);
      }
    }

    return types;
  }

  /**
   * Map PagerDuty urgency to severity
   */
  _mapUrgencyToSeverity(urgency) {
    const map = {
      high: 'sev1',
      low: 'sev3',
    };
    return map[urgency] || 'sev2';
  }

  /**
   * Calculate resolution time in seconds
   */
  _calculateResolutionTime(incidentData) {
    if (!incidentData.triggered_at || !incidentData.resolved_at) {
      return 0;
    }

    const triggered = new Date(incidentData.triggered_at);
    const resolved = new Date(incidentData.resolved_at);
    return Math.round((resolved - triggered) / 1000);
  }
}

/**
 * Create a scheduled job runner for processing pending learning
 */
export function createLearningScheduler(options = {}) {
  const learner = new IncidentLearner(options);
  const intervalMs = options.intervalMs || 60 * 60 * 1000; // 1 hour default

  let intervalId = null;

  return {
    start() {
      logger.info('Starting incident learning scheduler', {
        intervalMs,
        stabilityPeriodMs: learner.stabilityPeriodMs,
      });

      // Run immediately
      learner.processPendingLearning().catch(err => {
        logger.error('Learning scheduler error', { error: err.message });
      });

      // Then on interval
      intervalId = setInterval(() => {
        learner.processPendingLearning().catch(err => {
          logger.error('Learning scheduler error', { error: err.message });
        });
      }, intervalMs);
    },

    stop() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        logger.info('Stopped incident learning scheduler');
      }
    },

    // Expose learner for direct use
    learner,
  };
}

export default IncidentLearner;
