import config from '../config/index.js';
import logger from '../utils/logger.js';
import anthropicClient from './anthropic.js';
import geminiClient from './gemini.js';

/**
 * AI Provider Factory
 * Switches between Anthropic and Gemini
 */

class AIClientFactory {
  constructor() {
    this.provider = config.llm.provider;
    logger.info(`Initializing AI Provider: ${this.provider}`);
  }

  getClient() {
    switch (this.provider.toLowerCase()) {
      case 'gemini':
        return geminiClient;
      case 'anthropic':
      default:
        if (this.provider !== 'anthropic') {
          logger.warn(`Unknown LLM provider '${this.provider}', defaulting to Anthropic`);
        }
        return anthropicClient;
    }
  }
}

export const aiClient = new AIClientFactory().getClient();
export default aiClient;
