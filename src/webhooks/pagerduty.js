import crypto from 'crypto';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import stateManager, { RedisStateManager } from '../state/redis.js';
import clericParser from '../parsers/cleric.js';
import { orchestrator } from '../services/orchestrator.js';

/**
 * PagerDuty Webhook Handler
 * Handles incident.trigger and incident.annotate events
 * Implements signature verification for security
 */

export class PagerDutyWebhookHandler {
  constructor() {
    this.webhookSecret = config.pagerduty.webhookSecret;
  }

  /**
   * Verify PagerDuty webhook signature (v3 webhooks)
   * PagerDuty uses HMAC-SHA256 for webhook signing
   */
  verifySignature(payload, signature) {
    if (!this.webhookSecret) {
      logger.warn('PagerDuty webhook secret not configured - skipping verification');
      return true; // Allow in development
    }

    if (!signature) {
      logger.error('Missing webhook signature');
      return false;
    }

    try {
      // PagerDuty v3 webhook signature format
      const expectedSignature = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(payload, 'utf8')
        .digest('hex');

      // Compare signatures (timing-safe comparison)
      const signatureBuffer = Buffer.from(signature.replace('v1=', ''), 'hex');
      const expectedBuffer = Buffer.from(expectedSignature, 'hex');

      if (signatureBuffer.length !== expectedBuffer.length) {
        return false;
      }

      return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
    } catch (error) {
      logger.error('Signature verification failed', { error: error.message });
      return false;
    }
  }

  /**
   * Main webhook handler - Express middleware
   */
  getMiddleware() {
    return async (req, res) => {
      const rawBody = req.rawBody || JSON.stringify(req.body);
      const signature = req.headers['x-pagerduty-signature'];

      // Verify signature
      if (!this.verifySignature(rawBody, signature)) {
        logger.warn('Invalid webhook signature', {
          ip: req.ip,
          path: req.path,
        });
        return res.status(401).json({ error: 'Invalid signature' });
      }

      try {
        const payload = req.body;

        // PagerDuty v3 webhook structure
        if (!payload.event || !payload.event.event_type) {
          logger.warn('Invalid webhook payload structure');
          return res.status(400).json({ error: 'Invalid payload' });
        }

        const eventType = payload.event.event_type;
        const eventData = payload.event.data;

        logger.info('PagerDuty webhook received', {
          eventType,
          incidentId: eventData?.id,
        });

        // Route to appropriate handler
        switch (eventType) {
          case 'incident.triggered':
            await this.handleIncidentTriggered(eventData, payload);
            break;

          case 'incident.annotated':
            await this.handleIncidentAnnotated(eventData, payload);
            break;

          case 'incident.resolved':
            await this.handleIncidentResolved(eventData, payload);
            break;

          case 'incident.acknowledged':
            await this.handleIncidentAcknowledged(eventData, payload);
            break;

          case 'incident.escalated':
            await this.handleIncidentEscalated(eventData, payload);
            break;

          default:
            logger.debug('Unhandled event type', { eventType });
        }

        res.status(200).json({ received: true });
      } catch (error) {
        logger.error('Webhook processing error', {
          error: error.message,
          stack: error.stack,
        });
        res.status(500).json({ error: 'Internal processing error' });
      }
    };
  }

  /**
   * Handle incident.triggered event
   * This is the entry point of the OODA loop
   */
  async handleIncidentTriggered(incident, fullPayload) {
    const incidentId = incident.id;
    const title = incident.title || incident.summary;
    const urgency = incident.urgency;
    const serviceId = incident.service?.id;
    const serviceName = incident.service?.summary;

    logger.info('Incident triggered', {
      incidentId,
      title,
      urgency,
      service: serviceName,
    });

    // Check if we're already tracking this incident
    const existing = await stateManager.getIncidentState(incidentId);
    if (existing) {
      logger.debug('Incident already being tracked', { incidentId });
      return;
    }

    // Create initial incident state
    await stateManager.setIncidentState(incidentId, {
      current_stage: RedisStateManager.STAGES.TRIGGERED,
      incident_id: incidentId,
      title,
      urgency,
      service_id: serviceId,
      service_name: serviceName,
      alert_payload: fullPayload,
      triggered_at: new Date().toISOString(),
    });

    // Transition to INVESTIGATING stage
    // (Cleric will pick up the incident from PagerDuty directly)
    await stateManager.transitionStage(incidentId, RedisStateManager.STAGES.INVESTIGATING);

    logger.info('Incident state initialized, awaiting Cleric investigation', {
      incidentId,
    });
  }

  /**
   * Handle incident.annotated event
   * This is where we receive Cleric's investigation results
   */
  async handleIncidentAnnotated(incident, fullPayload) {
    const incidentId = incident.id;
    const notes = incident.notes || [];

    // Find the latest note
    const latestNote = notes[notes.length - 1];
    if (!latestNote) {
      logger.debug('No notes found in annotation event', { incidentId });
      return;
    }

    // Check if this note is from Cleric
    if (!clericParser.isClericNote(latestNote)) {
      logger.debug('Note is not from Cleric, ignoring', {
        incidentId,
        noteAuthor: latestNote.user?.summary || 'unknown',
      });
      return;
    }

    logger.info('Cleric note detected', { incidentId });

    // Get current incident state
    const incidentState = await stateManager.getIncidentState(incidentId);
    if (!incidentState) {
      // Create state if it doesn't exist (late-join scenario)
      await stateManager.setIncidentState(incidentId, {
        current_stage: RedisStateManager.STAGES.INVESTIGATING,
        incident_id: incidentId,
        title: incident.title || incident.summary,
        triggered_at: new Date().toISOString(),
      });
    }

    // Parse Cleric's note
    const noteContent = latestNote.content;
    const parsedNote = clericParser.parseNote(noteContent);

    if (!parsedNote || !parsedNote.parseSuccess) {
      logger.warn('Failed to parse Cleric note', { incidentId });
      return;
    }

    // Update incident state with Cleric's findings
    await stateManager.transitionStage(
      incidentId,
      RedisStateManager.STAGES.HYPOTHESIS_RECEIVED,
      {
        cleric_hypothesis: parsedNote.hypothesis,
        cleric_confidence: parsedNote.confidence,
        cleric_root_cause: parsedNote.rootCause,
        cleric_recommendation: parsedNote.recommendation,
        cleric_affected_services: parsedNote.affectedServices,
        cleric_raw_note: noteContent,
        cleric_parsed_at: new Date().toISOString(),
      }
    );

    logger.info('Cleric hypothesis received', {
      incidentId,
      confidence: parsedNote.confidence,
      hypothesis: parsedNote.hypothesis?.substring(0, 100),
    });

    // Generate Senso query
    const sensoQuery = clericParser.generateSensoQuery(parsedNote);

    // Trigger the next phase: Context Retrieval
    // This will call Senso API (Stream B) to find relevant runbooks
    await orchestrator.processHypothesis(incidentId, parsedNote, sensoQuery);
  }

  /**
   * Handle incident.resolved event
   */
  async handleIncidentResolved(incident, fullPayload) {
    const incidentId = incident.id;

    logger.info('Incident resolved', { incidentId });

    const incidentState = await stateManager.getIncidentState(incidentId);
    if (!incidentState) {
      return;
    }

    // Mark as resolved
    await stateManager.transitionStage(incidentId, RedisStateManager.STAGES.RESOLVED, {
      resolved_at: new Date().toISOString(),
      resolution_source: 'pagerduty_event',
    });

    // Trigger post-incident processing (e.g., ingest into Senso for learning)
    await orchestrator.handleResolution(incidentId, incidentState);
  }

  /**
   * Handle incident.acknowledged event
   */
  async handleIncidentAcknowledged(incident, fullPayload) {
    const incidentId = incident.id;

    logger.debug('Incident acknowledged', { incidentId });

    const incidentState = await stateManager.getIncidentState(incidentId);
    if (incidentState) {
      await stateManager.updateIncidentState(incidentId, {
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: incident.assignees?.[0]?.summary || 'unknown',
      });
    }
  }

  /**
   * Handle incident.escalated event
   */
  async handleIncidentEscalated(incident, fullPayload) {
    const incidentId = incident.id;

    logger.info('Incident escalated', { incidentId });

    const incidentState = await stateManager.getIncidentState(incidentId);
    if (incidentState) {
      await stateManager.transitionStage(incidentId, RedisStateManager.STAGES.ESCALATED, {
        escalated_at: new Date().toISOString(),
        escalation_policy: incident.escalation_policy?.summary,
      });
    }
  }
}

export const pagerdutyHandler = new PagerDutyWebhookHandler();
export default pagerdutyHandler;
