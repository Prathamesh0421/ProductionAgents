/**
 * Stream B: Cognition & Memory Module
 *
 * The "Brain" of the Self-Healing DevOps Engine
 * - Sanity Knowledge Pipeline (B.1) - Context retrieval via Sanity CMS
 * - AI Reasoning Prompts (B.2) - Chain-of-Thought with Anthropic/Gemini
 * - Lightpanda Verification Library (B.3) - High-velocity synthetic testing
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

// Enhanced Services (updated for refactored architecture)
export { EnhancedSanityClient, enhancedSanityClient } from './services/enhanced-sanity.js';
export { EnhancedAnthropicClient, enhancedAnthropicClient } from './services/enhanced-anthropic.js';
export { EnhancedLightpandaClient, enhancedLightpandaClient } from './services/enhanced-lightpanda.js';

// Integration
export {
  EnhancedOrchestrator,
  createEnhancedOrchestrator,
  enhancedOrchestrator,
} from './integration/enhanced-orchestrator.js';
