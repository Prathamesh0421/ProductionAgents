/**
 * Runbook Ingester
 *
 * CLI tool and library for ingesting runbooks into Senso
 * Supports: Markdown, JSON, Confluence export, Notion export
 */

import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import logger from '../../utils/logger.js';
import { sanityClient } from '../../services/sanity.js';
import {
  validateMetadata,
  buildRunbookMetadata,
  DocumentTypes,
  FailureTypes,
  SeverityLevels,
} from './schema.js';

/**
 * Runbook Ingester class
 */
export class RunbookIngester {
  constructor(options = {}) {
    this.client = options.client || sanityClient;
    this.dryRun = options.dryRun || false;
    this.verbose = options.verbose || false;
  }

  /**
   * Ingest a single markdown runbook file
   *
   * Expected markdown format:
   * ---
   * title: "Runbook Title"
   * service: payment-api
   * failure_types: [slow_query, database_deadlock]
   * severity: sev2
   * ---
   * # Runbook content...
   */
  async ingestMarkdownFile(filePath) {
    const content = await fs.readFile(filePath, 'utf-8');
    return this.ingestMarkdown(content, filePath);
  }

  /**
   * Parse and ingest markdown content
   */
  async ingestMarkdown(content, sourcePath = null) {
    // Parse frontmatter
    const { metadata, body } = this._parseMarkdownFrontmatter(content);

    if (!metadata.title) {
      // Extract title from first heading
      const headingMatch = body.match(/^#\s+(.+)$/m);
      metadata.title = headingMatch ? headingMatch[1] : path.basename(sourcePath || 'untitled');
    }

    // Set source
    metadata.source = 'markdown';
    metadata.source_url = sourcePath;

    // Validate
    const validation = validateMetadata(metadata);
    if (!validation.valid) {
      logger.warn('Invalid runbook metadata', {
        file: sourcePath,
        errors: validation.errors,
      });
      return { success: false, errors: validation.errors };
    }

    // Optimize content for RAG
    const optimizedContent = this._optimizeForRAG(body, metadata);

    if (this.dryRun) {
      logger.info('DRY RUN - Would ingest runbook', {
        title: metadata.title,
        service: metadata.service,
        contentLength: optimizedContent.length,
      });
      return { success: true, dryRun: true, metadata };
    }

    // Ingest to Sanity
    const result = await this.client.ingestContent(optimizedContent, metadata);

    logger.info('Runbook ingested', {
      title: metadata.title,
      service: metadata.service,
      id: result?.id,
    });

    return { success: true, id: result?.id, metadata };
  }

  /**
   * Ingest a JSON runbook (structured format)
   */
  async ingestJsonFile(filePath) {
    const content = await fs.readFile(filePath, 'utf-8');
    const runbook = JSON.parse(content);
    return this.ingestJson(runbook, filePath);
  }

  /**
   * Ingest structured JSON runbook
   *
   * Expected format:
   * {
   *   "title": "...",
   *   "service": "...",
   *   "failure_types": [...],
   *   "steps": [
   *     {"description": "...", "command": "...", "expected_output": "..."},
   *     ...
   *   ]
   * }
   */
  async ingestJson(runbook, sourcePath = null) {
    const metadata = buildRunbookMetadata({
      title: runbook.title,
      service: runbook.service,
      relatedServices: runbook.related_services,
      failureTypes: runbook.failure_types,
      severity: runbook.severity,
      source: 'json',
      sourceUrl: sourcePath,
      author: runbook.author,
      keywords: runbook.keywords,
      errorPatterns: runbook.error_patterns,
      executionPayload: runbook.execution_payload,
    });

    // Convert steps to prose for better RAG
    const content = this._stepsToMarkdown(runbook);
    const optimizedContent = this._optimizeForRAG(content, metadata);

    if (this.dryRun) {
      logger.info('DRY RUN - Would ingest JSON runbook', {
        title: metadata.title,
        service: metadata.service,
      });
      return { success: true, dryRun: true, metadata };
    }

    const result = await this.client.ingestContent(optimizedContent, metadata);

    return { success: true, id: result?.id, metadata };
  }

  /**
   * Batch ingest from a directory
   */
  async ingestDirectory(dirPath, options = {}) {
    const { pattern = '**/*.{md,json}', recursive = true } = options;

    const files = await glob(pattern, {
      cwd: dirPath,
      nodir: true,
      absolute: true,
    });

    logger.info('Starting batch ingestion', {
      directory: dirPath,
      fileCount: files.length,
    });

    const results = {
      total: files.length,
      success: 0,
      failed: 0,
      errors: [],
    };

    for (const file of files) {
      try {
        const ext = path.extname(file).toLowerCase();

        if (ext === '.md') {
          await this.ingestMarkdownFile(file);
        } else if (ext === '.json') {
          await this.ingestJsonFile(file);
        }

        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({ file, error: error.message });
        logger.error('Failed to ingest file', { file, error: error.message });
      }
    }

    logger.info('Batch ingestion complete', results);
    return results;
  }

  /**
   * Parse markdown frontmatter (YAML between --- delimiters)
   */
  _parseMarkdownFrontmatter(content) {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      return { metadata: { type: DocumentTypes.RUNBOOK }, body: content };
    }

    const frontmatter = match[1];
    const body = match[2];

    // Simple YAML parsing (key: value pairs)
    const metadata = { type: DocumentTypes.RUNBOOK };

    for (const line of frontmatter.split('\n')) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;

      const key = line.substring(0, colonIndex).trim();
      let value = line.substring(colonIndex + 1).trim();

      // Parse arrays [item1, item2]
      if (value.startsWith('[') && value.endsWith(']')) {
        value = value.slice(1, -1).split(',').map(s => s.trim().replace(/['"]/g, ''));
      }
      // Remove quotes from strings
      else if ((value.startsWith('"') && value.endsWith('"')) ||
               (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      metadata[key] = value;
    }

    return { metadata, body };
  }

  /**
   * Convert structured steps to markdown
   */
  _stepsToMarkdown(runbook) {
    const parts = [`# ${runbook.title}\n`];

    if (runbook.description) {
      parts.push(`${runbook.description}\n`);
    }

    if (runbook.prerequisites) {
      parts.push('## Prerequisites\n');
      for (const prereq of runbook.prerequisites) {
        parts.push(`- ${prereq}`);
      }
      parts.push('');
    }

    if (runbook.steps) {
      parts.push('## Steps\n');
      for (let i = 0; i < runbook.steps.length; i++) {
        const step = runbook.steps[i];
        parts.push(`### Step ${i + 1}: ${step.description}\n`);

        if (step.command) {
          parts.push('```bash');
          parts.push(step.command);
          parts.push('```\n');
        }

        if (step.expected_output) {
          parts.push(`**Expected output:** ${step.expected_output}\n`);
        }

        if (step.warning) {
          parts.push(`> ⚠️ **Warning:** ${step.warning}\n`);
        }
      }
    }

    if (runbook.rollback) {
      parts.push('## Rollback Procedure\n');
      parts.push(runbook.rollback);
    }

    return parts.join('\n');
  }

  /**
   * Optimize content for RAG retrieval
   * - Keep within token limits
   * - Add semantic markers
   * - Remove noise
   */
  _optimizeForRAG(content, metadata) {
    let optimized = content;

    // Add semantic header for better embedding
    const header = [
      `[SERVICE: ${metadata.service}]`,
      metadata.failure_types?.length > 0 ? `[FAILURE_TYPES: ${metadata.failure_types.join(', ')}]` : '',
      metadata.severity ? `[SEVERITY: ${metadata.severity}]` : '',
      '',
    ].filter(Boolean).join('\n');

    optimized = header + optimized;

    // Truncate if too long (target ~4000 tokens ≈ 16000 chars)
    const MAX_LENGTH = 16000;
    if (optimized.length > MAX_LENGTH) {
      optimized = optimized.substring(0, MAX_LENGTH);
      optimized += '\n\n[TRUNCATED - See full document in source]';
    }

    // Remove excessive whitespace
    optimized = optimized.replace(/\n{3,}/g, '\n\n');

    return optimized;
  }
}

/**
 * CLI entry point
 */
export async function runCLI(args) {
  const ingester = new RunbookIngester({
    dryRun: args.includes('--dry-run'),
    verbose: args.includes('--verbose'),
  });

  const pathArg = args.find(a => !a.startsWith('--'));

  if (!pathArg) {
    console.log('Usage: node runbook-ingester.js <path> [--dry-run] [--verbose]');
    console.log('  path: File or directory to ingest');
    process.exit(1);
  }

  const stat = await fs.stat(pathArg);

  if (stat.isDirectory()) {
    await ingester.ingestDirectory(pathArg);
  } else {
    const ext = path.extname(pathArg).toLowerCase();
    if (ext === '.md') {
      await ingester.ingestMarkdownFile(pathArg);
    } else if (ext === '.json') {
      await ingester.ingestJsonFile(pathArg);
    } else {
      console.error('Unsupported file type:', ext);
      process.exit(1);
    }
  }
}

// Run CLI if executed directly
if (process.argv[1]?.endsWith('runbook-ingester.js')) {
  runCLI(process.argv.slice(2)).catch(console.error);
}

export default RunbookIngester;
