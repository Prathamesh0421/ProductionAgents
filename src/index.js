import express from 'express';
import config from './config/index.js';
import logger from './utils/logger.js';
import stateManager from './state/redis.js';
import pagerdutyHandler from './webhooks/pagerduty.js';
import slackHandler from './webhooks/slack.js';
import orchestrator from './services/orchestrator.js';

/**
 * Self-Healing DevOps Engine - Orchestration Control Plane (OCP)
 *
 * The central nervous system that coordinates:
 * - PagerDuty webhooks for incident triggers
 * - Hypothesis parsing
 * - Sanity context retrieval
 * - Anthropic remediation synthesis
 * - Coder sandbox execution
 * - Lightpanda verification
 *
 * Stream A: Signal & Control
 */

const app = express();

// Middleware to capture raw body for signature verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  },
}));

// URL-encoded for Slack interactions
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ocp',
    timestamp: new Date().toISOString(),
    redis: stateManager.isConnected ? 'connected' : 'disconnected',
  });
});

// PagerDuty webhook endpoint
app.post('/webhooks/pagerduty', pagerdutyHandler.getMiddleware());

// Slack interaction endpoint
app.post('/webhooks/slack/interactions', slackHandler.getMiddleware());

// Status endpoint for active incidents
app.get('/status/incidents', async (req, res) => {
  try {
    const incidents = await orchestrator.getActiveIncidentsStatus();
    res.json({ incidents });
  } catch (error) {
    logger.error('Failed to get incident status', { error: error.message });
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// Get specific incident state
app.get('/status/incidents/:id', async (req, res) => {
  try {
    const incident = await stateManager.getIncidentState(req.params.id);
    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }
    res.json({ incident });
  } catch (error) {
    logger.error('Failed to get incident', { error: error.message });
    res.status(500).json({ error: 'Failed to get incident' });
  }
});

// Manual trigger endpoint (for testing)
app.post('/debug/trigger', async (req, res) => {
  if (config.server.env === 'production') {
    return res.status(403).json({ error: 'Not available in production' });
  }

  try {
    const { incidentId, hypothesis, confidence } = req.body;

    if (!incidentId || !hypothesis) {
      return res.status(400).json({ error: 'incidentId and hypothesis required' });
    }

    // Create mock incident
    await stateManager.setIncidentState(incidentId, {
      current_stage: 'HYPOTHESIS_RECEIVED',
      title: 'Debug incident',
      hypothesis: hypothesis,
      hypothesis_confidence: confidence || 85,
    });

    // Trigger processing
    const parsedHypothesis = {
      hypothesis,
      confidence: confidence || 85,
      rootCause: hypothesis,
      affectedServices: [],
    };

    await orchestrator.processHypothesis(incidentId, parsedHypothesis, hypothesis);

    res.json({ status: 'processing', incidentId });
  } catch (error) {
    logger.error('Debug trigger failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Debug approve endpoint (for testing without Slack)
app.post('/debug/approve', async (req, res) => {
  if (config.server.env === 'production') {
    return res.status(403).json({ error: 'Not available in production' });
  }

  try {
    const { incidentId } = req.body;
    if (!incidentId) {
      return res.status(400).json({ error: 'incidentId required' });
    }

    // Update state to approved
    await stateManager.updateIncidentState(incidentId, {
      human_approved: true,
      approved_by: 'debug-user',
      approved_at: new Date().toISOString(),
    });

    // Continue to execution
    await orchestrator.executeRemediation(incidentId);

    res.json({ status: 'approved', incidentId });
  } catch (error) {
    logger.error('Debug approve failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Metrics endpoint (basic)
app.get('/metrics', async (req, res) => {
  try {
    const incidents = await stateManager.getActiveIncidents();

    const metrics = {
      active_incidents: incidents.length,
      by_stage: {},
      timestamp: new Date().toISOString(),
    };

    for (const incident of incidents) {
      const stage = incident.current_stage || 'UNKNOWN';
      metrics.by_stage[stage] = (metrics.by_stage[stage] || 0) + 1;
    }

    res.json(metrics);
  } catch (error) {
    logger.error('Metrics error', { error: error.message });
    res.status(500).json({ error: 'Failed to get metrics' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const errorCode = err.code || 'INTERNAL_ERROR';
  const message = err.message || 'Internal server error';

  // Log the error
  logger.error('Request failed', {
    error: message,
    code: errorCode,
    statusCode,
    stack: err.stack,
    path: req.path,
    method: req.method,
    requestId: req.headers['x-request-id'],
  });

  // Send response
  res.status(statusCode).json({
    error: message,
    code: errorCode,
    ...(config.server.env === 'development' && { stack: err.stack }),
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Startup sequence
async function start() {
  try {
    logger.info('Starting Orchestration Control Plane (OCP)...');

    // Connect to Redis
    await stateManager.connect();
    logger.info('Redis connected');

    // Start HTTP server
    app.listen(config.server.port, () => {
      logger.info(`OCP listening on port ${config.server.port}`);
      logger.info(`Environment: ${config.server.env}`);
      logger.info('Webhook endpoints:');
      logger.info(`  POST /webhooks/pagerduty`);
      logger.info(`  POST /webhooks/slack/interactions`);
      logger.info('Status endpoints:');
      logger.info(`  GET  /health`);
      logger.info(`  GET  /status/incidents`);
      logger.info(`  GET  /metrics`);
    });
  } catch (error) {
    logger.error('Failed to start OCP', { error: error.message });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down...');
  await stateManager.disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down...');
  await stateManager.disconnect();
  process.exit(0);
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason });
});

// Start the server
start();

export default app;
