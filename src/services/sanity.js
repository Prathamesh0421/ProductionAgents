import axios from 'axios';
import config from '../config/index.js';
import logger from '../utils/logger.js';

/**
 * Sanity Client
 * Replaces Senso for context retrieval and content management.
 * Used for "Best Use of Sanity" prize.
 */
class SanityClient {
  constructor() {
    this.projectId = config.sanity?.projectId;
    this.dataset = config.sanity?.dataset || 'production';
    this.apiVersion = '2023-11-21';
    this.token = config.sanity?.token;
  }

  /**
   * Search for runbooks or documentation in Sanity
   * @param {string} query - The search query
   */
  async search(query) {
    try {
      // GROQ query to search for documents
      // This is a hypothetical schema for runbooks
      const groq = `*[_type == "runbook" && (title match "${query}*" || body match "${query}*")] {
        title,
        "body": body,
        "score": score(title match "${query}*")
      } | order(score desc)[0...5]`;

      const url = `https://${this.projectId}.api.sanity.io/v${this.apiVersion}/data/query/${this.dataset}`;
      
      const response = await axios.get(url, {
        params: { query: groq },
        headers: {
          Authorization: `Bearer ${this.token}`
        }
      });

      return {
        results: response.data.result,
        maxScore: response.data.result.length > 0 ? 1.0 : 0.0 // Simplified score
      };
    } catch (error) {
      logger.error('Sanity search failed', { error: error.message });
      return { results: [], maxScore: 0 };
    }
  }

  /**
   * Ingest new content into Sanity
   * @param {string} text - Content body
   * @param {object} metadata - Metadata tags
   */
  async ingestContent(text, metadata = {}) {
    try {
      const doc = {
        _type: 'runbook',
        title: metadata.title || 'Untitled',
        body: text,
        service: metadata.service,
        metadata: metadata,
        ingestedAt: new Date().toISOString()
      };

      const url = `https://${this.projectId}.api.sanity.io/v${this.apiVersion}/data/mutate/${this.dataset}`;
      
      const mutations = [{
        create: doc
      }];

      const response = await axios.post(url, { mutations }, {
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        }
      });

      return { id: response.data.results?.[0]?.id };
    } catch (error) {
      logger.error('Sanity ingestion failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Format results for LLM prompt
   */
  formatForPrompt(results) {
    if (!results || results.length === 0) return 'No relevant runbooks found.';
    
    return results.map(r => `Title: ${r.title}\nContent: ${JSON.stringify(r.body)}`).join('\n---\n');
  }
}

export const sanityClient = new SanityClient();
export default sanityClient;
