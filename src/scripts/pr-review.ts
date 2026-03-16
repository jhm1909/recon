/**
 * PR Review Script
 *
 * Loads the Recon index, runs change detection against a base branch,
 * and outputs a markdown report suitable for posting as a PR comment.
 *
 * Usage: node dist/scripts/pr-review.js [base-branch]
 */

import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { loadIndex, loadAllRepos } from '../storage/store.js';
import { handleToolCall } from '../mcp/handlers.js';
import type { KnowledgeGraph } from '../graph/graph.js';

async function main(): Promise<void> {
  const base = process.argv[2] || 'main';
  const projectRoot = resolveProjectRoot();

  // Load index
  const graph = await loadGraph(projectRoot);

  // Detect changes against base branch
  let detectResult: string;
  try {
    detectResult = await handleToolCall(
      'recon_detect_changes',
      { scope: 'branch', base },
      graph,
      projectRoot,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[recon] Change detection failed: ${msg}`);
    process.exit(1);
  }

  // Parse risk level from output
  const riskMatch = detectResult.match(/\*\*Risk:\*\*\s*(\w+)/);
  const risk = riskMatch ? riskMatch[1] : 'UNKNOWN';

  // Parse stats from output
  const filesMatch = detectResult.match(/\*\*Changed files:\*\*\s*(\d+)/);
  const changedFiles = filesMatch ? parseInt(filesMatch[1], 10) : 0;
  const symbolsMatch = detectResult.match(/\*\*Changed symbols:\*\*\s*(.+)/);
  const symbolsSummary = symbolsMatch ? symbolsMatch[1] : '';
  const affectedMatch = detectResult.match(/\*\*Affected symbols:\*\*\s*(.+)/);
  const affectedSummary = affectedMatch ? affectedMatch[1] : '';

  // No changes = skip comment
  if (detectResult.includes('No changes detected')) {
    console.error('[recon] No changes detected, skipping report.');
    return;
  }

  // Risk emoji + color
  const riskInfo: Record<string, { emoji: string; color: string }> = {
    LOW:      { emoji: '\u{1f7e2}', color: 'green' },
    MEDIUM:   { emoji: '\u{1f7e1}', color: 'yellow' },
    HIGH:     { emoji: '\u{1f7e0}', color: 'orange' },
    CRITICAL: { emoji: '\u{1f534}', color: 'red' },
  };
  const { emoji, color } = riskInfo[risk] || { emoji: '\u26aa', color: 'gray' };

  // Get current branch info
  let branchName = 'unknown';
  try {
    branchName = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
  } catch { /* ignore */ }

  // Build PR comment
  const lines: string[] = [
    `## ${emoji} Recon: Blast Radius Analysis`,
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| **Risk Level** | \`${risk}\` |`,
    `| **Changed Files** | ${changedFiles} |`,
    `| **Changed Symbols** | ${symbolsSummary} |`,
    `| **Affected Symbols** | ${affectedSummary} |`,
    `| **Base Branch** | \`${base}\` |`,
    '',
    '<details>',
    '<summary>Full Analysis Report</summary>',
    '',
    detectResult,
    '',
    '</details>',
    '',
    '---',
    `_Analysis by [Recon](https://github.com/jhm1909/recon) v5 \u2014 code intelligence engine_`,
  ];

  // Output to stdout (GitHub Action captures this)
  console.log(lines.join('\n'));
}

/**
 * Resolve project root via git.
 */
function resolveProjectRoot(): string {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
  } catch {
    return resolve('.');
  }
}

/**
 * Load graph from index, trying all-repos merge then single index.
 */
async function loadGraph(projectRoot: string): Promise<KnowledgeGraph> {
  // Try multi-repo first
  const allRepos = await loadAllRepos(projectRoot);
  if (allRepos) {
    console.error(
      `[recon] Loaded ${allRepos.repos.length} repo(s): ${allRepos.graph.nodeCount} nodes`,
    );
    return allRepos.graph;
  }

  // Single index
  const stored = await loadIndex(projectRoot);
  if (!stored) {
    console.error('[recon] No index found. Run "npx recon index" first.');
    process.exit(1);
  }

  console.error(
    `[recon] Loaded index: ${stored.graph.nodeCount} nodes, ${stored.graph.relationshipCount} relationships`,
  );
  return stored.graph;
}

main().catch((err) => {
  console.error(`[recon] Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
