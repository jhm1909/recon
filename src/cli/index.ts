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
  .action(async (options) => {
    await indexCommand(options);
  });

program
  .command('serve')
  .description('Start MCP server on stdio')
  .action(async () => {
    await serveCommand();
  });

program
  .command('status')
  .description('Show index status')
  .action(async () => {
    await statusCommand();
  });

program
  .command('clean')
  .description('Delete the .recon/ index directory')
  .action(() => {
    cleanCommand();
  });

program.parse();
