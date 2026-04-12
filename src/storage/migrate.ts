import { existsSync, readFileSync, renameSync } from 'fs';
import { join } from 'path';
import { SqliteStore } from './sqlite.js';
import type { SerializedGraph } from '../graph/types.js';

const RECON_DIR = '.recon';

export function detectV5Index(projectRoot: string): boolean {
  const reconDir = join(projectRoot, RECON_DIR);
  return existsSync(join(reconDir, 'graph.json')) && existsSync(join(reconDir, 'meta.json'));
}

export function detectV6Index(projectRoot: string): boolean {
  return existsSync(join(projectRoot, RECON_DIR, 'recon.db'));
}

export async function migrateV5ToV6(projectRoot: string): Promise<SqliteStore> {
  const reconDir = join(projectRoot, RECON_DIR);
  const graphData: SerializedGraph = JSON.parse(readFileSync(join(reconDir, 'graph.json'), 'utf-8'));
  const metaData = JSON.parse(readFileSync(join(reconDir, 'meta.json'), 'utf-8'));

  const store = new SqliteStore(projectRoot);
  if (graphData.nodes.length > 0) store.insertNodes(graphData.nodes);
  if (graphData.relationships.length > 0) store.insertRelationships(graphData.relationships);

  if (metaData.gitCommit) store.setMeta('gitCommit', metaData.gitCommit);
  if (metaData.gitBranch) store.setMeta('gitBranch', metaData.gitBranch);
  if (metaData.indexedAt) store.setMeta('indexedAt', metaData.indexedAt);
  if (metaData.fileHashes) store.setMeta('fileHashes', JSON.stringify(metaData.fileHashes));
  if (metaData.stats) store.setMeta('stats', JSON.stringify(metaData.stats));

  renameSync(join(reconDir, 'graph.json'), join(reconDir, 'graph.json.v5.bak'));
  renameSync(join(reconDir, 'meta.json'), join(reconDir, 'meta.json.v5.bak'));
  for (const f of ['search.json', 'embeddings.json']) {
    const p = join(reconDir, f);
    if (existsSync(p)) renameSync(p, p + '.v5.bak');
  }

  return store;
}
