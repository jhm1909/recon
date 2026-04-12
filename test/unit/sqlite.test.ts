/**
 * Unit Tests: SqliteStore
 *
 * Tests: initialization, node CRUD, relationship CRUD,
 * cascading deletes, FTS5 search, metadata, counts,
 * node type filtering, isTest flag, transactions.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteStore } from '../../src/storage/sqlite.js';
import { NodeType, RelationshipType, Language } from '../../src/graph/types.js';
import type { Node, Relationship } from '../../src/graph/types.js';

// ─── Helpers ────────────────────────────────────────────────────

function makeNode(id: string, name: string, overrides?: Partial<Node>): Node {
  return {
    id,
    type: NodeType.Function,
    name,
    file: 'src/test.ts',
    startLine: 1,
    endLine: 10,
    language: Language.Go,
    package: 'internal/test',
    exported: true,
    ...overrides,
  };
}

function makeRel(
  sourceId: string,
  targetId: string,
  type: RelationshipType = RelationshipType.CALLS,
  confidence = 1.0,
): Relationship {
  return {
    id: `${sourceId}-${type}-${targetId}`,
    type,
    sourceId,
    targetId,
    confidence,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('SqliteStore', () => {
  let tmpDir: string;
  let store: SqliteStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'recon-test-'));
    store = new SqliteStore(tmpDir);
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── Initialization ──────────────────────────────────────────

  it('creates .recon/recon.db on initialization', () => {
    const dbPath = join(tmpDir, '.recon', 'recon.db');
    expect(existsSync(dbPath)).toBe(true);
  });

  // ─── Node CRUD ───────────────────────────────────────────────

  it('inserts and retrieves a node', () => {
    const node = makeNode('go:func:test.Foo', 'Foo');
    store.insertNode(node);
    const retrieved = store.getNode('go:func:test.Foo');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe('go:func:test.Foo');
    expect(retrieved!.name).toBe('Foo');
    expect(retrieved!.type).toBe(NodeType.Function);
    expect(retrieved!.file).toBe('src/test.ts');
    expect(retrieved!.startLine).toBe(1);
    expect(retrieved!.endLine).toBe(10);
    expect(retrieved!.language).toBe(Language.Go);
    expect(retrieved!.package).toBe('internal/test');
    expect(retrieved!.exported).toBe(true);
  });

  it('returns null for unknown node', () => {
    expect(store.getNode('nonexistent')).toBeNull();
  });

  // ─── Relationship CRUD ───────────────────────────────────────

  it('inserts and retrieves a relationship', () => {
    const nodeA = makeNode('a', 'A');
    const nodeB = makeNode('b', 'B');
    store.insertNode(nodeA);
    store.insertNode(nodeB);

    const rel = makeRel('a', 'b');
    store.insertRelationship(rel);

    const retrieved = store.getRelationship(rel.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(rel.id);
    expect(retrieved!.type).toBe(RelationshipType.CALLS);
    expect(retrieved!.sourceId).toBe('a');
    expect(retrieved!.targetId).toBe('b');
    expect(retrieved!.confidence).toBe(1.0);
  });

  it('returns null for unknown relationship', () => {
    expect(store.getRelationship('nonexistent')).toBeNull();
  });

  it('retrieves relationships by source', () => {
    store.insertNode(makeNode('a', 'A'));
    store.insertNode(makeNode('b', 'B'));
    store.insertNode(makeNode('c', 'C'));
    store.insertRelationship(makeRel('a', 'b'));
    store.insertRelationship(makeRel('a', 'c'));

    const rels = store.getRelationshipsBySource('a');
    expect(rels).toHaveLength(2);
    expect(rels.map(r => r.targetId).sort()).toEqual(['b', 'c']);
  });

  it('retrieves relationships by target', () => {
    store.insertNode(makeNode('a', 'A'));
    store.insertNode(makeNode('b', 'B'));
    store.insertNode(makeNode('c', 'C'));
    store.insertRelationship(makeRel('a', 'c'));
    store.insertRelationship(makeRel('b', 'c'));

    const rels = store.getRelationshipsByTarget('c');
    expect(rels).toHaveLength(2);
    expect(rels.map(r => r.sourceId).sort()).toEqual(['a', 'b']);
  });

  // ─── Remove by file ──────────────────────────────────────────

  it('removes nodes by file', () => {
    store.insertNode(makeNode('a', 'A', { file: 'src/foo.ts' }));
    store.insertNode(makeNode('b', 'B', { file: 'src/foo.ts' }));
    store.insertNode(makeNode('c', 'C', { file: 'src/bar.ts' }));

    const removed = store.removeNodesByFile('src/foo.ts');
    expect(removed).toBe(2);
    expect(store.getNode('a')).toBeNull();
    expect(store.getNode('b')).toBeNull();
    expect(store.getNode('c')).not.toBeNull();
  });

  // ─── Cascading deletes ──────────────────────────────────────

  it('cascades relationship deletion when node removed', () => {
    store.insertNode(makeNode('a', 'A', { file: 'src/foo.ts' }));
    store.insertNode(makeNode('b', 'B', { file: 'src/bar.ts' }));
    store.insertRelationship(makeRel('a', 'b'));
    expect(store.relationshipCount).toBe(1);

    store.removeNodesByFile('src/foo.ts');
    expect(store.relationshipCount).toBe(0);
    expect(store.getRelationshipsByTarget('b')).toHaveLength(0);
  });

  // ─── FTS5 search ─────────────────────────────────────────────

  it('searches nodes via FTS5', () => {
    store.insertNode(makeNode('a', 'handleUserLogin', { file: 'src/auth.ts', package: 'auth' }));
    store.insertNode(makeNode('b', 'handleOrderCreate', { file: 'src/orders.ts', package: 'orders' }));
    store.insertNode(makeNode('c', 'validateUser', { file: 'src/auth.ts', package: 'auth' }));

    const results = store.search('user');
    expect(results.length).toBeGreaterThanOrEqual(2);
    const ids = results.map(n => n.id);
    expect(ids).toContain('a');
    expect(ids).toContain('c');
  });

  it('FTS5 search tokenizes camelCase', () => {
    store.insertNode(makeNode('a', 'getUserProfile', { file: 'src/user.ts' }));
    store.insertNode(makeNode('b', 'setOrderStatus', { file: 'src/order.ts' }));

    const results = store.search('profile');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.map(n => n.id)).toContain('a');
  });

  it('FTS5 search tokenizes snake_case', () => {
    store.insertNode(makeNode('a', 'get_user_profile', { file: 'src/user.ts' }));
    store.insertNode(makeNode('b', 'set_order_status', { file: 'src/order.ts' }));

    const results = store.search('profile');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.map(n => n.id)).toContain('a');
  });

  // ─── Counts ──────────────────────────────────────────────────

  it('returns node/relationship counts', () => {
    expect(store.nodeCount).toBe(0);
    expect(store.relationshipCount).toBe(0);

    store.insertNode(makeNode('a', 'A'));
    store.insertNode(makeNode('b', 'B'));
    store.insertRelationship(makeRel('a', 'b'));

    expect(store.nodeCount).toBe(2);
    expect(store.relationshipCount).toBe(1);
  });

  // ─── Filter by type ──────────────────────────────────────────

  it('filters nodes by type', () => {
    store.insertNode(makeNode('a', 'A', { type: NodeType.Function }));
    store.insertNode(makeNode('b', 'B', { type: NodeType.Struct }));
    store.insertNode(makeNode('c', 'C', { type: NodeType.Function }));

    const functions = store.getNodesByType(NodeType.Function);
    expect(functions).toHaveLength(2);
    expect(functions.map(n => n.id).sort()).toEqual(['a', 'c']);
  });

  // ─── isTest flag ─────────────────────────────────────────────

  it('handles isTest flag', () => {
    const testNode = makeNode('a', 'TestFoo');
    (testNode as any).isTest = true;
    store.insertNode(testNode);

    const retrieved = store.getNode('a');
    expect(retrieved).not.toBeNull();
    expect((retrieved as any).isTest).toBe(true);

    const normalNode = makeNode('b', 'Foo');
    store.insertNode(normalNode);
    const retrievedNormal = store.getNode('b');
    expect((retrievedNormal as any).isTest).toBe(false);
  });

  // ─── Metadata ────────────────────────────────────────────────

  it('saves and loads metadata', () => {
    store.setMeta('version', '6.0.0');
    store.setMeta('indexedAt', '2025-01-01T00:00:00Z');

    expect(store.getMeta('version')).toBe('6.0.0');
    expect(store.getMeta('indexedAt')).toBe('2025-01-01T00:00:00Z');
    expect(store.getMeta('nonexistent')).toBeNull();
  });

  it('overwrites existing metadata', () => {
    store.setMeta('version', '5.0.0');
    store.setMeta('version', '6.0.0');
    expect(store.getMeta('version')).toBe('6.0.0');
  });

  it('getAllMeta returns all key-value pairs', () => {
    store.setMeta('version', '6.0.0');
    store.setMeta('indexedAt', '2025-01-01T00:00:00Z');

    const meta = store.getAllMeta();
    expect(meta).toEqual({
      version: '6.0.0',
      indexedAt: '2025-01-01T00:00:00Z',
    });
  });

  // ─── Transactions ────────────────────────────────────────────

  it('uses transactions for batch inserts', () => {
    const nodes = Array.from({ length: 100 }, (_, i) =>
      makeNode(`node-${i}`, `Node${i}`, { file: `src/file${i}.ts` }),
    );
    store.insertNodes(nodes);
    expect(store.nodeCount).toBe(100);

    const rels = Array.from({ length: 50 }, (_, i) =>
      makeRel(`node-${i}`, `node-${i + 50}`),
    );
    store.insertRelationships(rels);
    expect(store.relationshipCount).toBe(50);
  });

  // ─── getNodes with filters ───────────────────────────────────

  it('getNodes returns all nodes when no filter', () => {
    store.insertNode(makeNode('a', 'A'));
    store.insertNode(makeNode('b', 'B'));
    const all = store.getNodes();
    expect(all).toHaveLength(2);
  });

  it('getNodes filters by type', () => {
    store.insertNode(makeNode('a', 'A', { type: NodeType.Function }));
    store.insertNode(makeNode('b', 'B', { type: NodeType.Struct }));
    const filtered = store.getNodes({ type: NodeType.Struct });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('b');
  });

  it('getNodes filters by language', () => {
    store.insertNode(makeNode('a', 'A', { language: Language.Go }));
    store.insertNode(makeNode('b', 'B', { language: Language.TypeScript }));
    const filtered = store.getNodes({ language: Language.TypeScript });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('b');
  });

  it('getNodes filters by exported', () => {
    store.insertNode(makeNode('a', 'A', { exported: true }));
    store.insertNode(makeNode('b', 'B', { exported: false }));
    const filtered = store.getNodes({ exported: true });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('a');
  });

  // ─── getNodesByFile ──────────────────────────────────────────

  it('getNodesByFile returns nodes for a specific file', () => {
    store.insertNode(makeNode('a', 'A', { file: 'src/foo.ts' }));
    store.insertNode(makeNode('b', 'B', { file: 'src/foo.ts' }));
    store.insertNode(makeNode('c', 'C', { file: 'src/bar.ts' }));

    const nodes = store.getNodesByFile('src/foo.ts');
    expect(nodes).toHaveLength(2);
    expect(nodes.map(n => n.id).sort()).toEqual(['a', 'b']);
  });

  // ─── Relationship metadata ──────────────────────────────────

  it('preserves relationship metadata', () => {
    store.insertNode(makeNode('a', 'A'));
    store.insertNode(makeNode('b', 'B'));
    store.insertRelationship({
      id: 'a-CALLS_API-b',
      type: RelationshipType.CALLS_API,
      sourceId: 'a',
      targetId: 'b',
      confidence: 0.85,
      metadata: { httpMethod: 'GET', urlPattern: '/api/users' },
    });

    const rel = store.getRelationship('a-CALLS_API-b');
    expect(rel).not.toBeNull();
    expect(rel!.metadata).toEqual({ httpMethod: 'GET', urlPattern: '/api/users' });
    expect(rel!.confidence).toBe(0.85);
  });

  // ─── Node meta (Go/TS-specific fields) ──────────────────────

  it('preserves Go-specific node fields', () => {
    store.insertNode(makeNode('go:func:auth.Validate', 'Validate', {
      language: Language.Go,
      receiver: 'AuthService',
      params: ['ctx context.Context', 'token string'],
      returnType: 'error',
    }));

    const node = store.getNode('go:func:auth.Validate');
    expect(node).not.toBeNull();
    expect(node!.receiver).toBe('AuthService');
    expect(node!.params).toEqual(['ctx context.Context', 'token string']);
    expect(node!.returnType).toBe('error');
  });

  it('preserves TS-specific node fields', () => {
    store.insertNode(makeNode('ts:comp:Button', 'Button', {
      type: NodeType.Component,
      language: Language.TypeScript,
      isDefault: true,
      props: ['onClick', 'label', 'disabled'],
    }));

    const node = store.getNode('ts:comp:Button');
    expect(node).not.toBeNull();
    expect(node!.isDefault).toBe(true);
    expect(node!.props).toEqual(['onClick', 'label', 'disabled']);
  });

  // ─── removeNode ──────────────────────────────────────────────

  it('removes a single node by id', () => {
    store.insertNode(makeNode('a', 'A'));
    store.insertNode(makeNode('b', 'B'));
    store.removeNode('a');
    expect(store.getNode('a')).toBeNull();
    expect(store.getNode('b')).not.toBeNull();
    expect(store.nodeCount).toBe(1);
  });

  it('removeNode cascades relationship deletion', () => {
    store.insertNode(makeNode('a', 'A'));
    store.insertNode(makeNode('b', 'B'));
    store.insertRelationship(makeRel('a', 'b'));
    expect(store.relationshipCount).toBe(1);

    store.removeNode('a');
    expect(store.relationshipCount).toBe(0);
  });

  // ─── close ───────────────────────────────────────────────────

  it('close() is idempotent', () => {
    store.close();
    // Second close should not throw
    expect(() => store.close()).not.toThrow();
    // Reinitialize for afterEach
    store = new SqliteStore(tmpDir);
  });
});
