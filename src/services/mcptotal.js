import axios from 'axios';
import config from '../config/index.js';
import logger from '../utils/logger.js';

/**
 * mcptotal.ai Client
 * Used for "Best Use of mcptotal.ai" prize.
 */
class MCPTotalClient {
  constructor() {
    this.apiKey = config.mcptotal?.apiKey;
    this.baseUrl = 'https://api.mcptotal.ai/v1'; // Hypothetical
  }

  /**
   * Analyze incident context using MCP
   * @param {object} context 
   */
  async analyzeContext(context) {
    try {
      const response = await axios.post(`${this.baseUrl}/analyze`, {
        context: context
      }, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` }
      });

      return response.data;
    } catch (error) {
      logger.error('MCPTotal analysis failed', { error: error.message });
      return null;
    }
  }
}

export const mcpTotalClient = new MCPTotalClient();
export default mcpTotalClient;
