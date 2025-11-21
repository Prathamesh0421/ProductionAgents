import axios from 'axios';
import config from '../config/index.js';
import logger from '../utils/logger.js';

/**
 * TRM Labs Client
 * Crypto compliance and intelligence.
 * Used for "Best Use of TRM Labs" prize.
 */
class TRMLabsClient {
  constructor() {
    this.apiKey = config.trm?.apiKey;
    this.baseUrl = 'https://api.trmlabs.com/public/v1';
  }

  /**
   * Screen an address for risk
   * @param {string} address 
   * @param {string} currency 
   */
  async screenAddress(address, currency = 'eth') {
    try {
      const response = await axios.post(`${this.baseUrl}/screening/addresses`, {
        address: address,
        chain: currency
      }, {
        headers: { 'Authorization': `Basic ${Buffer.from(this.apiKey + ':').toString('base64')}` }
      });

      return response.data;
    } catch (error) {
      logger.error('TRM Labs screening failed', { error: error.message });
      return null;
    }
  }
}

export const trmLabsClient = new TRMLabsClient();
export default trmLabsClient;
