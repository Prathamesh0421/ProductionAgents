import axios from 'axios';
import config from '../config/index.js';
import logger from '../utils/logger.js';

/**
 * Skyflow Client
 * Handles PII detection, de-identification, and secure storage.
 * Used for "Best Use of Skyflow" prize.
 *
 * API Reference: https://docs.skyflow.com/detect/
 */

// Skyflow Detect API base URL (global endpoint)
const SKYFLOW_DETECT_API = 'https://manage.skyflowapis.com';

class SkyflowClient {
  constructor() {
    this.vaultId = config.skyflow?.vaultId;
    this.vaultUrl = config.skyflow?.vaultUrl;
    this.bearerToken = config.skyflow?.bearerToken;

    // Support custom detect API URL if provided, otherwise use global
    this.detectApiUrl = config.skyflow?.detectApiUrl || SKYFLOW_DETECT_API;
  }

  /**
   * De-identify text before sending to LLM using Skyflow Detect API
   *
   * The Detect API automatically identifies hundreds of forms of PII
   * and returns a privacy-safe version with detected PII replaced by tokens.
   *
   * @param {string} text - Text to de-identify
   * @returns {Promise<string>} - De-identified text with PII redacted
   */
  async redact(text) {
    // Skip empty or very short text
    if (!text || text.length < 3) {
      return text;
    }

    // Local fallback if Skyflow not configured
    if (!this.vaultId || !this.bearerToken || config.server.env === 'test') {
      logger.debug('Using local regex redaction (Skyflow not configured)');
      return this._localRedact(text);
    }

    try {
      // Skyflow Detect API endpoint
      // POST https://manage.skyflowapis.com/v1/detect
      const response = await axios.post(
        `${this.detectApiUrl}/v1/detect`,
        {
          vault_id: this.vaultId,
          data: {
            blob: text,
          },
          // Return info about detected entities for logging
          send_back_entities: false,
          // Redaction mode - replace PII with tokens
          continue_on_error: true,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.bearerToken}`,
            'X-SKYFLOW-ACCOUNT-ID': config.skyflow?.accountId || '',
          },
          timeout: 10000, // 10 second timeout
        }
      );

      // Response contains processed_data with redacted text
      const redactedText = response.data?.processed_data?.blob;

      if (redactedText) {
        logger.debug('Skyflow redaction successful', {
          originalLength: text.length,
          redactedLength: redactedText.length,
        });
        return redactedText;
      }

      // If no processed_data, return original with warning
      logger.warn('Skyflow returned no processed_data, using original text');
      return text;
    } catch (error) {
      logger.error('Skyflow Detect API failed', {
        error: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
      });

      // Fallback to local redaction on API failure
      logger.info('Falling back to local regex redaction');
      return this._localRedact(text);
    }
  }

  /**
   * Local regex-based redaction fallback
   * Used when Skyflow is unavailable or not configured
   *
   * @param {string} text - Text to redact
   * @returns {string} - Text with common PII patterns redacted
   */
  _localRedact(text) {
    return text
      // SSN patterns (XXX-XX-XXXX)
      .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED_SSN]')
      // Credit card numbers (13-16 digits)
      .replace(/\b\d{13,16}\b/g, '[REDACTED_CARD]')
      // Credit card with spaces/dashes
      .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[REDACTED_CARD]')
      // Email addresses
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[REDACTED_EMAIL]')
      // Phone numbers (various formats)
      .replace(/\b(\+?1?[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[REDACTED_PHONE]')
      // IP addresses
      .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[REDACTED_IP]')
      // API keys (common patterns)
      .replace(/\b(sk|pk|api|key|token)[-_][a-zA-Z0-9]{20,}\b/gi, '[REDACTED_KEY]');
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
