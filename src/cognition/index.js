/**
 * Stream B: Cognition & Memory Module
 *
 * The "Brain" of the Self-Healing DevOps Engine
 * - Senso Knowledge Pipeline (B.1)
 * - Anthropic Reasoning Prompts (B.2)
 * - Lightpanda Verification Library (B.3)
 */

// Ingestion Pipeline
export { RunbookIngester } from './ingestion/runbook-ingester.js';
export { IncidentLearner, createLearningScheduler } from './ingestion/incident-learner.js';
export {
  MetadataSchema,
  validateMetadata,
  buildRunbookMetadata,
  buildIncidentMetadata,
  DocumentTypes,
  SeverityLevels,
  FailureTypes,
} from './ingestion/schema.js';

// Prompt Engineering
export { SystemPrompts, getSystemPrompt } from './prompts/system-prompts.js';
export { RemediationPromptBuilder, buildDiagnosisPrompt } from './prompts/remediation-prompt.js';
export { EdgeCaseHandler, EdgeCaseTypes, requiresHumanReview } from './prompts/edge-cases.js';

// Verification Library
export {
  HealthCheckLibrary,
  HealthCheck,
  EndpointHealthCheck,
  APIHealthCheck,
  FormHealthCheck,
  PerformanceHealthCheck,
  DefaultHealthChecks,
} from './verification/health-checks.js';
export { UserJourneyRunner, UserJourney, JourneyTemplates, StepTypes } from './verification/user-journeys.js';
export { VerificationSwarm, quickSwarm, GeoSwarm } from './verification/swarm.js';

// Enhanced Services
export { EnhancedSensoClient, enhancedSensoClient } from './services/enhanced-senso.js';
export { EnhancedAnthropicClient, enhancedAnthropicClient } from './services/enhanced-anthropic.js';
export { EnhancedLightpandaClient, enhancedLightpandaClient } from './services/enhanced-lightpanda.js';

// Integration
export {
  EnhancedOrchestrator,
  createEnhancedOrchestrator,
  enhancedOrchestrator,
} from './integration/enhanced-orchestrator.js';
