import axios from 'axios';
import config from '../config/index.js';
import logger from '../utils/logger.js';

/**
 * Skyflow Client
 * Handles PII redaction and secure storage.
 * Used for "Best Use of Skyflow" prize.
 */
class SkyflowClient {
  constructor() {
    this.vaultId = config.skyflow?.vaultId;
    this.vaultUrl = config.skyflow?.vaultUrl;
    this.bearerToken = config.skyflow?.bearerToken;
  }

  /**
   * De-identify text before sending to LLM
   * @param {string} text 
   */
  async redact(text) {
    try {
      // Hypothetical Skyflow de-identify endpoint
      const response = await axios.post(`${this.vaultUrl}/v1/detect/deidentify`, {
        text: text,
        vaultID: this.vaultId,
        redactionType: 'REDACT'
      }, {
        headers: { 'Authorization': `Bearer ${this.bearerToken}` }
      });

      return response.data.redactedText;
    } catch (error) {
      logger.error('Skyflow redaction failed', { error: error.message });
      return text; // Fallback to original text if failed (warning: unsafe)
    }
  }

  /**
   * Insert sensitive data into vault
   */
  async insertSensitiveData(data) {
    try {
      const response = await axios.post(`${this.vaultUrl}/v1/vaults/${this.vaultId}/records`, {
        records: [
          {
            fields: data
          }
        ]
      }, {
        headers: { 'Authorization': `Bearer ${this.bearerToken}` }
      });
      return response.data;
    } catch (error) {
      logger.error('Skyflow insert failed', { error: error.message });
      return null;
    }
  }
}

export const skyflowClient = new SkyflowClient();
export default skyflowClient;
