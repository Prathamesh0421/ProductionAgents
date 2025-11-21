/**
 * Enhanced Sanity Client
 *
 * Extends Stream A's Sanity client with Stream B's knowledge pipeline
 * Replaces EnhancedSensoClient for the refactored architecture
 */

import { sanityClient } from '../../services/sanity.js';
import { RunbookIngester } from '../ingestion/runbook-ingester.js';
import { IncidentLearner, createLearningScheduler } from '../ingestion/incident-learner.js';
import { validateMetadata } from '../ingestion/schema.js';
import logger from '../../utils/logger.js';
import axios from 'axios';
import config from '../../config/index.js';

/**
 * Enhanced Sanity Client with knowledge pipeline capabilities
 */
export class EnhancedSanityClient {
  constructor(options = {}) {
    this.projectId = config.sanity?.projectId;
    this.dataset = config.sanity?.dataset || 'production';
    this.apiVersion = '2023-11-21';
    this.token = config.sanity?.token;

    this.runbookIngester = new RunbookIngester({
      sanityClient: this,
      dryRun: options.dryRun || false,
    });

    this.incidentLearner = new IncidentLearner({
      contextClient: this,
      stabilityPeriodMs: options.stabilityPeriodMs,
    });

    this.learningScheduler = null;
  }

  /**
   * Start the incident learning scheduler
   */
  startLearningScheduler(intervalMs) {
    this.learningScheduler = createLearningScheduler({
      contextClient: this,
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
   * Search for runbooks using GROQ
   */
  async search(query, limit = 5) {
    try {
      const groq = `*[_type == "runbook" && (title match "${query}*" || body match "${query}*")] {
        _id,
        title,
        "content": body,
        service,
        failureTypes,
        severity,
        "score": score(title match "${query}*")
      } | order(score desc)[0...${limit}]`;

      const url = `https://${this.projectId}.api.sanity.io/v${this.apiVersion}/data/query/${this.dataset}`;

      const response = await axios.get(url, {
        params: { query: groq },
        headers: {
          Authorization: `Bearer ${this.token}`
        }
      });

      const results = response.data.result || [];
      const maxScore = results.length > 0 ? 1.0 : 0.0;

      return {
        results: results.map(r => ({
          id: r._id,
          title: r.title,
          content: typeof r.content === 'string' ? r.content : JSON.stringify(r.content),
          score: r.score || 0.5,
          metadata: {
            service: r.service,
            failureTypes: r.failureTypes,
            severity: r.severity,
          },
        })),
        maxScore,
      };
    } catch (error) {
      logger.error('Sanity search failed', { error: error.message });
      return { results: [], maxScore: 0 };
    }
  }

  /**
   * Enhanced search with metadata filtering
   */
  async searchWithFilters(query, filters = {}) {
    try {
      // Build GROQ filter conditions
      let filterConditions = ['_type == "runbook"'];

      if (filters.service) {
        filterConditions.push(`service == "${filters.service}"`);
      }

      if (filters.failureTypes?.length > 0) {
        const ftConditions = filters.failureTypes.map(ft => `"${ft}" in failureTypes`);
        filterConditions.push(`(${ftConditions.join(' || ')})`);
      }

      if (filters.severity) {
        filterConditions.push(`severity == "${filters.severity}"`);
      }

      // Add text search
      filterConditions.push(`(title match "${query}*" || body match "${query}*")`);

      const groq = `*[${filterConditions.join(' && ')}] {
        _id,
        title,
        "content": body,
        service,
        failureTypes,
        severity,
        "score": score(title match "${query}*")
      } | order(score desc)[0...${filters.limit || 5}]`;

      const url = `https://${this.projectId}.api.sanity.io/v${this.apiVersion}/data/query/${this.dataset}`;

      const response = await axios.get(url, {
        params: { query: groq },
        headers: {
          Authorization: `Bearer ${this.token}`
        }
      });

      const results = response.data.result || [];

      return {
        results: results.map(r => ({
          id: r._id,
          title: r.title,
          content: typeof r.content === 'string' ? r.content : JSON.stringify(r.content),
          score: r.score || 0.5,
          metadata: {
            service: r.service,
            failureTypes: r.failureTypes,
            severity: r.severity,
          },
        })),
        maxScore: results.length > 0 ? 1.0 : 0.0,
      };
    } catch (error) {
      logger.error('Sanity filtered search failed', { error: error.message });
      return { results: [], maxScore: 0 };
    }
  }

  /**
   * Ingest content into Sanity
   * Creates a new runbook document
   */
  async ingestContent(text, metadata = {}) {
    try {
      const mutations = [{
        create: {
          _type: 'runbook',
          title: metadata.title || 'Untitled Runbook',
          body: text,
          service: metadata.service,
          failureTypes: metadata.failure_types || [],
          severity: metadata.severity,
          source: metadata.source,
          createdAt: new Date().toISOString(),
          ...metadata,
        }
      }];

      const url = `https://${this.projectId}.api.sanity.io/v${this.apiVersion}/data/mutate/${this.dataset}`;

      const response = await axios.post(url, { mutations }, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        }
      });

      logger.info('Content ingested to Sanity', {
        documentId: response.data.results?.[0]?.id,
      });

      return response.data;
    } catch (error) {
      logger.error('Sanity ingestion failed', { error: error.message });
      throw error;
    }
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
   * Format results for LLM prompt
   */
  formatForPrompt(results) {
    if (!results || results.length === 0) {
      return 'No relevant runbooks found. Use standard SRE practices.';
    }

    return results.map((r, i) =>
      `### Runbook ${i + 1}: ${r.title || 'Untitled'}\n` +
      `- **Service:** ${r.metadata?.service || 'Unknown'}\n` +
      `- **Relevance:** ${((r.score || 0) * 100).toFixed(1)}%\n\n` +
      `${r.content}\n`
    ).join('\n---\n');
  }

  /**
   * Format with enhanced metadata
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
        `- **Failure Types:** ${r.metadata?.failureTypes?.join(', ') || 'Unknown'}`,
        `- **Severity:** ${r.metadata?.severity || 'Unknown'}`,
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
export const enhancedSanityClient = new EnhancedSanityClient();
export default EnhancedSanityClient;
