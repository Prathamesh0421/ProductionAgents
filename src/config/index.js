import dotenv from 'dotenv';
dotenv.config();

export const config = {
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    env: process.env.NODE_ENV || 'development',
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  pagerduty: {
    apiKey: process.env.PAGERDUTY_API_KEY,
    webhookSecret: process.env.PAGERDUTY_WEBHOOK_SECRET,
    serviceId: process.env.PAGERDUTY_SERVICE_ID,
    apiUrl: process.env.PAGERDUTY_API_URL, // For local mocking/alternatives
  },

  sanity: {
    projectId: process.env.SANITY_PROJECT_ID,
    dataset: process.env.SANITY_DATASET,
    token: process.env.SANITY_TOKEN,
  },
  
  parallel: {
    apiKey: process.env.PARALLEL_API_KEY,
  },

  skyflow: {
    vaultId: process.env.SKYFLOW_VAULT_ID,
    vaultUrl: process.env.SKYFLOW_VAULT_URL,
    bearerToken: process.env.SKYFLOW_BEARER_TOKEN,
  },

  postman: {
    apiKey: process.env.POSTMAN_API_KEY,
  },

  // AI Provider Selection
  llm: {
    provider: process.env.LLM_PROVIDER || 'anthropic',
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL || 'claude-3-sonnet-20240229',
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || 'gemini-1.5-pro-latest',
  },

  // Stream C dependencies - interfaces only in Stream A
  coder: {
    apiUrl: process.env.CODER_API_URL,
    apiToken: process.env.CODER_API_TOKEN,
    templateId: process.env.CODER_TEMPLATE_ID,
  },

  lightpanda: {
    wsEndpoint: process.env.LIGHTPANDA_WS_ENDPOINT || 'ws://localhost:9222',
  },

  slack: {
    botToken: process.env.SLACK_BOT_TOKEN,
    approvalChannel: process.env.SLACK_APPROVAL_CHANNEL || 'incident-approvals',
    apiUrl: process.env.SLACK_API_URL, // For Mattermost or other alternatives
  },

  confidence: {
    autoExecuteThreshold: parseInt(process.env.CONFIDENCE_AUTO_EXECUTE_THRESHOLD || '90', 10),
    contextMatchThreshold: parseInt(process.env.CONTEXT_MATCH_THRESHOLD || '85', 10),
  },
};

export default config;
