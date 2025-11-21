/**
 * Metadata Schema for Senso Knowledge Base
 *
 * Defines the structure for runbook tagging and incident records
 * Optimized for RAG retrieval and semantic search
 */

/**
 * Document types supported by the knowledge pipeline
 */
export const DocumentTypes = {
  RUNBOOK: 'runbook',
  INCIDENT_RECORD: 'incident_record',
  POST_MORTEM: 'post_mortem',
  ARCHITECTURE_DOC: 'architecture_doc',
  SOP: 'standard_operating_procedure',
  TROUBLESHOOTING_GUIDE: 'troubleshooting_guide',
};

/**
 * Severity levels for incidents and runbooks
 */
export const SeverityLevels = {
  SEV1: 'sev1', // Critical - total service outage
  SEV2: 'sev2', // Major - significant degradation
  SEV3: 'sev3', // Minor - limited impact
  SEV4: 'sev4', // Low - minimal/no user impact
};

/**
 * Failure type taxonomy for precise retrieval
 */
export const FailureTypes = {
  // Infrastructure
  CPU_SATURATION: 'cpu_saturation',
  MEMORY_EXHAUSTION: 'memory_exhaustion',
  DISK_FULL: 'disk_full',
  NETWORK_PARTITION: 'network_partition',
  DNS_FAILURE: 'dns_failure',

  // Database
  DATABASE_CONNECTION_POOL: 'database_connection_pool',
  DATABASE_DEADLOCK: 'database_deadlock',
  DATABASE_REPLICATION_LAG: 'database_replication_lag',
  SLOW_QUERY: 'slow_query',
  DATABASE_FAILOVER: 'database_failover',

  // Application
  MEMORY_LEAK: 'memory_leak',
  THREAD_STARVATION: 'thread_starvation',
  CIRCUIT_BREAKER_OPEN: 'circuit_breaker_open',
  RATE_LIMITING: 'rate_limiting',
  DEPENDENCY_TIMEOUT: 'dependency_timeout',

  // External
  THIRD_PARTY_OUTAGE: 'third_party_outage',
  CDN_FAILURE: 'cdn_failure',
  CERTIFICATE_EXPIRY: 'certificate_expiry',

  // Security
  DDOS_ATTACK: 'ddos_attack',
  AUTHENTICATION_FAILURE: 'authentication_failure',

  // Deployment
  BAD_DEPLOY: 'bad_deploy',
  CONFIG_DRIFT: 'config_drift',
  FEATURE_FLAG_ISSUE: 'feature_flag_issue',
};

/**
 * Metadata schema definition
 */
export const MetadataSchema = {
  // Required fields
  required: ['type', 'title', 'service'],

  // Field definitions
  fields: {
    // Document identification
    type: {
      type: 'string',
      enum: Object.values(DocumentTypes),
      description: 'Type of document',
    },
    title: {
      type: 'string',
      maxLength: 200,
      description: 'Human-readable title',
    },

    // Service tagging (critical for retrieval)
    service: {
      type: 'string',
      pattern: /^[a-z0-9-]+$/,
      description: 'Primary service identifier (e.g., payment-api)',
    },
    related_services: {
      type: 'array',
      items: 'string',
      description: 'Other services this document relates to',
    },

    // Failure classification
    failure_types: {
      type: 'array',
      items: { enum: Object.values(FailureTypes) },
      description: 'Failure types this document addresses',
    },
    severity: {
      type: 'string',
      enum: Object.values(SeverityLevels),
      description: 'Applicable severity level',
    },

    // Execution metadata
    execution_payload: {
      type: 'object',
      description: 'Structured remediation parameters',
      properties: {
        script_type: { type: 'string', enum: ['bash', 'python', 'terraform', 'kubectl'] },
        requires_approval: { type: 'boolean' },
        rollback_available: { type: 'boolean' },
        estimated_duration_seconds: { type: 'number' },
      },
    },

    // Source tracking
    source: {
      type: 'string',
      description: 'Original source (confluence, notion, github)',
    },
    source_url: {
      type: 'string',
      format: 'uri',
      description: 'URL to original document',
    },
    author: {
      type: 'string',
      description: 'Document author or team',
    },

    // Lifecycle
    created_at: {
      type: 'string',
      format: 'date-time',
    },
    updated_at: {
      type: 'string',
      format: 'date-time',
    },
    version: {
      type: 'string',
      description: 'Document version',
    },

    // Effectiveness tracking (for incident records)
    effectiveness: {
      type: 'object',
      properties: {
        resolved_count: { type: 'number' },
        failed_count: { type: 'number' },
        avg_resolution_time_seconds: { type: 'number' },
        last_used: { type: 'string', format: 'date-time' },
      },
    },

    // Search optimization
    keywords: {
      type: 'array',
      items: 'string',
      description: 'Additional search keywords',
    },
    error_patterns: {
      type: 'array',
      items: 'string',
      description: 'Error message patterns this doc addresses',
    },
  },
};

/**
 * Validate metadata against schema
 * @param {object} metadata - Metadata to validate
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateMetadata(metadata) {
  const errors = [];

  // Check required fields
  for (const field of MetadataSchema.required) {
    if (!metadata[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Validate type enum
  if (metadata.type && !Object.values(DocumentTypes).includes(metadata.type)) {
    errors.push(`Invalid document type: ${metadata.type}`);
  }

  // Validate service format
  if (metadata.service && !/^[a-z0-9-]+$/.test(metadata.service)) {
    errors.push(`Invalid service format: ${metadata.service}. Use lowercase alphanumeric with hyphens.`);
  }

  // Validate failure types
  if (metadata.failure_types) {
    for (const ft of metadata.failure_types) {
      if (!Object.values(FailureTypes).includes(ft)) {
        errors.push(`Invalid failure type: ${ft}`);
      }
    }
  }

  // Validate severity
  if (metadata.severity && !Object.values(SeverityLevels).includes(metadata.severity)) {
    errors.push(`Invalid severity: ${metadata.severity}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Build metadata for a runbook
 */
export function buildRunbookMetadata(options) {
  const metadata = {
    type: DocumentTypes.RUNBOOK,
    title: options.title,
    service: options.service,
    related_services: options.relatedServices || [],
    failure_types: options.failureTypes || [],
    severity: options.severity,
    execution_payload: options.executionPayload || null,
    source: options.source || 'manual',
    source_url: options.sourceUrl || null,
    author: options.author || 'unknown',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    version: options.version || '1.0',
    keywords: options.keywords || [],
    error_patterns: options.errorPatterns || [],
  };

  const validation = validateMetadata(metadata);
  if (!validation.valid) {
    throw new Error(`Invalid metadata: ${validation.errors.join(', ')}`);
  }

  return metadata;
}

/**
 * Build metadata for an incident record
 */
export function buildIncidentMetadata(options) {
  const metadata = {
    type: DocumentTypes.INCIDENT_RECORD,
    title: options.title,
    service: options.service,
    related_services: options.relatedServices || [],
    failure_types: options.failureTypes || [],
    severity: options.severity,
    source: 'incident_resolution',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    effectiveness: {
      resolved_count: 1,
      failed_count: 0,
      avg_resolution_time_seconds: options.resolutionTimeSeconds || 0,
      last_used: new Date().toISOString(),
    },
    // Incident-specific fields
    incident_id: options.incidentId,
    root_cause: options.rootCause,
    remediation_applied: options.remediationApplied,
    was_auto_resolved: options.wasAutoResolved || false,
  };

  return metadata;
}

export default {
  DocumentTypes,
  SeverityLevels,
  FailureTypes,
  MetadataSchema,
  validateMetadata,
  buildRunbookMetadata,
  buildIncidentMetadata,
};
