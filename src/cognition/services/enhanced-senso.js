/**
 * Enhanced Senso Client
 *
 * Extends Stream A's Senso client with Stream B's knowledge pipeline
 */

import { SensoClient } from '../../services/senso.js';
import { RunbookIngester } from '../ingestion/runbook-ingester.js';
import { IncidentLearner, createLearningScheduler } from '../ingestion/incident-learner.js';
import { validateMetadata } from '../ingestion/schema.js';
import logger from '../../utils/logger.js';

/**
 * Enhanced Senso Client with knowledge pipeline capabilities
 */
export class EnhancedSensoClient extends SensoClient {
  constructor(options = {}) {
    super();

    this.runbookIngester = new RunbookIngester({
      sensoClient: this,
      dryRun: options.dryRun || false,
    });

    this.incidentLearner = new IncidentLearner({
      sensoClient: this,
      stabilityPeriodMs: options.stabilityPeriodMs,
    });

    this.learningScheduler = null;
  }

  /**
   * Start the incident learning scheduler
   */
  startLearningScheduler(intervalMs) {
    this.learningScheduler = createLearningScheduler({
      sensoClient: this,
      intervalMs,
    });
    this.learningScheduler.start();
    return this;
  }

  /**
   * Stop the learning scheduler
   */
  stopLearningScheduler() {
    if (this.learningScheduler) {
      this.learningScheduler.stop();
    }
    return this;
  }

  /**
   * Enhanced search with metadata filtering
   *
   * @param {string} query - Search query
   * @param {object} filters - Metadata filters
   * @returns {Promise<{results: Array, maxScore: number}>}
   */
  async searchWithFilters(query, filters = {}) {
    // Build enhanced query with filters
    let enhancedQuery = query;

    if (filters.service) {
      enhancedQuery += ` [SERVICE: ${filters.service}]`;
    }

    if (filters.failureTypes?.length > 0) {
      enhancedQuery += ` [FAILURE_TYPES: ${filters.failureTypes.join(', ')}]`;
    }

    if (filters.severity) {
      enhancedQuery += ` [SEVERITY: ${filters.severity}]`;
    }

    const results = await this.search(enhancedQuery, filters.limit || 5);

    // Post-filter by metadata if needed
    if (filters.strict && results.results.length > 0) {
      results.results = results.results.filter(r => {
        if (filters.service && r.metadata?.service !== filters.service) {
          return false;
        }
        if (filters.type && r.metadata?.type !== filters.type) {
          return false;
        }
        return true;
      });

      // Recalculate max score
      results.maxScore = results.results.reduce(
        (max, r) => Math.max(max, r.score || 0),
        0
      );
    }

    return results;
  }

  /**
   * Ingest a runbook file
   */
  async ingestRunbook(filePath) {
    return this.runbookIngester.ingestMarkdownFile(filePath);
  }

  /**
   * Ingest a directory of runbooks
   */
  async ingestRunbookDirectory(dirPath, options = {}) {
    return this.runbookIngester.ingestDirectory(dirPath, options);
  }

  /**
   * Schedule an incident for learning
   */
  async scheduleIncidentLearning(incidentData) {
    return this.incidentLearner.scheduleForLearning(incidentData);
  }

  /**
   * Check for incident recurrence
   */
  async checkRecurrence(service, failureType) {
    return this.incidentLearner.checkForRecurrence(service, failureType);
  }

  /**
   * Ingest content with validation
   */
  async ingestValidated(text, metadata) {
    const validation = validateMetadata(metadata);

    if (!validation.valid) {
      logger.warn('Invalid metadata for ingestion', {
        errors: validation.errors,
      });
      throw new Error(`Invalid metadata: ${validation.errors.join(', ')}`);
    }

    return this.ingestContent(text, metadata);
  }

  /**
   * Build context prompt from search results
   * Enhanced version with better formatting
   */
  formatForPromptEnhanced(results, options = {}) {
    if (!results || results.length === 0) {
      return options.emptyMessage || 'No relevant runbooks found. Use standard SRE practices.';
    }

    const maxLength = options.maxLength || 4000;
    const parts = [];
    let currentLength = 0;

    for (const [i, r] of results.entries()) {
      const header = `### Runbook ${i + 1}: ${r.title || 'Untitled'}`;
      const meta = [
        `- **Service:** ${r.metadata?.service || 'Unknown'}`,
        `- **Type:** ${r.metadata?.type || 'Unknown'}`,
        `- **Source:** ${r.source || 'Unknown'}`,
        `- **Relevance:** ${((r.score || 0) * 100).toFixed(1)}%`,
      ].join('\n');

      const content = r.content || '_No content available_';

      const entry = `${header}\n${meta}\n\n${content}\n`;

      if (currentLength + entry.length > maxLength) {
        parts.push('\n_Additional runbooks omitted for brevity_');
        break;
      }

      parts.push(entry);
      currentLength += entry.length;

      if (i < results.length - 1) {
        parts.push('\n---\n');
      }
    }

    return parts.join('\n');
  }
}

// Export singleton instance
export const enhancedSensoClient = new EnhancedSensoClient();
export default EnhancedSensoClient;
