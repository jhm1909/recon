/**
 * Unit Tests: v5→v6 Migration
 *
 * Tests: detectV5Index, detectV6Index, migrateV5ToV6
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectV5Index, detectV6Index, migrateV5ToV6 } from '../../src/storage/migrate.js';
import { NodeType, RelationshipType, Language } from '../../src/graph/types.js';
import type { Node, Relationship, SerializedGraph } from '../../src/graph/types.js';

// ─── Helpers ────────────────────────────────────────────────────

function makeNode(id: string, name: string): Node {
  return {
    id,
    type: NodeType.Function,
    name,
    file: 'src/test.ts',
    startLine: 1,
    endLine: 10,
    language: Language.TypeScript,
    package: 'internal/test',
    exported: true,
  };
}

function makeRel(sourceId: string, targetId: string): Relationship {
  return {
    id: `${sourceId}-CALLS-${targetId}`,
    type: RelationshipType.CALLS,
    sourceId,
    targetId,
    confidence: 1.0,
  };
}

// ─── Test State ─────────────────────────────────────────────────

let tmpDir: string;

afterEach(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── Tests ──────────────────────────────────────────────────────

describe('detectV5Index', () => {
  it('returns true when graph.json and meta.json both exist', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'recon-migrate-'));
    const reconDir = join(tmpDir, '.recon');
    mkdirSync(reconDir, { recursive: true });
    writeFileSync(join(reconDir, 'graph.json'), '{}');
    writeFileSync(join(reconDir, 'meta.json'), '{}');

    expect(detectV5Index(tmpDir)).toBe(true);
  });

  it('returns false when no v5 index files are present', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'recon-migrate-'));
    const reconDir = join(tmpDir, '.recon');
    mkdirSync(reconDir, { recursive: true });
    // No graph.json or meta.json written

    expect(detectV5Index(tmpDir)).toBe(false);
  });
});

describe('migrateV5ToV6', () => {
  it('migrates nodes, relationships, and meta; creates backup files', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'recon-migrate-'));
    const reconDir = join(tmpDir, '.recon');
    mkdirSync(reconDir, { recursive: true });

    // Set up v5 JSON files
    const nodes: Node[] = [makeNode('ts:func:foo', 'foo'), makeNode('ts:func:bar', 'bar')];
    const relationships: Relationship[] = [makeRel('ts:func:foo', 'ts:func:bar')];
    const graph: SerializedGraph = { nodes, relationships };
    const meta = {
      gitCommit: 'abc123',
      gitBranch: 'main',
      indexedAt: '2026-01-01T00:00:00Z',
      fileHashes: { 'src/test.ts': 'deadbeef' },
      stats: { nodeCount: 2, relCount: 1 },
    };

    writeFileSync(join(reconDir, 'graph.json'), JSON.stringify(graph));
    writeFileSync(join(reconDir, 'meta.json'), JSON.stringify(meta));

    // Also write optional files to verify they get backed up
    writeFileSync(join(reconDir, 'search.json'), '[]');

    const store = await migrateV5ToV6(tmpDir);

    // Nodes were migrated
    expect(store.nodeCount).toBe(2);
    expect(store.getNode('ts:func:foo')).not.toBeNull();
    expect(store.getNode('ts:func:bar')).not.toBeNull();

    // Relationships were migrated
    expect(store.relationshipCount).toBe(1);

    // Meta was migrated
    expect(store.getMeta('gitCommit')).toBe('abc123');
    expect(store.getMeta('gitBranch')).toBe('main');
    expect(store.getMeta('indexedAt')).toBe('2026-01-01T00:00:00Z');
    expect(JSON.parse(store.getMeta('fileHashes')!)).toEqual({ 'src/test.ts': 'deadbeef' });

    // Backup files were created
    expect(existsSync(join(reconDir, 'graph.json.v5.bak'))).toBe(true);
    expect(existsSync(join(reconDir, 'meta.json.v5.bak'))).toBe(true);
    expect(existsSync(join(reconDir, 'search.json.v5.bak'))).toBe(true);

    // Original files were removed
    expect(existsSync(join(reconDir, 'graph.json'))).toBe(false);
    expect(existsSync(join(reconDir, 'meta.json'))).toBe(false);
    expect(existsSync(join(reconDir, 'search.json'))).toBe(false);

    store.close();
  });
});
