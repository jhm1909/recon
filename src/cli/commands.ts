/**
 * CLI Commands
 *
 * Implementation of index, serve, status, clean commands.
 */

import { execSync } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { KnowledgeGraph } from '../graph/graph.js';
import { analyzeGoPackages, runGoList, getModulePath, analyzeGoSymbols } from '../analyzers/go-analyzer.js';
import { analyzeTypeScript } from '../analyzers/ts-analyzer.js';
import { buildCrossLanguageEdges, extractGoRoutes } from '../analyzers/cross-language.js';
import type { APIRoute } from '../analyzers/cross-language.js';
import { saveIndex, saveSearchIndex, loadIndex } from '../storage/store.js';
import type { IndexMeta } from '../storage/types.js';
import { startServer } from '../mcp/server.js';
import { BM25Index } from '../search/bm25.js';

/**
 * Find project root by walking up to find go.mod.
 */
function findProjectRoot(from: string = process.cwd()): string {
  let dir = resolve(from);
  while (dir !== resolve(dir, '..')) {
    if (existsSync(join(dir, 'go.mod'))) return dir;
    dir = resolve(dir, '..');
  }
  // Fallback: use cwd
  return process.cwd();
}

/**
 * Get current git commit and branch.
 */
function getGitInfo(cwd: string): { commit: string; branch: string } {
  try {
    const commit = execSync('git rev-parse --short HEAD', { cwd, encoding: 'utf-8' }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf-8' }).trim();
    return { commit, branch };
  } catch {
    return { commit: 'unknown', branch: 'unknown' };
  }
}

// ??? index command ???????????????????????????????????????????????

export async function indexCommand(options: { force?: boolean }): Promise<void> {
  const startTime = performance.now();
  const projectRoot = findProjectRoot();

  console.log(`[recon] Indexing from ${projectRoot}...`);

  // Load previous index for incremental comparison
  const previousIndex = options.force ? null : await loadIndex(projectRoot);
  const previousHashes = previousIndex?.meta.fileHashes;

  if (previousIndex && !options.force) {
    console.log('[recon] Previous index found ??using incremental mode.');
  }

  // Run Go package analysis
  console.log('[recon] Analyzing Go packages...');
  const modulePath = getModulePath(projectRoot);
  const packages = runGoList(projectRoot);
  const goResult = analyzeGoPackages(projectRoot);

  // Run Go symbol analysis (incremental)
  console.log('[recon] Analyzing Go symbols...');
  const symbolResult = await analyzeGoSymbols(
    projectRoot,
    packages,
    modulePath,
    previousHashes,
  );

  if (symbolResult.stats.skipped > 0) {
    console.log(
      `[recon] Incremental: analyzed ${symbolResult.stats.analyzed} packages, ` +
      `skipped ${symbolResult.stats.skipped} unchanged`,
    );
  }

  // Build graph
  const graph = new KnowledgeGraph();

  // Add package-level nodes and edges
  for (const node of goResult.nodes) {
    graph.addNode(node);
  }
  for (const rel of goResult.relationships) {
    graph.addRelationship(rel);
  }

  // Add symbol-level nodes and edges
  for (const node of symbolResult.result.nodes) {
    graph.addNode(node);
  }
  for (const rel of symbolResult.result.relationships) {
    graph.addRelationship(rel);
  }

  // If incremental, re-add symbols from unchanged packages (from previous index)
  if (previousIndex && symbolResult.stats.skipped > 0) {
    const analyzedPkgs = new Set(
      symbolResult.result.nodes.map((n) => n.package),
    );

    for (const [, node] of previousIndex.graph.nodes) {
      // Only carry over symbol nodes from packages that were skipped
      if (node.type === 'Package' || node.type === 'File') continue;
      if (analyzedPkgs.has(node.package)) continue;
      if (node.language !== 'go') continue;
      if (!graph.getNode(node.id)) {
        graph.addNode(node);
      }
    }

    // Carry over relationships for skipped packages
    for (const rel of previousIndex.graph.allRelationships()) {
      if (!graph.getRelationship(rel.id)) {
        // Only add if both source and target exist
        if (graph.getNode(rel.sourceId) || graph.getNode(rel.targetId)) {
          graph.addRelationship(rel);
        }
      }
    }
  }

  // Run TypeScript analysis
  console.log('[recon] Analyzing TypeScript...');
  const tsResult = await analyzeTypeScript(projectRoot, 'apps/web', previousHashes);

  if (tsResult.stats.skipped > 0) {
    console.log(
      `[recon] Incremental TS: analyzed ${tsResult.stats.files} files, ` +
      `skipped ${tsResult.stats.skipped} unchanged`,
    );
  }

  // Add TS nodes and edges
  for (const node of tsResult.result.nodes) {
    graph.addNode(node);
  }
  for (const rel of tsResult.result.relationships) {
    graph.addRelationship(rel);
  }

  // If incremental, carry over unchanged TS symbols from previous index
  if (previousIndex && tsResult.stats.skipped > 0) {
    const analyzedTsFiles = new Set(
      tsResult.result.nodes
        .filter((n) => n.type === 'File' && n.language === 'typescript')
        .map((n) => n.file),
    );

    for (const [, node] of previousIndex.graph.nodes) {
      if (node.language !== 'typescript') continue;
      if (node.type === 'File' && analyzedTsFiles.has(node.file)) continue;
      if (node.type !== 'File' && analyzedTsFiles.has(node.file)) continue;
      if (!graph.getNode(node.id)) {
        graph.addNode(node);
      }
    }

    for (const rel of previousIndex.graph.allRelationships()) {
      if (!graph.getRelationship(rel.id)) {
        if (graph.getNode(rel.sourceId) || graph.getNode(rel.targetId)) {
          graph.addRelationship(rel);
        }
      }
    }
  }

  // Cross-language analysis: link TS API calls to Go handlers
  console.log('[recon] Analyzing cross-language API links...');
  const existingNodeIds = new Set<string>();
  for (const [id] of graph.nodes) existingNodeIds.add(id);

  const crossLangResult = buildCrossLanguageEdges(projectRoot, existingNodeIds);
  for (const node of crossLangResult.result.nodes) {
    graph.addNode(node);
  }
  for (const rel of crossLangResult.result.relationships) {
    graph.addRelationship(rel);
  }
  console.log(
    `[recon] Found ${crossLangResult.routes.length} API routes, ` +
    `${crossLangResult.result.relationships.length} cross-language edges`,
  );

  // Git info
  const git = getGitInfo(projectRoot);

  // Count stats
  const goPackages = goResult.nodes.filter((n) => n.type === 'Package').length;
  const goSymbols = symbolResult.result.nodes.length +
    (previousIndex && symbolResult.stats.skipped > 0
      ? countPreviousSymbols(previousIndex.graph, symbolResult.result.nodes)
      : 0);
  const tsFiles = tsResult.stats.files + tsResult.stats.skipped;
  const tsSymbols = tsResult.stats.components + tsResult.stats.functions;
  const elapsed = Math.round(performance.now() - startTime);

  const meta: IndexMeta = {
    version: 1,
    indexedAt: new Date().toISOString(),
    gitCommit: git.commit,
    gitBranch: git.branch,
    stats: {
      goPackages,
      goSymbols,
      tsModules: tsFiles,
      tsSymbols,
      relationships: graph.relationshipCount,
      indexTimeMs: elapsed,
    },
    fileHashes: { ...symbolResult.fileHashes, ...tsResult.fileHashes },
    apiRoutes: crossLangResult.routes.map(r => ({
      method: r.method,
      pattern: r.pattern,
      handler: r.handler,
    })),
  };

  // Save
  await saveIndex(projectRoot, graph, meta);

  // Build and save BM25 search index
  console.log('[recon] Building search index...');
  const searchIndex = BM25Index.buildFromGraph(graph);
  await saveSearchIndex(projectRoot, searchIndex);
  console.log(`[recon] Search index: ${searchIndex.documentCount} documents`);

  console.log(
    `[recon] Indexed ${goPackages} Go packages, ${goSymbols} Go symbols, ` +
    `${tsFiles} TS files, ${tsSymbols} TS symbols, ` +
    `${graph.relationshipCount} relationships in ${elapsed}ms`,
  );
  console.log(`[recon] Saved to ${join(projectRoot, '.recon/')}`);
}

/**
 * Count symbol nodes from the previous graph that are from packages
 * NOT in the newly analyzed set.
 */
function countPreviousSymbols(
  prevGraph: KnowledgeGraph,
  newNodes: import('../graph/types.js').Node[],
): number {
  const analyzedPkgs = new Set(newNodes.map((n) => n.package));
  let count = 0;
  for (const [, node] of prevGraph.nodes) {
    if (node.type === 'Package' || node.type === 'File') continue;
    if (node.language !== 'go') continue;
    if (analyzedPkgs.has(node.package)) continue;
    count++;
  }
  return count;
}

// ??? serve command ???????????????????????????????????????????????

export async function serveCommand(): Promise<void> {
  const projectRoot = findProjectRoot();
  const stored = await loadIndex(projectRoot);

  if (!stored) {
    console.error("[recon] No index found. Run 'npx recon index' first.");
    process.exit(1);
  }

  console.error(`[recon] Loaded index: ${stored.graph.nodeCount} nodes, ${stored.graph.relationshipCount} relationships`);
  console.error('[recon] MCP server starting on stdio...');

  await startServer(stored.graph);
}

// ??? status command ??????????????????????????????????????????????

export async function statusCommand(): Promise<void> {
  const projectRoot = findProjectRoot();
  const stored = await loadIndex(projectRoot);

  if (!stored) {
    console.log('[recon] No index found. Run "npx recon index" first.');
    return;
  }

  const { meta, graph } = stored;
  const git = getGitInfo(projectRoot);
  const stale = meta.gitCommit !== git.commit;

  console.log('Recon Index Status');
  console.log('='.repeat(34));
  console.log(`  Indexed at:     ${meta.indexedAt}`);
  console.log(`  Git commit:     ${meta.gitCommit}${stale ? ` (HEAD is ${git.commit} ??STALE)` : ' (current)'}`);
  console.log(`  Git branch:     ${meta.gitBranch}`);
  console.log(`  Go packages:    ${meta.stats.goPackages}`);
  console.log(`  Go symbols:     ${meta.stats.goSymbols}`);
  console.log(`  TS modules:     ${meta.stats.tsModules}`);
  console.log(`  TS symbols:     ${meta.stats.tsSymbols}`);
  console.log(`  Relationships:  ${meta.stats.relationships}`);
  console.log(`  Total nodes:    ${graph.nodeCount}`);
  console.log(`  Index time:     ${meta.stats.indexTimeMs}ms`);

  if (stale) {
    console.log('');
    console.log('  ??Index is stale. Run "npx recon index" to update.');
  }
}

// ??? clean command ???????????????????????????????????????????????

export function cleanCommand(): void {
  const projectRoot = findProjectRoot();
  const reconDir = join(projectRoot, '.recon');

  if (existsSync(reconDir)) {
    rmSync(reconDir, { recursive: true, force: true });
    console.log('[recon] Index cleaned.');
  } else {
    console.log('[recon] No index to clean.');
  }
}

