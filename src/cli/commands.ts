/**
 * CLI Commands
 *
 * Implementation of index, serve, status, clean commands.
 */

import { execSync } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { KnowledgeGraph } from '../graph/graph.js';
import { analyzeTypeScript } from '../analyzers/ts-analyzer.js';
import { buildCrossLanguageEdges, extractGoRoutes } from '../analyzers/cross-language.js';
import type { APIRoute } from '../analyzers/cross-language.js';
import { saveIndex, saveSearchIndex, saveEmbeddings, loadIndex, loadEmbeddings, listRepos, loadAllRepos, defaultRepoName } from '../storage/store.js';
import { generateAgentsMd } from '../generators/agents-gen.js';
import type { IndexMeta } from '../storage/types.js';
import { startServer } from '../mcp/server.js';
import { BM25Index } from '../search/bm25.js';
import { VectorStore } from '../search/vector-store.js';
import { generateEmbeddingText, isEmbeddable } from '../search/text-generator.js';
import { initEmbedder, embedBatch, disposeEmbedder, DEFAULT_CONFIG } from '../search/embedder.js';
import { analyzeTreeSitter } from '../analyzers/tree-sitter/index.js';
import { getAvailableLanguages } from '../analyzers/tree-sitter/index.js';
import { detectCommunities } from '../graph/community.js';

/**
 * Auto-detect where TypeScript source files live.
 * Probes: apps/web/src → src/ → root (tsconfig.json present)
 */
function detectWebAppPath(projectRoot: string): string {
  // Monorepo: apps/web/src/
  if (existsSync(join(projectRoot, 'apps', 'web', 'src'))) {
    return 'apps/web';
  }
  // Standard: ./src/ with tsconfig at root
  if (existsSync(join(projectRoot, 'src')) && existsSync(join(projectRoot, 'tsconfig.json'))) {
    return '.';
  }
  // Other common mono patterns
  for (const candidate of ['packages/app', 'packages/web', 'app']) {
    if (existsSync(join(projectRoot, candidate, 'src'))) {
      return candidate;
    }
  }
  // Fallback
  return '.';
}

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

export async function indexCommand(options: { force?: boolean; repo?: string; embeddings?: boolean }): Promise<void> {
  const startTime = performance.now();
  const projectRoot = findProjectRoot();
  const repoName = options.repo;

  console.log(`[recon] Indexing from ${projectRoot}${repoName ? ` (repo: ${repoName})` : ''}...`);

  // Load previous index for incremental comparison
  const previousIndex = options.force ? null : await loadIndex(projectRoot, repoName);
  const previousHashes = previousIndex?.meta.fileHashes;

  if (previousIndex && !options.force) {
    console.log('[recon] Previous index found ??using incremental mode.');
  }

  // Build graph
  const graph = new KnowledgeGraph();

  // Run TypeScript analysis — auto-detect source location
  console.log('[recon] Analyzing TypeScript...');
  const webAppRelPath = detectWebAppPath(projectRoot);
  const tsResult = await analyzeTypeScript(projectRoot, webAppRelPath, previousHashes);

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

  // Tree-sitter analysis: Python, Rust, Java, C, C++
  const tsitterLangs = getAvailableLanguages();
  let tsitterSymbols = 0;
  let tsitterFiles = 0;
  let tsitterHashes: Record<string, string> = {};
  if (tsitterLangs.length > 0) {
    console.log(`[recon] Analyzing with tree-sitter (${tsitterLangs.join(', ')})...`);
    const tsitterResult = analyzeTreeSitter(projectRoot, previousHashes);

    for (const node of tsitterResult.result.nodes) {
      graph.addNode(node);
    }
    for (const rel of tsitterResult.result.relationships) {
      graph.addRelationship(rel);
    }

    tsitterSymbols = tsitterResult.stats.symbols;
    tsitterFiles = tsitterResult.stats.files;
    tsitterHashes = tsitterResult.fileHashes;

    if (tsitterResult.stats.files > 0) {
      const langBreakdown = Object.entries(tsitterResult.stats.languages)
        .map(([l, c]) => `${l}: ${c}`)
        .join(', ');
      console.log(
        `[recon] Tree-sitter: ${tsitterResult.stats.files} files, ` +
        `${tsitterResult.stats.symbols} symbols (${langBreakdown})`,
      );
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
  const tsFiles = tsResult.stats.files + tsResult.stats.skipped;
  const tsSymbols = tsResult.stats.components + tsResult.stats.functions;
  const elapsed = Math.round(performance.now() - startTime);

  const meta: IndexMeta = {
    version: 1,
    indexedAt: new Date().toISOString(),
    gitCommit: git.commit,
    gitBranch: git.branch,
    stats: {
      tsModules: tsFiles,
      tsSymbols,
      treeSitterFiles: tsitterFiles,
      treeSitterSymbols: tsitterSymbols,
      relationships: graph.relationshipCount,
      indexTimeMs: elapsed,
    },
    fileHashes: { ...tsResult.fileHashes, ...tsitterHashes },
    apiRoutes: crossLangResult.routes.map(r => ({
      method: r.method,
      pattern: r.pattern,
      handler: r.handler,
    })),
  };

  // Community detection
  console.log('[recon] Detecting communities...');
  const communityStats = detectCommunities(graph);
  console.log(
    `[recon] Communities: ${communityStats.communityCount} clusters in ${communityStats.iterations} iterations` +
    (communityStats.largestCommunity.size > 0
      ? ` (largest: ${communityStats.largestCommunity.label} with ${communityStats.largestCommunity.size} symbols)`
      : ''),
  );

  // Save
  // Stamp repo name on all nodes if multi-repo
  if (repoName) {
    for (const node of graph.nodes.values()) {
      node.repo = repoName;
    }
  }

  await saveIndex(projectRoot, graph, meta, repoName);

  // Generate AGENTS.md
  const agentsMd = generateAgentsMd(graph, repoName);
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const reconDir = join(projectRoot, '.recon');
  mkdirSync(reconDir, { recursive: true });
  writeFileSync(join(reconDir, 'AGENTS.md'), agentsMd);
  console.log(`[recon] Generated .recon/AGENTS.md`);

  // Build and save BM25 search index
  console.log('[recon] Building search index...');
  const searchIndex = BM25Index.buildFromGraph(graph);
  await saveSearchIndex(projectRoot, searchIndex, repoName);
  console.log(`[recon] Search index: ${searchIndex.documentCount} documents`);

  // Embedding pipeline (optional)
  if (options.embeddings) {
    console.log('[recon] Generating embeddings...');
    try {
      await initEmbedder();

      // Collect embeddable nodes
      const embeddableNodes: Array<{ id: string; text: string }> = [];
      for (const node of graph.nodes.values()) {
        if (isEmbeddable(node)) {
          embeddableNodes.push({
            id: node.id,
            text: generateEmbeddingText(node),
          });
        }
      }

      if (embeddableNodes.length > 0) {
        const texts = embeddableNodes.map(n => n.text);
        const embeddings = await embedBatch(texts);
        const vectorStore = new VectorStore(DEFAULT_CONFIG.dimensions);

        for (let i = 0; i < embeddableNodes.length; i++) {
          vectorStore.add(embeddableNodes[i].id, embeddings[i]);
        }

        await saveEmbeddings(projectRoot, vectorStore, repoName);
        console.log(`[recon] Embeddings: ${vectorStore.size} vectors (${DEFAULT_CONFIG.dimensions}d)`);
      }

      await disposeEmbedder();
    } catch (err) {
      console.error(`[recon] Embedding failed: ${err instanceof Error ? err.message : String(err)}`);
      console.error('[recon] Continuing without embeddings. Install @huggingface/transformers for semantic search.');
    }
  }

  const summary = [
    `${tsFiles} TS files`,
    `${tsSymbols} TS symbols`,
  ];
  if (tsitterSymbols > 0) {
    summary.push(`${tsitterFiles} tree-sitter files`, `${tsitterSymbols} tree-sitter symbols`);
  }
  summary.push(`${graph.relationshipCount} relationships in ${elapsed}ms`);
  console.log(`[recon] Indexed ${summary.join(', ')}`);
  console.log(`[recon] Saved to ${join(projectRoot, '.recon/')}`);
}



// ??? serve command ???????????????????????????????????????????????

export async function serveCommand(options?: { repo?: string; http?: boolean; port?: number; noIndex?: boolean }): Promise<void> {
  const projectRoot = findProjectRoot();
  const repoName = options?.repo;

  // Auto-index: check if index needs (re)building
  if (!options?.noIndex) {
    const existing = await loadIndex(projectRoot, repoName);
    const git = getGitInfo(projectRoot);
    const needsIndex = !existing || existing.meta.gitCommit !== git.commit;

    if (needsIndex) {
      const reason = !existing ? 'no index found' : 'index is stale';
      console.error(`[recon] Auto-indexing (${reason})...`);
      await indexCommand({ force: !existing, repo: repoName });
    }
  }

  let graph: KnowledgeGraph;
  let vectorStore: VectorStore | null = null;

  if (repoName) {
    // Load specific repo
    const stored = await loadIndex(projectRoot, repoName);
    if (!stored) {
      console.error(`[recon] No index found for repo '${repoName}'. Run 'npx recon index --repo ${repoName}' first.`);
      process.exit(1);
    }
    graph = stored.graph;
    vectorStore = await loadEmbeddings(projectRoot, repoName);
    console.error(`[recon] Loaded repo '${repoName}': ${graph.nodeCount} nodes, ${graph.relationshipCount} relationships`);
  } else {
    // Try loading all repos (merged), fall back to legacy single index
    const allRepos = await loadAllRepos(projectRoot);
    if (allRepos) {
      graph = allRepos.graph;
      const repoNames = allRepos.repos.map(r => r.name).join(', ');
      console.error(`[recon] Loaded ${allRepos.repos.length} repo(s) [${repoNames}]: ${graph.nodeCount} nodes, ${graph.relationshipCount} relationships`);
    } else {
      const stored = await loadIndex(projectRoot);
      if (!stored) {
        console.error("[recon] No index found. Run 'npx recon index' first.");
        process.exit(1);
      }
      graph = stored.graph;
      console.error(`[recon] Loaded index: ${graph.nodeCount} nodes, ${graph.relationshipCount} relationships`);
    }
    vectorStore = await loadEmbeddings(projectRoot, repoName);
  }

  if (vectorStore) {
    console.error(`[recon] Loaded ${vectorStore.size} embeddings (${vectorStore.dimensions}d)`);
  }

  if (options?.http) {
    const { startHttpServer } = await import('../server/http.js');
    const port = options.port || 3100;
    await startHttpServer({ port, graph, projectRoot, vectorStore });
    // Keep process alive
    await new Promise(() => { });
  } else {
    console.error('[recon] MCP server starting on stdio...');
    await startServer(graph, projectRoot, vectorStore);
  }
}

// ??? status command ??????????????????????????????????????????????

export async function statusCommand(options?: { repo?: string }): Promise<void> {
  const projectRoot = findProjectRoot();
  const repoName = options?.repo;
  const stored = await loadIndex(projectRoot, repoName);

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
  console.log(`  Tree-sitter:    ${meta.stats.treeSitterFiles || 0} files, ${meta.stats.treeSitterSymbols || 0} symbols`);
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

export function cleanCommand(options?: { repo?: string }): void {
  const projectRoot = findProjectRoot();
  const repoName = options?.repo;

  if (repoName) {
    const repoDir = join(projectRoot, '.recon', 'repos', repoName);
    if (existsSync(repoDir)) {
      rmSync(repoDir, { recursive: true, force: true });
      console.log(`[recon] Index for repo '${repoName}' cleaned.`);
    } else {
      console.log(`[recon] No index found for repo '${repoName}'.`);
    }
  } else {
    const reconDir = join(projectRoot, '.recon');
    if (existsSync(reconDir)) {
      rmSync(reconDir, { recursive: true, force: true });
      console.log('[recon] Index cleaned.');
    } else {
      console.log('[recon] No index to clean.');
    }
  }
}

