/**
 * JSON File Store
 *
 * Reads/writes graph.json + meta.json to .codemap/ directory.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { KnowledgeGraph } from '../graph/graph.js';
import type { IndexMeta } from './types.js';

const CODEMAP_DIR = '.codemap';
const GRAPH_FILE = 'graph.json';
const META_FILE = 'meta.json';

export interface StoredIndex {
  graph: KnowledgeGraph;
  meta: IndexMeta;
}

/**
 * Save graph and metadata to .codemap/ directory.
 * Creates directory if it doesn't exist.
 */
export async function saveIndex(
  projectRoot: string,
  graph: KnowledgeGraph,
  meta: IndexMeta,
): Promise<void> {
  const dir = join(projectRoot, CODEMAP_DIR);

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
 * Load graph and metadata from .codemap/ directory.
 * Returns null if no index exists.
 */
export async function loadIndex(projectRoot: string): Promise<StoredIndex | null> {
  const dir = join(projectRoot, CODEMAP_DIR);

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
