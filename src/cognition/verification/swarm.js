/**
 * Verification Swarm
 *
 * High-concurrency verification using Lightpanda's low resource footprint
 * Executes multiple health checks in parallel for comprehensive validation
 */

import logger from '../../utils/logger.js';
import { lightpandaClient } from '../../services/lightpanda.js';

/**
 * Swarm result structure
 * @typedef {Object} SwarmResult
 * @property {boolean} success - Overall swarm success (all checks passed)
 * @property {number} totalChecks - Total number of checks executed
 * @property {number} passed - Number of passed checks
 * @property {number} failed - Number of failed checks
 * @property {number} duration - Total swarm duration in ms
 * @property {array} results - Individual check results
 * @property {object} summary - Aggregated metrics
 */

/**
 * Verification Swarm executor
 */
export class VerificationSwarm {
  constructor(options = {}) {
    this.client = options.client || lightpandaClient;
    this.maxConcurrency = options.maxConcurrency || 10;
    this.defaultTimeout = options.timeout || 30000;
  }

  /**
   * Execute a swarm of health checks
   *
   * @param {array} checks - Array of check configurations
   * @param {object} options - Execution options
   * @returns {Promise<SwarmResult>}
   */
  async execute(checks, options = {}) {
    const startTime = Date.now();
    const concurrency = options.concurrency || this.maxConcurrency;
    const failFast = options.failFast || false;

    logger.info('Starting verification swarm', {
      totalChecks: checks.length,
      concurrency,
      failFast,
    });

    // Connect to Lightpanda if not connected
    const connected = await this.client.connect();
    if (!connected) {
      return {
        success: false,
        totalChecks: checks.length,
        passed: 0,
        failed: checks.length,
        duration: Date.now() - startTime,
        results: checks.map(c => ({
          name: c.name || c.url,
          success: false,
          error: 'Failed to connect to Lightpanda',
        })),
        summary: { error: 'Connection failed' },
      };
    }

    // Execute checks with concurrency control
    const results = await this._executeWithConcurrency(checks, concurrency, failFast);

    // Calculate summary
    const passed = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const avgResponseTime = results.reduce((sum, r) => sum + (r.responseTime || 0), 0) / results.length;

    const summary = {
      passRate: (passed / checks.length) * 100,
      avgResponseTime: Math.round(avgResponseTime),
      slowestCheck: this._findSlowest(results),
      failedChecks: results.filter(r => !r.success).map(r => ({
        name: r.name,
        error: r.error,
      })),
    };

    const swarmResult = {
      success: failed === 0,
      totalChecks: checks.length,
      passed,
      failed,
      duration: Date.now() - startTime,
      results,
      summary,
    };

    logger.info('Verification swarm complete', {
      success: swarmResult.success,
      passed,
      failed,
      duration: swarmResult.duration,
    });

    return swarmResult;
  }

  /**
   * Execute checks with concurrency limit
   */
  async _executeWithConcurrency(checks, concurrency, failFast) {
    const results = [];
    const pending = [...checks];
    let aborted = false;

    const executeNext = async () => {
      while (pending.length > 0 && !aborted) {
        const check = pending.shift();
        if (!check) break;

        try {
          const result = await this._executeCheck(check);
          results.push(result);

          if (failFast && !result.success) {
            aborted = true;
            logger.warn('Swarm aborted due to failFast', {
              failedCheck: check.name || check.url,
            });
          }
        } catch (error) {
          results.push({
            name: check.name || check.url,
            success: false,
            error: error.message,
          });

          if (failFast) {
            aborted = true;
          }
        }
      }
    };

    // Start concurrent workers
    const workers = Array(Math.min(concurrency, checks.length))
      .fill(null)
      .map(() => executeNext());

    await Promise.all(workers);

    // If aborted, mark remaining as skipped
    if (aborted && pending.length > 0) {
      for (const check of pending) {
        results.push({
          name: check.name || check.url,
          success: false,
          error: 'Skipped due to failFast',
          skipped: true,
        });
      }
    }

    return results;
  }

  /**
   * Execute a single check
   */
  async _executeCheck(check) {
    const startTime = Date.now();

    // If check has an execute method (HealthCheck instance)
    if (check.execute && typeof check.execute === 'function') {
      const page = await this.client.browser.newPage();
      try {
        const result = await check.execute(page);
        result.name = check.name;
        result.responseTime = Date.now() - startTime;
        return result;
      } finally {
        await page.close().catch(() => {});
      }
    }

    // Simple URL check
    const result = await this.client.healthCheck(check.url, {
      timeout: check.timeout || this.defaultTimeout,
      expectedStatus: check.expectedStatus || 200,
      expectedContent: check.expectedContent,
    });

    return {
      name: check.name || check.url,
      url: check.url,
      ...result,
    };
  }

  /**
   * Find the slowest check
   */
  _findSlowest(results) {
    const slowest = results.reduce(
      (max, r) => ((r.responseTime || 0) > (max.responseTime || 0) ? r : max),
      { responseTime: 0 }
    );
    return {
      name: slowest.name,
      responseTime: slowest.responseTime,
    };
  }

  /**
   * Execute a pre/post remediation verification pair
   *
   * @param {array} checks - Checks to run
   * @param {function} remediationFn - Remediation function to execute between
   * @returns {Promise<{pre: SwarmResult, post: SwarmResult, improved: boolean}>}
   */
  async executeWithRemediation(checks, remediationFn) {
    logger.info('Starting pre-remediation verification');

    // Pre-remediation check
    const preResult = await this.execute(checks, { failFast: false });

    logger.info('Pre-remediation verification complete', {
      passed: preResult.passed,
      failed: preResult.failed,
    });

    // Execute remediation
    logger.info('Executing remediation');
    try {
      await remediationFn();
    } catch (error) {
      logger.error('Remediation failed', { error: error.message });
      return {
        pre: preResult,
        post: null,
        remediationError: error.message,
        improved: false,
      };
    }

    // Wait for changes to propagate
    await new Promise(r => setTimeout(r, 5000));

    // Post-remediation check
    logger.info('Starting post-remediation verification');
    const postResult = await this.execute(checks, { failFast: false });

    logger.info('Post-remediation verification complete', {
      passed: postResult.passed,
      failed: postResult.failed,
    });

    // Determine if remediation improved things
    const improved = postResult.passed > preResult.passed;
    const fullyFixed = postResult.failed === 0;

    return {
      pre: preResult,
      post: postResult,
      improved,
      fullyFixed,
      delta: {
        passed: postResult.passed - preResult.passed,
        failed: postResult.failed - preResult.failed,
      },
    };
  }
}

/**
 * Quick swarm execution helper
 *
 * @param {array} urls - URLs to check
 * @param {object} options - Options
 * @returns {Promise<SwarmResult>}
 */
export async function quickSwarm(urls, options = {}) {
  const swarm = new VerificationSwarm(options);

  const checks = urls.map(url => ({
    url: typeof url === 'string' ? url : url.url,
    name: typeof url === 'string' ? url : url.name,
    expectedStatus: typeof url === 'string' ? 200 : url.expectedStatus,
  }));

  return swarm.execute(checks, options);
}

/**
 * Geographic swarm - check from multiple regions (simulated via different endpoints)
 */
export class GeoSwarm extends VerificationSwarm {
  constructor(options = {}) {
    super(options);
    this.regions = options.regions || ['us-east', 'us-west', 'eu-west'];
  }

  /**
   * Execute checks from multiple "regions"
   * In practice, this would use different Lightpanda instances in each region
   */
  async executeMultiRegion(checks) {
    const regionResults = {};

    for (const region of this.regions) {
      logger.info('Executing swarm for region', { region });

      // In production, you'd connect to a region-specific Lightpanda instance
      // For now, we simulate by adding region to the check name
      const regionChecks = checks.map(c => ({
        ...c,
        name: `${region}:${c.name || c.url}`,
      }));

      regionResults[region] = await this.execute(regionChecks);
    }

    // Aggregate results
    const allSuccess = Object.values(regionResults).every(r => r.success);
    const totalPassed = Object.values(regionResults).reduce((sum, r) => sum + r.passed, 0);
    const totalFailed = Object.values(regionResults).reduce((sum, r) => sum + r.failed, 0);

    return {
      success: allSuccess,
      regionResults,
      summary: {
        totalPassed,
        totalFailed,
        failedRegions: Object.entries(regionResults)
          .filter(([_, r]) => !r.success)
          .map(([region]) => region),
      },
    };
  }
}

export default VerificationSwarm;
