#!/usr/bin/env node

/**
 * Recon CLI
 *
 * Lightweight code intelligence for any Go + TypeScript codebase.
 * Usage: npx recon <command>
 */

import { Command } from 'commander';
import { indexCommand, serveCommand, statusCommand, cleanCommand, exportCommand } from './commands.js';

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
  .option('--embeddings', 'Generate vector embeddings for semantic search')
  .action(async (options) => {
    await indexCommand(options);
  });

program
  .command('serve')
  .description('Start MCP server on stdio, or HTTP REST API with --http. Auto-indexes if needed.')
  .option('--repo <name>', 'Serve only a specific repo index')
  .option('--http', 'Start HTTP REST API server instead of MCP stdio')
  .option('--port <number>', 'Port for HTTP server (default: 3100)', parseInt)
  .option('--no-index', 'Skip auto-indexing, use existing index as-is')
  .option('--no-watch', 'Disable file watcher (still auto-indexes)')
  .option('--projects <dirs...>', 'Additional project directories to auto-index and serve')
  .action(async (options) => {
    await serveCommand({ ...options, noIndex: options.index === false, noWatch: options.watch === false });
  });

program
  .command('export')
  .description('Export knowledge graph as Mermaid or DOT for use in PRs, docs, and diagrams')
  .option('--format <format>', 'Output format: mermaid or dot (default: mermaid)')
  .option('--package <name>', 'Filter by package name')
  .option('--type <types>', 'Filter by node types (comma-separated: Function,Class,Interface)')
  .option('--symbol <name>', 'Show ego graph around a symbol')
  .option('--depth <n>', 'Max hops from symbol (default: 2)', parseInt)
  .option('--edges <types>', 'Filter edge types (comma-separated: CALLS,EXTENDS)')
  .option('--limit <n>', 'Max nodes to include (default: 50)', parseInt)
  .option('--direction <dir>', 'Graph direction: TD or LR (default: TD for mermaid, LR for dot)')
  .option('--repo <name>', 'Use a specific repo index')
  .action(async (options) => {
    await exportCommand(options);
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
