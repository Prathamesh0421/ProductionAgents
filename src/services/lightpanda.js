import puppeteer from 'puppeteer-core';
import config from '../config/index.js';
import logger from '../utils/logger.js';

/**
 * Lightpanda Client
 * High-velocity synthetic verification using Zig-based browser
 *
 * DEPENDENCY: Stream B will implement full verification scripts
 * Stream A provides the CDP interface
 */

export class LightpandaClient {
  constructor() {
    this.wsEndpoint = config.lightpanda.wsEndpoint;
    this.browser = null;
  }

  /**
   * Connect to Lightpanda instance
   * Uses CDP (Chrome DevTools Protocol) interface
   */
  async connect() {
    if (!this.wsEndpoint) {
      logger.warn('Lightpanda not configured');
      return false;
    }

    try {
      this.browser = await puppeteer.connect({
        browserWSEndpoint: this.wsEndpoint,
      });

      logger.info('Connected to Lightpanda');
      return true;
    } catch (error) {
      logger.error('Failed to connect to Lightpanda', {
        error: error.message,
        endpoint: this.wsEndpoint,
      });
      return false;
    }
  }

  /**
   * Disconnect from Lightpanda
   */
  async disconnect() {
    if (this.browser) {
      await this.browser.disconnect();
      this.browser = null;
    }
  }

  /**
   * Run a health check on a URL
   * Used for pre-flight and post-remediation verification
   *
   * @param {string} url - URL to check
   * @param {object} options - Check options
   * @returns {Promise<{success: boolean, status: number, responseTime: number, error?: string}>}
   */
  async healthCheck(url, options = {}) {
    const {
      timeout = 30000,
      expectedStatus = 200,
      expectedContent = null,
    } = options;

    if (!this.browser) {
      const connected = await this.connect();
      if (!connected) {
        return { success: false, error: 'Not connected to Lightpanda' };
      }
    }

    const startTime = Date.now();
    let page = null;

    try {
      page = await this.browser.newPage();

      // Set timeout
      page.setDefaultTimeout(timeout);

      // Navigate to URL
      const response = await page.goto(url, {
        waitUntil: 'networkidle0',
        timeout,
      });

      const status = response?.status() || 0;
      const responseTime = Date.now() - startTime;

      // Check status
      const statusOk = status === expectedStatus;

      // Check content if specified
      let contentOk = true;
      if (expectedContent && statusOk) {
        const content = await page.content();
        contentOk = content.includes(expectedContent);
      }

      const success = statusOk && contentOk;

      logger.info('Health check complete', {
        url,
        status,
        responseTime,
        success,
      });

      return {
        success,
        status,
        responseTime,
        statusOk,
        contentOk,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;

      logger.error('Health check failed', {
        url,
        error: error.message,
        responseTime,
      });

      return {
        success: false,
        status: 0,
        responseTime,
        error: error.message,
      };
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
    }
  }

  /**
   * Run a verification swarm - multiple concurrent checks
   * Leverages Lightpanda's low resource usage
   *
   * @param {Array<{url: string, options?: object}>} checks - Array of checks to run
   * @returns {Promise<Array<{url: string, result: object}>>}
   */
  async verificationSwarm(checks) {
    if (!this.browser) {
      const connected = await this.connect();
      if (!connected) {
        return checks.map(c => ({
          url: c.url,
          result: { success: false, error: 'Not connected' },
        }));
      }
    }

    const results = await Promise.all(
      checks.map(async (check) => {
        const result = await this.healthCheck(check.url, check.options || {});
        return { url: check.url, result };
      })
    );

    const successCount = results.filter(r => r.result.success).length;
    logger.info('Verification swarm complete', {
      total: checks.length,
      success: successCount,
      failed: checks.length - successCount,
    });

    return results;
  }

  /**
   * Verify a user journey (multi-step flow)
   *
   * @param {Array<{action: string, target?: string, value?: string, wait?: number}>} steps
   * @param {string} startUrl - Starting URL
   * @returns {Promise<{success: boolean, completedSteps: number, error?: string}>}
   */
  async verifyUserJourney(steps, startUrl) {
    if (!this.browser) {
      const connected = await this.connect();
      if (!connected) {
        return { success: false, completedSteps: 0, error: 'Not connected' };
      }
    }

    let page = null;
    let completedSteps = 0;

    try {
      page = await this.browser.newPage();
      await page.goto(startUrl, { waitUntil: 'networkidle0' });

      for (const step of steps) {
        switch (step.action) {
          case 'click':
            await page.click(step.target);
            break;
          case 'type':
            await page.type(step.target, step.value);
            break;
          case 'wait':
            await page.waitForSelector(step.target, { timeout: step.timeout || 10000 });
            break;
          case 'navigate':
            await page.goto(step.value, { waitUntil: 'networkidle0' });
            break;
          case 'assert':
            const content = await page.content();
            if (!content.includes(step.value)) {
              throw new Error(`Assertion failed: expected "${step.value}"`);
            }
            break;
        }

        if (step.wait) {
          await new Promise(r => setTimeout(r, step.wait));
        }

        completedSteps++;
      }

      return { success: true, completedSteps };
    } catch (error) {
      logger.error('User journey verification failed', {
        error: error.message,
        completedSteps,
        totalSteps: steps.length,
      });

      return {
        success: false,
        completedSteps,
        error: error.message,
      };
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
    }
  }
}

export const lightpandaClient = new LightpandaClient();
export default lightpandaClient;
