/**
 * Health Check Library
 *
 * Modular health check definitions for Lightpanda verification
 * Each check is a reusable, configurable verification module
 */

import logger from '../../utils/logger.js';

/**
 * Health Check Result structure
 * @typedef {Object} HealthCheckResult
 * @property {boolean} success - Whether the check passed
 * @property {string} checkName - Name of the check
 * @property {number} responseTime - Time taken in ms
 * @property {number} statusCode - HTTP status code (if applicable)
 * @property {string} [error] - Error message if failed
 * @property {object} [details] - Additional check-specific details
 */

/**
 * Base Health Check class
 */
export class HealthCheck {
  constructor(name, options = {}) {
    this.name = name;
    this.timeout = options.timeout || 30000;
    this.retries = options.retries || 0;
    this.retryDelay = options.retryDelay || 1000;
  }

  /**
   * Execute the health check with retry logic
   * @param {object} page - Puppeteer page instance
   * @returns {Promise<HealthCheckResult>}
   */
  async execute(page) {
    let lastError = null;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const startTime = Date.now();
        const result = await this._run(page);
        result.responseTime = Date.now() - startTime;
        result.checkName = this.name;
        result.attempt = attempt + 1;

        if (result.success) {
          return result;
        }

        lastError = result.error;
      } catch (error) {
        lastError = error.message;
      }

      if (attempt < this.retries) {
        await new Promise(r => setTimeout(r, this.retryDelay));
      }
    }

    return {
      success: false,
      checkName: this.name,
      error: lastError || 'Check failed after retries',
      responseTime: 0,
    };
  }

  /**
   * Override in subclasses to implement the actual check
   */
  async _run(page) {
    throw new Error('_run must be implemented by subclass');
  }
}

/**
 * Simple HTTP endpoint check
 */
export class EndpointHealthCheck extends HealthCheck {
  constructor(name, url, options = {}) {
    super(name, options);
    this.url = url;
    this.expectedStatus = options.expectedStatus || 200;
    this.expectedContent = options.expectedContent || null;
    this.expectedContentRegex = options.expectedContentRegex || null;
  }

  async _run(page) {
    const response = await page.goto(this.url, {
      waitUntil: 'networkidle0',
      timeout: this.timeout,
    });

    const status = response?.status() || 0;
    const statusOk = status === this.expectedStatus;

    let contentOk = true;
    let contentDetails = {};

    if (this.expectedContent || this.expectedContentRegex) {
      const content = await page.content();

      if (this.expectedContent) {
        contentOk = content.includes(this.expectedContent);
        contentDetails.expectedContent = this.expectedContent;
        contentDetails.contentFound = contentOk;
      }

      if (this.expectedContentRegex && contentOk) {
        const regex = new RegExp(this.expectedContentRegex);
        contentOk = regex.test(content);
        contentDetails.expectedPattern = this.expectedContentRegex;
        contentDetails.patternMatched = contentOk;
      }
    }

    return {
      success: statusOk && contentOk,
      statusCode: status,
      statusOk,
      contentOk,
      details: contentDetails,
      error: !statusOk ? `Expected status ${this.expectedStatus}, got ${status}` :
             !contentOk ? 'Content validation failed' : null,
    };
  }
}

/**
 * API JSON response check
 */
export class APIHealthCheck extends HealthCheck {
  constructor(name, url, options = {}) {
    super(name, options);
    this.url = url;
    this.expectedStatus = options.expectedStatus || 200;
    this.jsonPath = options.jsonPath || null; // e.g., "status" or "data.healthy"
    this.expectedValue = options.expectedValue; // e.g., "ok" or true
  }

  async _run(page) {
    const response = await page.goto(this.url, {
      waitUntil: 'networkidle0',
      timeout: this.timeout,
    });

    const status = response?.status() || 0;
    const statusOk = status === this.expectedStatus;

    if (!statusOk) {
      return {
        success: false,
        statusCode: status,
        error: `Expected status ${this.expectedStatus}, got ${status}`,
      };
    }

    // Parse JSON from page
    let jsonOk = true;
    let jsonDetails = {};

    if (this.jsonPath) {
      try {
        const bodyText = await page.evaluate(() => document.body.innerText);
        const json = JSON.parse(bodyText);

        // Navigate JSON path
        const value = this._getJsonPath(json, this.jsonPath);
        jsonOk = value === this.expectedValue;

        jsonDetails = {
          path: this.jsonPath,
          expectedValue: this.expectedValue,
          actualValue: value,
        };
      } catch (error) {
        jsonOk = false;
        jsonDetails.parseError = error.message;
      }
    }

    return {
      success: statusOk && jsonOk,
      statusCode: status,
      details: jsonDetails,
      error: !jsonOk ? `JSON validation failed at ${this.jsonPath}` : null,
    };
  }

  _getJsonPath(obj, path) {
    return path.split('.').reduce((o, k) => (o || {})[k], obj);
  }
}

/**
 * Form submission check (login, signup, etc.)
 */
export class FormHealthCheck extends HealthCheck {
  constructor(name, url, options = {}) {
    super(name, options);
    this.url = url;
    this.fields = options.fields || []; // [{selector, value}]
    this.submitSelector = options.submitSelector || 'button[type="submit"]';
    this.successIndicator = options.successIndicator; // selector or text
    this.successUrl = options.successUrl; // URL pattern after success
  }

  async _run(page) {
    // Navigate to form
    await page.goto(this.url, {
      waitUntil: 'networkidle0',
      timeout: this.timeout,
    });

    // Fill form fields
    for (const field of this.fields) {
      await page.waitForSelector(field.selector, { timeout: 5000 });

      if (field.clear) {
        await page.click(field.selector, { clickCount: 3 });
      }

      await page.type(field.selector, field.value);
    }

    // Submit form
    await page.click(this.submitSelector);

    // Wait for navigation or success indicator
    if (this.successUrl) {
      await page.waitForNavigation({ timeout: this.timeout });
      const currentUrl = page.url();
      const urlMatches = currentUrl.includes(this.successUrl);

      return {
        success: urlMatches,
        details: { finalUrl: currentUrl, expectedUrlPattern: this.successUrl },
        error: !urlMatches ? `Expected URL containing "${this.successUrl}", got "${currentUrl}"` : null,
      };
    }

    if (this.successIndicator) {
      try {
        await page.waitForSelector(this.successIndicator, { timeout: this.timeout });
        return { success: true, details: { successElement: this.successIndicator } };
      } catch {
        return {
          success: false,
          error: `Success indicator "${this.successIndicator}" not found`,
        };
      }
    }

    return { success: true };
  }
}

/**
 * Performance threshold check
 */
export class PerformanceHealthCheck extends HealthCheck {
  constructor(name, url, options = {}) {
    super(name, options);
    this.url = url;
    this.maxLoadTime = options.maxLoadTime || 5000; // ms
    this.maxFirstContentfulPaint = options.maxFirstContentfulPaint || 2000;
  }

  async _run(page) {
    const startTime = Date.now();

    await page.goto(this.url, {
      waitUntil: 'networkidle0',
      timeout: this.timeout,
    });

    const loadTime = Date.now() - startTime;

    // Get performance metrics
    const metrics = await page.evaluate(() => {
      const perf = performance.getEntriesByType('navigation')[0];
      const paint = performance.getEntriesByType('paint');
      const fcp = paint.find(p => p.name === 'first-contentful-paint');

      return {
        domContentLoaded: perf?.domContentLoadedEventEnd || 0,
        loadComplete: perf?.loadEventEnd || 0,
        firstContentfulPaint: fcp?.startTime || 0,
      };
    });

    const loadTimeOk = loadTime <= this.maxLoadTime;
    const fcpOk = !metrics.firstContentfulPaint ||
                  metrics.firstContentfulPaint <= this.maxFirstContentfulPaint;

    return {
      success: loadTimeOk && fcpOk,
      details: {
        loadTime,
        maxLoadTime: this.maxLoadTime,
        firstContentfulPaint: metrics.firstContentfulPaint,
        maxFirstContentfulPaint: this.maxFirstContentfulPaint,
        metrics,
      },
      error: !loadTimeOk ? `Load time ${loadTime}ms exceeds max ${this.maxLoadTime}ms` :
             !fcpOk ? `FCP ${metrics.firstContentfulPaint}ms exceeds max ${this.maxFirstContentfulPaint}ms` : null,
    };
  }
}

/**
 * Health Check Library - collection of pre-configured checks
 */
export class HealthCheckLibrary {
  constructor() {
    this.checks = new Map();
  }

  /**
   * Register a health check
   */
  register(check) {
    this.checks.set(check.name, check);
    return this;
  }

  /**
   * Get a check by name
   */
  get(name) {
    return this.checks.get(name);
  }

  /**
   * Get all registered checks
   */
  getAll() {
    return Array.from(this.checks.values());
  }

  /**
   * Create checks from configuration
   */
  static fromConfig(config) {
    const library = new HealthCheckLibrary();

    for (const checkConfig of config) {
      let check;

      switch (checkConfig.type) {
        case 'endpoint':
          check = new EndpointHealthCheck(
            checkConfig.name,
            checkConfig.url,
            checkConfig.options
          );
          break;

        case 'api':
          check = new APIHealthCheck(
            checkConfig.name,
            checkConfig.url,
            checkConfig.options
          );
          break;

        case 'form':
          check = new FormHealthCheck(
            checkConfig.name,
            checkConfig.url,
            checkConfig.options
          );
          break;

        case 'performance':
          check = new PerformanceHealthCheck(
            checkConfig.name,
            checkConfig.url,
            checkConfig.options
          );
          break;

        default:
          logger.warn('Unknown health check type', { type: checkConfig.type });
          continue;
      }

      library.register(check);
    }

    return library;
  }
}

/**
 * Default health checks for common scenarios
 */
export const DefaultHealthChecks = {
  /**
   * Basic health endpoint check
   */
  basicHealth: (baseUrl) => new EndpointHealthCheck(
    'basic-health',
    `${baseUrl}/health`,
    { expectedStatus: 200 }
  ),

  /**
   * API health with JSON response
   */
  apiHealth: (baseUrl) => new APIHealthCheck(
    'api-health',
    `${baseUrl}/api/health`,
    {
      expectedStatus: 200,
      jsonPath: 'status',
      expectedValue: 'ok',
    }
  ),

  /**
   * Database connectivity check
   */
  databaseHealth: (baseUrl) => new APIHealthCheck(
    'database-health',
    `${baseUrl}/health/db`,
    {
      expectedStatus: 200,
      jsonPath: 'database',
      expectedValue: 'connected',
    }
  ),

  /**
   * Redis connectivity check
   */
  cacheHealth: (baseUrl) => new APIHealthCheck(
    'cache-health',
    `${baseUrl}/health/cache`,
    {
      expectedStatus: 200,
      jsonPath: 'cache',
      expectedValue: 'connected',
    }
  ),

  /**
   * Homepage load check
   */
  homepageLoad: (baseUrl) => new PerformanceHealthCheck(
    'homepage-load',
    baseUrl,
    { maxLoadTime: 5000 }
  ),
};

export default HealthCheckLibrary;
