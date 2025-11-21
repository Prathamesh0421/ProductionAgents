import axios from 'axios';
import config from '../config/index.js';
import logger from '../utils/logger.js';

/**
 * Parallel Client
 * Integrates Parallel Web Tool APIs and Web Agent APIs.
 * Used for "Best Use of Parallel" prize.
 */
class ParallelClient {
  constructor() {
    this.apiKey = config.parallel?.apiKey;
    this.baseUrl = 'https://api.parallel.ai/v1'; // Hypothetical URL
  }

  /**
   * Use Parallel Web Agent to research an error or issue
   * @param {string} query 
   */
  async researchIssue(query) {
    try {
      const response = await axios.post(`${this.baseUrl}/agent/research`, {
        query: query,
        depth: 'deep'
      }, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` }
      });

      return response.data;
    } catch (error) {
      logger.error('Parallel research failed', { error: error.message });
      return null;
    }
  }

  /**
   * Use Parallel Web Tool to check a website status or content
   * @param {string} url 
   */
  async checkSite(url) {
    try {
      const response = await axios.post(`${this.baseUrl}/tools/browse`, {
        url: url,
        action: 'screenshot'
      }, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` }
      });

      return response.data;
    } catch (error) {
      logger.error('Parallel site check failed', { error: error.message });
      return null;
    }
  }
}

export const parallelClient = new ParallelClient();
export default parallelClient;
