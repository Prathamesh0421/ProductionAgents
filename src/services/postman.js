import axios from 'axios';
import config from '../config/index.js';
import logger from '../utils/logger.js';

/**
 * Postman Client
 * Used for "Best Use of Postman" prize.
 */
class PostmanClient {
  constructor() {
    this.apiKey = config.postman?.apiKey;
    this.baseUrl = 'https://api.getpostman.com';
  }

  /**
   * Run a Postman Monitor to verify service health
   * @param {string} monitorId 
   */
  async runMonitor(monitorId) {
    try {
      const response = await axios.post(`${this.baseUrl}/monitors/${monitorId}/run`, {}, {
        headers: { 'X-Api-Key': this.apiKey }
      });
      return response.data;
    } catch (error) {
      logger.error('Postman monitor run failed', { error: error.message });
      return null;
    }
  }

  /**
   * Get environment details
   * @param {string} environmentId 
   */
  async getEnvironment(environmentId) {
    try {
      const response = await axios.get(`${this.baseUrl}/environments/${environmentId}`, {
        headers: { 'X-Api-Key': this.apiKey }
      });
      return response.data;
    } catch (error) {
      logger.error('Postman get environment failed', { error: error.message });
      return null;
    }
  }
}

export const postmanClient = new PostmanClient();
export default postmanClient;
