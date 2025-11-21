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
    this.baseUrl = 'https://api.parallel.ai/v1';
  }

  /**
   * Use Parallel Web Agent to research an error or issue
   * @param {string} query 
   */
  async researchIssue(query) {
    if (!this.apiKey) {
      logger.warn('Parallel API key not configured');
      return null;
    }

    try {
      // Using Parallel Task API for Deep Research
      // https://docs.parallel.ai/task-api/features/task-deep-research
      const response = await axios.post(`${this.baseUrl}/tasks/runs`, {
        input: query,
        processor: 'ultra' // 'ultra' is often used for deep research/reasoning
      }, {
        headers: { 
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json'
        }
      });

      return response.data;
    } catch (error) {
      logger.error('Parallel research failed', { 
        error: error.message,
        status: error.response?.status,
        data: error.response?.data 
      });
      return null;
    }
  }

  /**
   * Use Parallel Web Tool to check a website status or content
   * @param {string} url 
   */
  async checkSite(url) {
    if (!this.apiKey) {
      logger.warn('Parallel API key not configured');
      return null;
    }

    try {
      // Using Task API to browse/analyze specific URL
      const response = await axios.post(`${this.baseUrl}/tasks/runs`, {
        input: `Analyze the website at ${url}. Take a screenshot if possible and summarize the content.`,
        processor: 'base' // Lighter weight for simple checks
      }, {
        headers: { 
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json'
        }
      });

      return response.data;
    } catch (error) {
      logger.error('Parallel site check failed', { 
        error: error.message,
        status: error.response?.status
      });
      return null;
    }
  }
}

export const parallelClient = new ParallelClient();
export default parallelClient;
