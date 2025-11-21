import axios from 'axios';
import config from '../config/index.js';
import logger from '../utils/logger.js';

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
      logger.warn('Coder not configured - cannot create workspace');
      return null;
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
   * Execute code in the workspace via agent API
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
      // First, get workspace agents
      const workspaceResp = await this.client.get(
        `/api/v2/users/me/workspace/${workspaceName}`
      );

      const agents = workspaceResp.data.latest_build?.resources
        ?.flatMap(r => r.agents || []) || [];

      if (agents.length === 0) {
        throw new Error('No agents found in workspace');
      }

      const agentId = agents[0].id;

      // Write code to file and execute
      const filename = language === 'python' ? 'remediation.py' : 'remediation.sh';
      const command = language === 'python'
        ? `python3 /tmp/${filename}`
        : `bash /tmp/${filename}`;

      // Use the exec endpoint
      logger.info('Executing remediation in workspace', {
        workspaceName,
        agentId,
        language,
      });

      // First write the file
      const writeCmd = `cat > /tmp/${filename} << 'REMEDIATION_EOF'\n${code}\nREMEDIATION_EOF`;

      await this._execCommand(agentId, writeCmd);

      // Then execute
      const result = await this._execCommand(agentId, command);

      logger.info('Remediation execution complete', {
        exitCode: result.exitCode,
        stdoutLength: result.stdout?.length || 0,
        hasErrors: !!result.stderr,
      });

      return result;
    } catch (error) {
      logger.error('Workspace execution failed', {
        error: error.message,
        workspaceName,
      });
      throw error;
    }
  }

  /**
   * Execute a command via agent API
   */
  async _execCommand(agentId, command) {
    const response = await this.client.post(`/api/v2/workspaceagents/${agentId}/exec`, {
      command: command,
      timeout: 300, // 5 min timeout
    });

    return {
      exitCode: response.data.exit_code || 0,
      stdout: response.data.stdout || '',
      stderr: response.data.stderr || '',
    };
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
