/**
 * Unit Tests: KnowledgeGraph
 *
 * Tests: addNode, addRelationship, getNode, getRelationship,
 * getIncoming, getOutgoing, findByName, removeNodesByFile,
 * serialize, deserialize, counts.
 */
import { describe, it, expect } from 'vitest';
import { KnowledgeGraph } from '../../src/graph/graph.js';
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
): Relationship {
  return {
    id: `${sourceId}-${type}-${targetId}`,
    type,
    sourceId,
    targetId,
    confidence: 1.0,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('KnowledgeGraph', () => {
  // ─── addNode / getNode ──────────────────────────────────────

  it('adds and retrieves a node', () => {
    const g = new KnowledgeGraph();
    const node = makeNode('go:func:test.Foo', 'Foo');
    g.addNode(node);
    expect(g.getNode('go:func:test.Foo')).toBe(node);
  });

  it('returns undefined for unknown node', () => {
    const g = new KnowledgeGraph();
    expect(g.getNode('nonexistent')).toBeUndefined();
  });

  it('overwrites node with same id', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('go:func:test.Foo', 'Foo'));
    g.addNode(makeNode('go:func:test.Foo', 'FooV2'));
    expect(g.nodeCount).toBe(1);
    expect(g.getNode('go:func:test.Foo')!.name).toBe('FooV2');
  });

  // ─── addRelationship / getRelationship ──────────────────────

  it('adds and retrieves a relationship', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('a', 'A'));
    g.addNode(makeNode('b', 'B'));
    const rel = makeRel('a', 'b');
    g.addRelationship(rel);
    expect(g.getRelationship(rel.id)).toBe(rel);
  });

  it('returns undefined for unknown relationship', () => {
    const g = new KnowledgeGraph();
    expect(g.getRelationship('nope')).toBeUndefined();
  });

  it('duplicate addRelationship overwrites', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('a', 'A'));
    g.addNode(makeNode('b', 'B'));
    g.addRelationship(makeRel('a', 'b'));
    g.addRelationship(makeRel('a', 'b'));
    expect(g.relationshipCount).toBe(1);
  });

  // ─── nodeCount / relationshipCount ──────────────────────────

  it('nodeCount reflects current state', () => {
    const g = new KnowledgeGraph();
    expect(g.nodeCount).toBe(0);
    g.addNode(makeNode('a', 'A'));
    expect(g.nodeCount).toBe(1);
    g.addNode(makeNode('b', 'B'));
    expect(g.nodeCount).toBe(2);
  });

  it('relationshipCount reflects current state', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('a', 'A'));
    g.addNode(makeNode('b', 'B'));
    expect(g.relationshipCount).toBe(0);
    g.addRelationship(makeRel('a', 'b'));
    expect(g.relationshipCount).toBe(1);
  });

  // ─── findByName ─────────────────────────────────────────────

  it('findByName returns exact case-insensitive matches', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('a', 'Middleware'));
    g.addNode(makeNode('b', 'middleware'));
    g.addNode(makeNode('c', 'MiddlewareHelper'));
    const results = g.findByName('middleware');
    expect(results).toHaveLength(2);
    expect(results.map(n => n.id).sort()).toEqual(['a', 'b']);
  });

  it('findByName returns empty for no match', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('a', 'Foo'));
    expect(g.findByName('Bar')).toHaveLength(0);
  });

  // ─── getIncoming / getOutgoing ──────────────────────────────

  it('getIncoming returns relationships targeting a node', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('a', 'A'));
    g.addNode(makeNode('b', 'B'));
    g.addNode(makeNode('c', 'C'));
    g.addRelationship(makeRel('a', 'b'));
    g.addRelationship(makeRel('c', 'b'));

    const incoming = g.getIncoming('b');
    expect(incoming).toHaveLength(2);
    expect(incoming.map(r => r.sourceId).sort()).toEqual(['a', 'c']);
  });

  it('getOutgoing returns relationships from a node', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('a', 'A'));
    g.addNode(makeNode('b', 'B'));
    g.addNode(makeNode('c', 'C'));
    g.addRelationship(makeRel('a', 'b'));
    g.addRelationship(makeRel('a', 'c'));

    const outgoing = g.getOutgoing('a');
    expect(outgoing).toHaveLength(2);
    expect(outgoing.map(r => r.targetId).sort()).toEqual(['b', 'c']);
  });

  it('getIncoming filters by relationship type', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('a', 'A'));
    g.addNode(makeNode('b', 'B'));
    g.addRelationship(makeRel('a', 'b', RelationshipType.CALLS));
    g.addRelationship({
      id: 'a-IMPORTS-b',
      type: RelationshipType.IMPORTS,
      sourceId: 'a',
      targetId: 'b',
      confidence: 1.0,
    });

    expect(g.getIncoming('b')).toHaveLength(2);
    expect(g.getIncoming('b', RelationshipType.CALLS)).toHaveLength(1);
    expect(g.getIncoming('b', RelationshipType.IMPORTS)).toHaveLength(1);
  });

  it('getOutgoing filters by relationship type', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('a', 'A'));
    g.addNode(makeNode('b', 'B'));
    g.addRelationship(makeRel('a', 'b', RelationshipType.CALLS));
    g.addRelationship({
      id: 'a-IMPORTS-b',
      type: RelationshipType.IMPORTS,
      sourceId: 'a',
      targetId: 'b',
      confidence: 1.0,
    });

    expect(g.getOutgoing('a')).toHaveLength(2);
    expect(g.getOutgoing('a', RelationshipType.CALLS)).toHaveLength(1);
  });

  it('getIncoming/getOutgoing return empty for unknown node', () => {
    const g = new KnowledgeGraph();
    expect(g.getIncoming('nope')).toHaveLength(0);
    expect(g.getOutgoing('nope')).toHaveLength(0);
  });

  // ─── removeNodesByFile ──────────────────────────────────────

  it('removes all nodes belonging to a file', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('a', 'A', { file: 'src/foo.ts' }));
    g.addNode(makeNode('b', 'B', { file: 'src/foo.ts' }));
    g.addNode(makeNode('c', 'C', { file: 'src/bar.ts' }));

    const removed = g.removeNodesByFile('src/foo.ts');
    expect(removed).toBe(2);
    expect(g.nodeCount).toBe(1);
    expect(g.getNode('c')).toBeDefined();
  });

  it('removeNodesByFile also removes connected relationships', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('a', 'A', { file: 'src/foo.ts' }));
    g.addNode(makeNode('b', 'B', { file: 'src/bar.ts' }));
    g.addRelationship(makeRel('a', 'b'));
    expect(g.relationshipCount).toBe(1);

    g.removeNodesByFile('src/foo.ts');
    expect(g.relationshipCount).toBe(0);
    // Adjacency index should be rebuilt
    expect(g.getIncoming('b')).toHaveLength(0);
  });

  it('removeNodesByFile returns 0 for unknown file', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('a', 'A'));
    expect(g.removeNodesByFile('nope.ts')).toBe(0);
  });

  // ─── allRelationships ───────────────────────────────────────

  it('allRelationships yields all relationships', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('a', 'A'));
    g.addNode(makeNode('b', 'B'));
    g.addNode(makeNode('c', 'C'));
    g.addRelationship(makeRel('a', 'b'));
    g.addRelationship(makeRel('b', 'c'));

    const rels = [...g.allRelationships()];
    expect(rels).toHaveLength(2);
  });

  // ─── serialize / deserialize ────────────────────────────────

  it('serialize produces correct structure', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('a', 'A'));
    g.addNode(makeNode('b', 'B'));
    g.addRelationship(makeRel('a', 'b'));

    const serialized = g.serialize();
    expect(serialized.nodes).toHaveLength(2);
    expect(serialized.relationships).toHaveLength(1);
    expect(serialized.nodes[0].id).toBe('a');
  });

  it('deserialize reconstructs graph with adjacency', () => {
    const g1 = new KnowledgeGraph();
    g1.addNode(makeNode('a', 'A'));
    g1.addNode(makeNode('b', 'B'));
    g1.addNode(makeNode('c', 'C'));
    g1.addRelationship(makeRel('a', 'b'));
    g1.addRelationship(makeRel('b', 'c'));

    const serialized = g1.serialize();
    const g2 = KnowledgeGraph.deserialize(serialized);

    expect(g2.nodeCount).toBe(3);
    expect(g2.relationshipCount).toBe(2);
    expect(g2.getNode('a')!.name).toBe('A');
    expect(g2.getIncoming('b')).toHaveLength(1);
    expect(g2.getOutgoing('b')).toHaveLength(1);
  });

  it('round-trip preserves all data', () => {
    const g1 = new KnowledgeGraph();
    const node = makeNode('go:func:auth.Validate', 'Validate', {
      type: NodeType.Function,
      language: Language.Go,
      package: 'internal/auth',
      file: 'internal/auth/validate.go',
      startLine: 15,
      endLine: 42,
      exported: true,
      params: ['ctx context.Context', 'token string'],
      returnType: 'error',
    });
    g1.addNode(node);

    const serialized = g1.serialize();
    const json = JSON.parse(JSON.stringify(serialized));
    const g2 = KnowledgeGraph.deserialize(json);

    const restored = g2.getNode('go:func:auth.Validate')!;
    expect(restored.name).toBe('Validate');
    expect(restored.package).toBe('internal/auth');
    expect(restored.params).toEqual(['ctx context.Context', 'token string']);
    expect(restored.returnType).toBe('error');
  });

  // ─── buildAdjacencyIndex ────────────────────────────────────

  it('buildAdjacencyIndex rebuilds from scratch', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('a', 'A'));
    g.addNode(makeNode('b', 'B'));
    g.addRelationship(makeRel('a', 'b'));

    expect(g.getIncoming('b')).toHaveLength(1);

    // Force rebuild
    g.buildAdjacencyIndex();

    // Should still work after rebuild (not duplicate)
    expect(g.getIncoming('b')).toHaveLength(1);
    expect(g.getOutgoing('a')).toHaveLength(1);
  });
});
