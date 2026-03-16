#!/usr/bin/env node

/**
 * Recon CLI
 *
 * Lightweight code intelligence for any Go + TypeScript codebase.
 * Usage: npx recon <command>
 */

import { Command } from 'commander';
import { indexCommand, serveCommand, statusCommand, cleanCommand } from './commands.js';

const program = new Command();

program
  .name('recon')
  .version('1.0.0')
  .description('Lightweight code intelligence for Go + TypeScript codebases');

program
  .command('index')
  .description('Index the codebase (Go packages + TypeScript modules)')
  .option('--force', 'Force full re-index (skip incremental)')
  .option('--repo <name>', 'Store index under a named repo (for multi-repo support)')
  .action(async (options) => {
    await indexCommand(options);
  });

program
  .command('serve')
  .description('Start MCP server on stdio')
  .option('--repo <name>', 'Serve only a specific repo index')
  .action(async (options) => {
    await serveCommand(options);
  });

program
  .command('status')
  .description('Show index status')
  .option('--repo <name>', 'Show status for a specific repo index')
  .action(async (options) => {
    await statusCommand(options);
  });

program
  .command('clean')
  .description('Delete the .recon/ index directory')
  .option('--repo <name>', 'Clean only a specific repo index')
  .action((options) => {
    cleanCommand(options);
  });

program.parse();
