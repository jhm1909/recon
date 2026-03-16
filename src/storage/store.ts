/**
 * JSON File Store
 *
 * Reads/writes graph.json + meta.json to .recon/ directory.
 * Supports multi-repo storage under .recon/repos/{repoName}/.
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { KnowledgeGraph } from '../graph/graph.js';
import type { IndexMeta } from './types.js';
import type { BM25Index } from '../search/bm25.js';
import type { VectorStore } from '../search/vector-store.js';

const RECON_DIR = '.recon';
const REPOS_DIR = 'repos';
const GRAPH_FILE = 'graph.json';
const META_FILE = 'meta.json';
const SEARCH_FILE = 'search.json';
const EMBEDDINGS_FILE = 'embeddings.json';

export interface StoredIndex {
  graph: KnowledgeGraph;
  meta: IndexMeta;
}

export interface RepoInfo {
  name: string;
  meta: IndexMeta;
  nodeCount: number;
  relationshipCount: number;
}

/**
 * Resolve the storage directory for a repo.
 * If repoName is provided, uses .recon/repos/{repoName}/.
 * Otherwise uses legacy .recon/ (backwards compat).
 */
function getRepoDir(projectRoot: string, repoName?: string): string {
  if (repoName) {
    return join(projectRoot, RECON_DIR, REPOS_DIR, repoName);
  }
  return join(projectRoot, RECON_DIR);
}

/**
 * Derive default repo name from a project root path.
 */
export function defaultRepoName(projectRoot: string): string {
  return basename(projectRoot);
}

/**
 * Save graph and metadata to .recon/ directory.
 * Creates directory if it doesn't exist.
 * If repoName is provided, saves under .recon/repos/{repoName}/.
 */
export async function saveIndex(
  projectRoot: string,
  graph: KnowledgeGraph,
  meta: IndexMeta,
  repoName?: string,
): Promise<void> {
  const dir = getRepoDir(projectRoot, repoName);

  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  const serialized = graph.serialize();

  await Promise.all([
    writeFile(join(dir, GRAPH_FILE), JSON.stringify(serialized, null, 2), 'utf-8'),
    writeFile(join(dir, META_FILE), JSON.stringify(meta, null, 2), 'utf-8'),
  ]);
}

/**
 * Load graph and metadata from .recon/ directory.
 * Returns null if no index exists.
 * If repoName is provided, loads from .recon/repos/{repoName}/.
 */
export async function loadIndex(projectRoot: string, repoName?: string): Promise<StoredIndex | null> {
  const dir = getRepoDir(projectRoot, repoName);

  if (!existsSync(dir)) return null;

  const graphPath = join(dir, GRAPH_FILE);
  const metaPath = join(dir, META_FILE);

  if (!existsSync(graphPath) || !existsSync(metaPath)) return null;

  try {
    const [graphRaw, metaRaw] = await Promise.all([
      readFile(graphPath, 'utf-8'),
      readFile(metaPath, 'utf-8'),
    ]);

    const graph = KnowledgeGraph.deserialize(JSON.parse(graphRaw));
    const meta: IndexMeta = JSON.parse(metaRaw);

    return { graph, meta };
  } catch {
    return null;
  }
}

/**
 * Save BM25 search index to .recon/search.json.
 * If repoName is provided, saves under .recon/repos/{repoName}/.
 */
export async function saveSearchIndex(
  projectRoot: string,
  searchIndex: BM25Index,
  repoName?: string,
): Promise<void> {
  const dir = getRepoDir(projectRoot, repoName);

  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  const serialized = searchIndex.serialize();
  await writeFile(join(dir, SEARCH_FILE), JSON.stringify(serialized), 'utf-8');
}

/**
 * List all indexed repos under .recon/repos/.
 * Also checks for a legacy index directly in .recon/ and includes it as the default repo.
 */
export async function listRepos(projectRoot: string): Promise<RepoInfo[]> {
  const repos: RepoInfo[] = [];

  // Check for legacy index in .recon/ (no repo name)
  const legacyIndex = await loadIndex(projectRoot);
  if (legacyIndex) {
    repos.push({
      name: defaultRepoName(projectRoot),
      meta: legacyIndex.meta,
      nodeCount: legacyIndex.graph.nodeCount,
      relationshipCount: legacyIndex.graph.relationshipCount,
    });
  }

  // Check for repo-specific indices under .recon/repos/
  const reposDir = join(projectRoot, RECON_DIR, REPOS_DIR);
  if (!existsSync(reposDir)) return repos;

  try {
    const entries = await readdir(reposDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const repoIndex = await loadIndex(projectRoot, entry.name);
      if (repoIndex) {
        repos.push({
          name: entry.name,
          meta: repoIndex.meta,
          nodeCount: repoIndex.graph.nodeCount,
          relationshipCount: repoIndex.graph.relationshipCount,
        });
      }
    }
  } catch {
    // Ignore errors reading repos directory
  }

  return repos;
}

/**
 * Load all indexed repos and merge their graphs into a single KnowledgeGraph.
 * Each node gets its repo field set to the repo name.
 */
export async function loadAllRepos(projectRoot: string): Promise<{
  graph: KnowledgeGraph;
  repos: RepoInfo[];
} | null> {
  const repos = await listRepos(projectRoot);
  if (repos.length === 0) return null;

  const mergedGraph = new KnowledgeGraph();

  // Load legacy index
  const legacyIndex = await loadIndex(projectRoot);
  if (legacyIndex) {
    const repoName = defaultRepoName(projectRoot);
    for (const node of legacyIndex.graph.nodes.values()) {
      if (!node.repo) node.repo = repoName;
      mergedGraph.addNode(node);
    }
    for (const rel of legacyIndex.graph.relationships.values()) {
      mergedGraph.addRelationship(rel);
    }
  }

  // Load repo-specific indices
  const reposDir = join(projectRoot, RECON_DIR, REPOS_DIR);
  if (existsSync(reposDir)) {
    try {
      const entries = await readdir(reposDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const repoIndex = await loadIndex(projectRoot, entry.name);
        if (repoIndex) {
          for (const node of repoIndex.graph.nodes.values()) {
            if (!node.repo) node.repo = entry.name;
            mergedGraph.addNode(node);
          }
          for (const rel of repoIndex.graph.relationships.values()) {
            mergedGraph.addRelationship(rel);
          }
        }
      }
    } catch {
      // Ignore errors
    }
  }

  return { graph: mergedGraph, repos };
}

/**
 * Save vector embeddings to .recon/embeddings.json.
 */
export async function saveEmbeddings(
  projectRoot: string,
  vectorStore: VectorStore,
  repoName?: string,
): Promise<void> {
  const dir = getRepoDir(projectRoot, repoName);

  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  const serialized = vectorStore.serialize();
  await writeFile(join(dir, EMBEDDINGS_FILE), JSON.stringify(serialized), 'utf-8');
}

/**
 * Load vector embeddings from .recon/embeddings.json.
 * Returns null if no embeddings exist.
 */
export async function loadEmbeddings(
  projectRoot: string,
  repoName?: string,
): Promise<VectorStore | null> {
  const dir = getRepoDir(projectRoot, repoName);
  const embPath = join(dir, EMBEDDINGS_FILE);

  if (!existsSync(embPath)) return null;

  try {
    const raw = await readFile(embPath, 'utf-8');
    const { VectorStore: VS } = await import('../search/vector-store.js');
    return VS.deserialize(JSON.parse(raw));
  } catch {
    return null;
  }
}
