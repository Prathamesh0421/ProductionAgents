import axios from 'axios';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import { ConfigurationError, ExternalServiceError } from '../utils/errors.js';

/**
 * Senso API Client
 * Context OS for retrieving runbooks and verified knowledge
 *
 * DEPENDENCY: Stream B will implement the full knowledge pipeline
 * Stream A provides the interface and basic API calls
 */

export class SensoClient {
  constructor() {
    this.baseUrl = config.senso.apiUrl;
    this.apiKey = config.senso.apiKey;
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  /**
   * Search for relevant context based on query
   * Used in Orient phase to find runbooks matching Cleric's hypothesis
   *
   * @param {string} query - Search query (generated from Cleric note)
   * @param {number} limit - Max results to return
   * @returns {Promise<{results: Array, maxScore: number}>}
   */
  async search(query, limit = 5) {
    if (!this.baseUrl || !this.apiKey) {
      logger.warn('Senso not configured');
      throw new ConfigurationError('Senso API URL or API Key not configured');
    }

    try {
      logger.debug('Senso search request', { query: query.substring(0, 100), limit });

      const response = await this.client.post('/search', {
        query,
        limit,
      });

      const results = response.data.results || [];

      // Calculate max relevance score
      const maxScore = results.reduce((max, r) => Math.max(max, r.score || 0), 0);

      logger.info('Senso search complete', {
        resultCount: results.length,
        maxScore,
      });

      return {
        results: results.map(r => ({
          id: r.id,
          title: r.title || r.metadata?.title,
          content: r.content || r.text,
          score: r.score,
          source: r.source || r.metadata?.source,
          metadata: r.metadata,
        })),
        maxScore,
      };
    } catch (error) {
      logger.error('Senso search failed', {
        error: error.message,
        status: error.response?.status,
      });
      throw error;
    }
  }

  /**
   * Ingest new content into Senso
   * Used after incident resolution to feed back learnings
   *
   * @param {string} text - Content to ingest
   * @param {object} metadata - Metadata tags
   */
  async ingestContent(text, metadata = {}) {
    if (!this.baseUrl || !this.apiKey) {
      logger.warn('Senso not configured - skipping ingestion');
      return null;
    }

    try {
      logger.debug('Senso ingestion request', {
        textLength: text.length,
        metadata,
      });

      const response = await this.client.post('/content/raw_text', {
        text,
        metadata,
      });

      logger.info('Senso ingestion complete', {
        id: response.data.id,
      });

      return response.data;
    } catch (error) {
      logger.error('Senso ingestion failed', {
        error: error.message,
        status: error.response?.status,
      });
      throw error;
    }
  }

  /**
   * Format Senso results for Anthropic prompt
   */
  formatForPrompt(results) {
    if (!results || results.length === 0) {
      return 'No relevant runbooks found.';
    }

    return results.map((r, i) =>
      `### Runbook ${i + 1}: ${r.title || 'Untitled'}\n` +
      `Source: ${r.source || 'Unknown'}\n` +
      `Relevance Score: ${(r.score * 100).toFixed(1)}%\n\n` +
      `${r.content}\n`
    ).join('\n---\n');
  }
}

export const sensoClient = new SensoClient();
export default sensoClient;
