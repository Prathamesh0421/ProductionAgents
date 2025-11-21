/**
 * User Journey Runner
 *
 * Defines and executes multi-step user journeys for verification
 * Simulates real user flows to validate system functionality
 */

import logger from '../../utils/logger.js';

/**
 * Journey step types
 */
export const StepTypes = {
  NAVIGATE: 'navigate',
  CLICK: 'click',
  TYPE: 'type',
  SELECT: 'select',
  WAIT: 'wait',
  WAIT_FOR_SELECTOR: 'wait_for_selector',
  WAIT_FOR_NAVIGATION: 'wait_for_navigation',
  ASSERT_TEXT: 'assert_text',
  ASSERT_ELEMENT: 'assert_element',
  ASSERT_URL: 'assert_url',
  SCREENSHOT: 'screenshot',
  CUSTOM: 'custom',
};

/**
 * User Journey definition
 */
export class UserJourney {
  constructor(name, options = {}) {
    this.name = name;
    this.description = options.description || '';
    this.startUrl = options.startUrl;
    this.steps = [];
    this.timeout = options.timeout || 30000;
    this.continueOnError = options.continueOnError || false;
  }

  /**
   * Add a navigation step
   */
  navigate(url, options = {}) {
    this.steps.push({
      type: StepTypes.NAVIGATE,
      url,
      waitUntil: options.waitUntil || 'networkidle0',
      ...options,
    });
    return this;
  }

  /**
   * Add a click step
   */
  click(selector, options = {}) {
    this.steps.push({
      type: StepTypes.CLICK,
      selector,
      ...options,
    });
    return this;
  }

  /**
   * Add a type step
   */
  type(selector, text, options = {}) {
    this.steps.push({
      type: StepTypes.TYPE,
      selector,
      text,
      clearFirst: options.clearFirst || false,
      ...options,
    });
    return this;
  }

  /**
   * Add a select dropdown step
   */
  select(selector, value) {
    this.steps.push({
      type: StepTypes.SELECT,
      selector,
      value,
    });
    return this;
  }

  /**
   * Add a wait step (fixed duration)
   */
  wait(ms) {
    this.steps.push({
      type: StepTypes.WAIT,
      duration: ms,
    });
    return this;
  }

  /**
   * Wait for a selector to appear
   */
  waitForSelector(selector, options = {}) {
    this.steps.push({
      type: StepTypes.WAIT_FOR_SELECTOR,
      selector,
      timeout: options.timeout || this.timeout,
      ...options,
    });
    return this;
  }

  /**
   * Wait for navigation to complete
   */
  waitForNavigation(options = {}) {
    this.steps.push({
      type: StepTypes.WAIT_FOR_NAVIGATION,
      waitUntil: options.waitUntil || 'networkidle0',
      timeout: options.timeout || this.timeout,
    });
    return this;
  }

  /**
   * Assert text is present on page
   */
  assertText(text, options = {}) {
    this.steps.push({
      type: StepTypes.ASSERT_TEXT,
      text,
      selector: options.selector || 'body',
      ...options,
    });
    return this;
  }

  /**
   * Assert element exists
   */
  assertElement(selector, options = {}) {
    this.steps.push({
      type: StepTypes.ASSERT_ELEMENT,
      selector,
      ...options,
    });
    return this;
  }

  /**
   * Assert current URL matches pattern
   */
  assertUrl(pattern) {
    this.steps.push({
      type: StepTypes.ASSERT_URL,
      pattern,
    });
    return this;
  }

  /**
   * Take a screenshot (for debugging)
   */
  screenshot(filename) {
    this.steps.push({
      type: StepTypes.SCREENSHOT,
      filename,
    });
    return this;
  }

  /**
   * Add a custom step
   */
  custom(name, fn) {
    this.steps.push({
      type: StepTypes.CUSTOM,
      name,
      fn,
    });
    return this;
  }
}

/**
 * User Journey Runner
 */
export class UserJourneyRunner {
  constructor(options = {}) {
    this.defaultTimeout = options.timeout || 30000;
    this.screenshotDir = options.screenshotDir || '/tmp/journey-screenshots';
  }

  /**
   * Execute a user journey
   *
   * @param {object} page - Puppeteer page instance
   * @param {UserJourney} journey - Journey to execute
   * @returns {Promise<{success: boolean, completedSteps: number, totalSteps: number, error?: string, stepResults: array}>}
   */
  async run(page, journey) {
    const startTime = Date.now();
    const stepResults = [];
    let completedSteps = 0;

    logger.info('Starting user journey', {
      name: journey.name,
      totalSteps: journey.steps.length,
    });

    // Navigate to start URL if specified
    if (journey.startUrl) {
      try {
        await page.goto(journey.startUrl, {
          waitUntil: 'networkidle0',
          timeout: journey.timeout,
        });
      } catch (error) {
        return {
          success: false,
          completedSteps: 0,
          totalSteps: journey.steps.length,
          error: `Failed to load start URL: ${error.message}`,
          stepResults,
          duration: Date.now() - startTime,
        };
      }
    }

    // Execute each step
    for (let i = 0; i < journey.steps.length; i++) {
      const step = journey.steps[i];
      const stepStart = Date.now();

      try {
        await this._executeStep(page, step);

        stepResults.push({
          index: i,
          type: step.type,
          success: true,
          duration: Date.now() - stepStart,
        });

        completedSteps++;

        logger.debug('Journey step completed', {
          journey: journey.name,
          step: i + 1,
          type: step.type,
        });
      } catch (error) {
        stepResults.push({
          index: i,
          type: step.type,
          success: false,
          error: error.message,
          duration: Date.now() - stepStart,
        });

        logger.error('Journey step failed', {
          journey: journey.name,
          step: i + 1,
          type: step.type,
          error: error.message,
        });

        if (!journey.continueOnError) {
          return {
            success: false,
            completedSteps,
            totalSteps: journey.steps.length,
            error: `Step ${i + 1} (${step.type}) failed: ${error.message}`,
            failedStep: step,
            stepResults,
            duration: Date.now() - startTime,
          };
        }
      }
    }

    const allSuccess = stepResults.every(r => r.success);

    logger.info('User journey completed', {
      name: journey.name,
      success: allSuccess,
      completedSteps,
      totalSteps: journey.steps.length,
      duration: Date.now() - startTime,
    });

    return {
      success: allSuccess,
      completedSteps,
      totalSteps: journey.steps.length,
      stepResults,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Execute a single step
   */
  async _executeStep(page, step) {
    switch (step.type) {
      case StepTypes.NAVIGATE:
        await page.goto(step.url, {
          waitUntil: step.waitUntil,
          timeout: step.timeout || this.defaultTimeout,
        });
        break;

      case StepTypes.CLICK:
        await page.waitForSelector(step.selector, {
          timeout: step.timeout || this.defaultTimeout,
        });
        await page.click(step.selector);
        break;

      case StepTypes.TYPE:
        await page.waitForSelector(step.selector, {
          timeout: step.timeout || this.defaultTimeout,
        });
        if (step.clearFirst) {
          await page.click(step.selector, { clickCount: 3 });
          await page.keyboard.press('Backspace');
        }
        await page.type(step.selector, step.text, { delay: step.delay || 0 });
        break;

      case StepTypes.SELECT:
        await page.waitForSelector(step.selector, {
          timeout: step.timeout || this.defaultTimeout,
        });
        await page.select(step.selector, step.value);
        break;

      case StepTypes.WAIT:
        await new Promise(r => setTimeout(r, step.duration));
        break;

      case StepTypes.WAIT_FOR_SELECTOR:
        await page.waitForSelector(step.selector, {
          timeout: step.timeout || this.defaultTimeout,
          visible: step.visible,
          hidden: step.hidden,
        });
        break;

      case StepTypes.WAIT_FOR_NAVIGATION:
        await page.waitForNavigation({
          waitUntil: step.waitUntil,
          timeout: step.timeout || this.defaultTimeout,
        });
        break;

      case StepTypes.ASSERT_TEXT:
        const textContent = await page.$eval(
          step.selector,
          (el) => el.textContent
        );
        if (!textContent.includes(step.text)) {
          throw new Error(`Text "${step.text}" not found in ${step.selector}`);
        }
        break;

      case StepTypes.ASSERT_ELEMENT:
        const element = await page.$(step.selector);
        if (!element) {
          throw new Error(`Element "${step.selector}" not found`);
        }
        break;

      case StepTypes.ASSERT_URL:
        const currentUrl = page.url();
        const pattern = step.pattern instanceof RegExp
          ? step.pattern
          : new RegExp(step.pattern);
        if (!pattern.test(currentUrl)) {
          throw new Error(`URL "${currentUrl}" does not match pattern "${step.pattern}"`);
        }
        break;

      case StepTypes.SCREENSHOT:
        await page.screenshot({
          path: `${this.screenshotDir}/${step.filename}`,
          fullPage: step.fullPage || false,
        });
        break;

      case StepTypes.CUSTOM:
        await step.fn(page);
        break;

      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
  }
}

/**
 * Pre-built journey templates
 */
export const JourneyTemplates = {
  /**
   * Basic login flow
   */
  login: (baseUrl, credentials, selectors = {}) => {
    const journey = new UserJourney('login-flow', {
      description: 'Verify user can log in successfully',
      startUrl: `${baseUrl}/login`,
    });

    return journey
      .waitForSelector(selectors.username || '#username')
      .type(selectors.username || '#username', credentials.username)
      .type(selectors.password || '#password', credentials.password)
      .click(selectors.submit || 'button[type="submit"]')
      .waitForNavigation()
      .assertUrl(selectors.successUrlPattern || '/dashboard');
  },

  /**
   * Basic checkout flow
   */
  checkout: (baseUrl, selectors = {}) => {
    const journey = new UserJourney('checkout-flow', {
      description: 'Verify basic checkout functionality',
      startUrl: baseUrl,
    });

    return journey
      .click(selectors.addToCart || '.add-to-cart')
      .waitForSelector(selectors.cartUpdated || '.cart-count')
      .click(selectors.viewCart || '.view-cart')
      .waitForNavigation()
      .assertUrl('/cart')
      .click(selectors.checkout || '.checkout-button')
      .waitForNavigation()
      .assertUrl('/checkout');
  },

  /**
   * API health journey (via UI)
   */
  apiHealthDashboard: (baseUrl) => {
    const journey = new UserJourney('api-health-dashboard', {
      description: 'Check API health via admin dashboard',
      startUrl: `${baseUrl}/admin/health`,
    });

    return journey
      .waitForSelector('.health-status')
      .assertText('healthy', { selector: '.api-status' })
      .assertText('connected', { selector: '.db-status' });
  },
};

export default UserJourneyRunner;
