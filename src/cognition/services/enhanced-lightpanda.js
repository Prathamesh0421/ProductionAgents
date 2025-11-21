/**
 * Enhanced Lightpanda Client
 *
 * Extends Stream A's Lightpanda client with Stream B's verification library
 */

import { LightpandaClient } from '../../services/lightpanda.js';
import { HealthCheckLibrary, DefaultHealthChecks } from '../verification/health-checks.js';
import { UserJourneyRunner, UserJourney, JourneyTemplates } from '../verification/user-journeys.js';
import { VerificationSwarm, quickSwarm } from '../verification/swarm.js';
import logger from '../../utils/logger.js';

/**
 * Enhanced Lightpanda Client with verification library
 */
export class EnhancedLightpandaClient extends LightpandaClient {
  constructor(options = {}) {
    super();

    this.healthCheckLibrary = new HealthCheckLibrary();
    this.journeyRunner = new UserJourneyRunner({
      timeout: options.timeout || 30000,
      screenshotDir: options.screenshotDir || '/tmp/journey-screenshots',
    });
    this.swarm = new VerificationSwarm({
      client: this,
      maxConcurrency: options.maxConcurrency || 10,
    });
  }

  /**
   * Register default health checks for a service
   *
   * @param {string} baseUrl - Base URL of the service
   * @param {array} checkTypes - Types of checks to register
   */
  registerDefaultChecks(baseUrl, checkTypes = ['basicHealth', 'apiHealth']) {
    for (const type of checkTypes) {
      if (DefaultHealthChecks[type]) {
        this.healthCheckLibrary.register(DefaultHealthChecks[type](baseUrl));
      }
    }
    return this;
  }

  /**
   * Register custom health checks from configuration
   */
  registerChecksFromConfig(config) {
    this.healthCheckLibrary = HealthCheckLibrary.fromConfig(config);
    return this;
  }

  /**
   * Run a named health check
   */
  async runHealthCheck(checkName) {
    const check = this.healthCheckLibrary.get(checkName);
    if (!check) {
      throw new Error(`Health check "${checkName}" not found`);
    }

    if (!this.browser) {
      await this.connect();
    }

    const page = await this.browser.newPage();
    try {
      return await check.execute(page);
    } finally {
      await page.close().catch(() => {});
    }
  }

  /**
   * Run all registered health checks
   */
  async runAllHealthChecks(options = {}) {
    const checks = this.healthCheckLibrary.getAll();

    if (checks.length === 0) {
      logger.warn('No health checks registered');
      return { success: true, results: [], totalChecks: 0 };
    }

    return this.swarm.execute(checks, options);
  }

  /**
   * Run a user journey
   *
   * @param {UserJourney|string} journey - Journey instance or template name
   * @param {object} options - Journey options (for templates)
   */
  async runJourney(journey, options = {}) {
    if (!this.browser) {
      await this.connect();
    }

    // If string, look up template
    let journeyInstance = journey;
    if (typeof journey === 'string') {
      const templateFn = JourneyTemplates[journey];
      if (!templateFn) {
        throw new Error(`Journey template "${journey}" not found`);
      }
      journeyInstance = templateFn(options.baseUrl, options.credentials, options.selectors);
    }

    const page = await this.browser.newPage();
    try {
      return await this.journeyRunner.run(page, journeyInstance);
    } finally {
      await page.close().catch(() => {});
    }
  }

  /**
   * Create a custom journey
   */
  createJourney(name, options = {}) {
    return new UserJourney(name, options);
  }

  /**
   * Execute verification swarm
   */
  async executeSwarm(checks, options = {}) {
    return this.swarm.execute(checks, options);
  }

  /**
   * Quick URL swarm check
   */
  async quickSwarm(urls, options = {}) {
    return quickSwarm(urls, { ...options, client: this });
  }

  /**
   * Pre/post remediation verification
   *
   * @param {object} verificationConfig - Configuration for verification
   * @param {function} remediationFn - Remediation function
   */
  async verifyRemediation(verificationConfig, remediationFn) {
    const { urls, healthChecks, journeys } = verificationConfig;

    // Build check list
    const checks = [];

    if (urls?.length > 0) {
      checks.push(...urls.map(url => ({
        url: typeof url === 'string' ? url : url.url,
        name: typeof url === 'string' ? url : url.name,
        expectedStatus: typeof url === 'string' ? 200 : url.expectedStatus,
      })));
    }

    if (healthChecks?.length > 0) {
      for (const checkName of healthChecks) {
        const check = this.healthCheckLibrary.get(checkName);
        if (check) {
          checks.push(check);
        }
      }
    }

    // Execute pre/post verification
    const result = await this.swarm.executeWithRemediation(checks, remediationFn);

    // Run journeys if specified (after remediation)
    if (journeys?.length > 0 && result.post?.success) {
      result.journeyResults = [];

      for (const journeyConfig of journeys) {
        try {
          const journeyResult = await this.runJourney(
            journeyConfig.name || journeyConfig,
            journeyConfig.options || {}
          );
          result.journeyResults.push({
            name: journeyConfig.name || journeyConfig,
            ...journeyResult,
          });
        } catch (error) {
          result.journeyResults.push({
            name: journeyConfig.name || journeyConfig,
            success: false,
            error: error.message,
          });
        }
      }
    }

    return result;
  }

  /**
   * Service-specific verification presets
   */
  static getServicePreset(serviceName, baseUrl) {
    const presets = {
      'api-gateway': {
        urls: [
          `${baseUrl}/health`,
          `${baseUrl}/api/v1/health`,
        ],
        healthChecks: ['basicHealth', 'apiHealth'],
      },

      'payment-api': {
        urls: [
          `${baseUrl}/health`,
          `${baseUrl}/health/db`,
          `${baseUrl}/health/stripe`,
        ],
        healthChecks: ['basicHealth', 'databaseHealth'],
      },

      'user-service': {
        urls: [
          `${baseUrl}/health`,
          `${baseUrl}/health/db`,
          `${baseUrl}/health/cache`,
        ],
        healthChecks: ['basicHealth', 'databaseHealth', 'cacheHealth'],
      },

      'web-frontend': {
        urls: [
          baseUrl,
          `${baseUrl}/health`,
        ],
        healthChecks: ['homepageLoad'],
        journeys: ['login'],
      },
    };

    return presets[serviceName] || {
      urls: [`${baseUrl}/health`],
      healthChecks: ['basicHealth'],
    };
  }
}

// Export singleton
export const enhancedLightpandaClient = new EnhancedLightpandaClient();
export default EnhancedLightpandaClient;
