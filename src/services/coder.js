import axios from 'axios';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import { ConfigurationError, ExternalServiceError } from '../utils/errors.js';

/**
 * Coder API Client
 * The "Hands" - Sandboxed Execution Environment
 *
 * DEPENDENCY: Stream C will implement Terraform templates and workspace setup
 * Stream A provides the v2 API interface
 */

export class CoderClient {
  constructor() {
    this.baseUrl = config.coder.apiUrl;
    this.token = config.coder.apiToken;
    this.templateId = config.coder.templateId;
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Coder-Session-Token': this.token,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    });
  }

  /**
   * Create a remediation workspace
   * Uses rich_parameter_values to inject incident context
   *
   * @param {string} incidentId - Unique incident identifier
   * @param {object} parameters - Dynamic parameters to inject
   * @returns {Promise<{workspaceId: string, name: string}>}
   */
  async createWorkspace(incidentId, parameters = {}) {
    if (!this.baseUrl || !this.token) {
      logger.warn('Coder not configured');
      throw new ConfigurationError('Coder API URL or Token not configured');
    }

    const workspaceName = `remediation-${incidentId}-${Date.now()}`.substring(0, 32);

    // Build rich_parameter_values from incident context
    const richParams = [
      { name: 'INCIDENT_ID', value: incidentId },
      { name: 'CREATED_AT', value: new Date().toISOString() },
    ];

    // Add custom parameters
    for (const [key, value] of Object.entries(parameters)) {
      richParams.push({ name: key, value: String(value) });
    }

    try {
      logger.info('Creating Coder workspace', {
        name: workspaceName,
        templateId: this.templateId,
        paramCount: richParams.length,
      });

      const response = await this.client.post('/api/v2/users/me/workspaces', {
        template_id: this.templateId,
        name: workspaceName,
        rich_parameter_values: richParams,
      });

      const workspace = response.data;

      logger.info('Coder workspace created', {
        workspaceId: workspace.id,
        name: workspace.name,
      });

      return {
        workspaceId: workspace.id,
        name: workspace.name,
        latestBuildId: workspace.latest_build?.id,
      };
    } catch (error) {
      logger.error('Failed to create Coder workspace', {
        error: error.message,
        status: error.response?.status,
        details: error.response?.data,
      });
      throw error;
    }
  }

  /**
   * Wait for workspace to be ready
   * Polls build status until succeeded or failed
   *
   * @param {string} workspaceName - Workspace name
   * @param {number} maxWaitMs - Maximum wait time
   * @returns {Promise<boolean>}
   */
  async waitForWorkspace(workspaceName, maxWaitMs = 300000) {
    if (!this.baseUrl || !this.token) {
      return false;
    }

    const startTime = Date.now();
    const pollInterval = 5000; // 5 seconds

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const response = await this.client.get(
          `/api/v2/users/me/workspace/${workspaceName}`
        );

        const workspace = response.data;
        const buildStatus = workspace.latest_build?.status;

        logger.debug('Workspace build status', {
          name: workspaceName,
          status: buildStatus,
        });

        if (buildStatus === 'succeeded' || buildStatus === 'running') {
          return true;
        }

        if (buildStatus === 'failed' || buildStatus === 'canceled') {
          logger.error('Workspace build failed', {
            name: workspaceName,
            status: buildStatus,
          });
          return false;
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      } catch (error) {
        logger.error('Failed to check workspace status', {
          error: error.message,
        });
        throw error;
      }
    }

    logger.error('Workspace creation timeout', { workspaceName });
    return false;
  }

  /**
   * Execute code in the workspace via Coder CLI (SSH)
   * 
   * Uses `coder ssh` to execute commands since the API does not expose a direct exec endpoint for agents.
   * Requires `coder` CLI to be installed and accessible in the environment.
   *
   * @param {string} workspaceName - Workspace name
   * @param {string} code - Code to execute
   * @param {string} language - Code language (python, bash, etc.)
   * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>}
   */
  async executeInWorkspace(workspaceName, code, language = 'python') {
    if (!this.baseUrl || !this.token) {
      logger.warn('Coder not configured - cannot execute');
      return null;
    }

    try {
      logger.info('Preparing remediation execution', {
        workspaceName,
        language,
      });

      // Encode code to base64 to avoid escaping issues during transfer
      const codeBase64 = Buffer.from(code).toString('base64');
      const filename = language === 'python' ? 'remediation.py' : 'remediation.sh';
      const remotePath = `/tmp/${filename}`;
      
      // Construct command chain:
      // 1. Decode base64 content to file
      // 2. Execute file with appropriate interpreter
      const command = language === 'python'
        ? `echo "${codeBase64}" | base64 -d > ${remotePath} && python3 ${remotePath}`
        : `echo "${codeBase64}" | base64 -d > ${remotePath} && bash ${remotePath}`;

      // Execute via Coder CLI
      const env = {
        ...process.env,
        CODER_URL: this.baseUrl,
        CODER_SESSION_TOKEN: this.token,
      };

      // Using coder ssh to execute the command
      // -o StrictHostKeyChecking=no prevents interactive prompts
      // We use a large timeout because remediation might take time
      logger.info('Executing command via Coder SSH', { workspaceName });
      
      const { stdout, stderr } = await execAsync(
        `coder ssh ${workspaceName} -- ${command}`,
        { 
          env,
          timeout: 300000 // 5 minutes
        }
      );

      logger.info('Remediation execution complete', {
        stdoutLength: stdout?.length || 0,
        stderrLength: stderr?.length || 0,
      });

      return {
        exitCode: 0, // execAsync throws on non-zero exit code
        stdout,
        stderr
      };

    } catch (error) {
      // If execAsync fails (non-zero exit code), it throws an error with stdout/stderr
      if (error.code && typeof error.code === 'number') {
        logger.warn('Remediation execution failed (non-zero exit code)', {
          exitCode: error.code,
          workspaceName,
        });
        return {
          exitCode: error.code,
          stdout: error.stdout || '',
          stderr: error.stderr || error.message
        };
      }

      logger.error('Workspace execution error', {
        error: error.message,
        workspaceName,
      });
      throw error;
    }
  }

  /**
   * Delete/destroy workspace after use
   */
  async deleteWorkspace(workspaceName) {
    if (!this.baseUrl || !this.token) {
      return false;
    }

    try {
      // Trigger deletion build
      await this.client.post(`/api/v2/users/me/workspace/${workspaceName}/builds`, {
        transition: 'delete',
      });

      logger.info('Workspace deletion initiated', { workspaceName });
      return true;
    } catch (error) {
      logger.error('Failed to delete workspace', {
        error: error.message,
        workspaceName,
      });
      return false;
    }
  }
}

export const coderClient = new CoderClient();
export default coderClient;
