/**
 * Unit Tests: Community Detection (Label Propagation)
 *
 * Tests that label propagation correctly clusters densely connected
 * subgraphs into communities.
 */
import { describe, it, expect } from 'vitest';
import { KnowledgeGraph } from '../../src/graph/graph.js';
import { NodeType, RelationshipType, Language } from '../../src/graph/types.js';
import type { Node, Relationship } from '../../src/graph/types.js';
import { detectCommunities } from '../../src/graph/community.js';

// ─── Helpers ─────────────────────────────────────────────────────

function makeNode(id: string, name: string, overrides?: Partial<Node>): Node {
  return {
    id,
    type: NodeType.Function,
    name,
    file: 'src/main.go',
    startLine: 1,
    endLine: 10,
    language: Language.Go,
    package: 'main',
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

// ─── Tests ───────────────────────────────────────────────────────

describe('community detection — label propagation', () => {
  it('assigns community labels to all eligible nodes', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('f1', 'Foo'));
    g.addNode(makeNode('f2', 'Bar'));
    g.addRelationship(makeRel('f1', 'f2'));

    const stats = detectCommunities(g);

    const foo = g.getNode('f1')!;
    const bar = g.getNode('f2')!;
    expect(foo.community).toBeDefined();
    expect(bar.community).toBeDefined();
    expect(stats.communityCount).toBeGreaterThanOrEqual(1);
  });

  it('groups densely connected nodes into the same community', () => {
    const g = new KnowledgeGraph();

    // Cluster A: tightly connected
    g.addNode(makeNode('a1', 'A1', { package: 'pkg-a', file: 'a/a1.go' }));
    g.addNode(makeNode('a2', 'A2', { package: 'pkg-a', file: 'a/a2.go' }));
    g.addNode(makeNode('a3', 'A3', { package: 'pkg-a', file: 'a/a3.go' }));
    g.addRelationship(makeRel('a1', 'a2'));
    g.addRelationship(makeRel('a2', 'a3'));
    g.addRelationship(makeRel('a3', 'a1'));

    // Cluster B: tightly connected
    g.addNode(makeNode('b1', 'B1', { package: 'pkg-b', file: 'b/b1.go' }));
    g.addNode(makeNode('b2', 'B2', { package: 'pkg-b', file: 'b/b2.go' }));
    g.addNode(makeNode('b3', 'B3', { package: 'pkg-b', file: 'b/b3.go' }));
    g.addRelationship(makeRel('b1', 'b2'));
    g.addRelationship(makeRel('b2', 'b3'));
    g.addRelationship(makeRel('b3', 'b1'));

    // Single weak cross-cluster link
    g.addRelationship(makeRel('a1', 'b1'));

    const stats = detectCommunities(g);

    // Cluster A nodes should share a community
    const a1 = g.getNode('a1')!;
    const a2 = g.getNode('a2')!;
    const a3 = g.getNode('a3')!;
    expect(a1.community).toBe(a2.community);
    expect(a2.community).toBe(a3.community);

    // Cluster B nodes should share a community
    const b1 = g.getNode('b1')!;
    const b2 = g.getNode('b2')!;
    const b3 = g.getNode('b3')!;
    expect(b1.community).toBe(b2.community);
    expect(b2.community).toBe(b3.community);

    // At least 1 community detected
    expect(stats.communityCount).toBeGreaterThanOrEqual(1);
  });

  it('skips Package and File nodes', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('pkg1', 'auth', { type: NodeType.Package, file: '' }));
    g.addNode(makeNode('file1', 'auth.go', { type: NodeType.File }));
    g.addNode(makeNode('f1', 'Foo'));

    detectCommunities(g);

    expect(g.getNode('pkg1')!.community).toBeUndefined();
    expect(g.getNode('file1')!.community).toBeUndefined();
    expect(g.getNode('f1')!.community).toBeDefined();
  });

  it('handles isolated nodes (no edges)', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('f1', 'Foo'));
    g.addNode(makeNode('f2', 'Bar'));
    // No relationships

    const stats = detectCommunities(g);

    // Each isolated node stays in its own community
    expect(stats.communityCount).toBe(2);
    expect(g.getNode('f1')!.community).not.toBe(g.getNode('f2')!.community);
  });

  it('handles empty graph', () => {
    const g = new KnowledgeGraph();
    const stats = detectCommunities(g);

    expect(stats.communityCount).toBe(0);
    expect(stats.iterations).toBe(0);
    expect(stats.largestCommunity.size).toBe(0);
  });

  it('converges within maxIterations', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('f1', 'A'));
    g.addNode(makeNode('f2', 'B'));
    g.addRelationship(makeRel('f1', 'f2'));

    const stats = detectCommunities(g, 3);

    expect(stats.iterations).toBeLessThanOrEqual(3);
  });

  it('returns correct stats', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('f1', 'A', { package: 'core' }));
    g.addNode(makeNode('f2', 'B', { package: 'core' }));
    g.addNode(makeNode('f3', 'C', { package: 'core' }));
    g.addRelationship(makeRel('f1', 'f2'));
    g.addRelationship(makeRel('f2', 'f3'));
    g.addRelationship(makeRel('f3', 'f1'));

    const stats = detectCommunities(g);

    // All three should be in one community
    expect(stats.communityCount).toBe(1);
    expect(stats.largestCommunity.size).toBe(3);
    expect(stats.iterations).toBeGreaterThanOrEqual(1);
  });

  it('community labels survive serialization', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('f1', 'Foo'));
    g.addNode(makeNode('f2', 'Bar'));
    g.addRelationship(makeRel('f1', 'f2'));

    detectCommunities(g);

    const serialized = g.serialize();
    const deserialized = KnowledgeGraph.deserialize(serialized);

    expect(deserialized.getNode('f1')!.community).toBe(g.getNode('f1')!.community);
    expect(deserialized.getNode('f2')!.community).toBe(g.getNode('f2')!.community);
  });

  it('uses package name as community label', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('f1', 'A', { package: 'internal/auth' }));
    g.addNode(makeNode('f2', 'B', { package: 'internal/auth' }));
    g.addRelationship(makeRel('f1', 'f2'));

    detectCommunities(g);

    const community = g.getNode('f1')!.community!;
    expect(community).toContain('internal/auth');
  });

  it('linear chain converges to a small number of communities', () => {
    // A -> B -> C -> D -> E
    const g = new KnowledgeGraph();
    for (let i = 1; i <= 5; i++) {
      g.addNode(makeNode(`n${i}`, `Node${i}`, { package: 'chain' }));
    }
    for (let i = 1; i < 5; i++) {
      g.addRelationship(makeRel(`n${i}`, `n${i + 1}`));
    }

    const stats = detectCommunities(g);

    // Label propagation on a linear chain may not fully converge to one
    // community, but should reduce from 5 to a small number
    expect(stats.communityCount).toBeLessThanOrEqual(3);
    expect(stats.communityCount).toBeGreaterThanOrEqual(1);

    // All nodes should have community labels
    for (let i = 1; i <= 5; i++) {
      expect(g.getNode(`n${i}`)!.community).toBeDefined();
    }
  });
});

describe('community info in handlers', () => {
  it('recon_context includes community field', async () => {
    const { handleToolCall } = await import('../../src/mcp/handlers.js');

    const g = new KnowledgeGraph();
    g.addNode(makeNode('f1', 'MyFunc', { community: 'internal/auth' }));

    const result = await handleToolCall('recon_context', { name: 'MyFunc' }, g);
    expect(result).toContain('**Community:** internal/auth');
  });

  it('recon_context omits community when not set', async () => {
    const { handleToolCall } = await import('../../src/mcp/handlers.js');

    const g = new KnowledgeGraph();
    g.addNode(makeNode('f1', 'MyFunc'));

    const result = await handleToolCall('recon_context', { name: 'MyFunc' }, g);
    expect(result).not.toContain('**Community:**');
  });

  it('recon_impact includes affected communities', async () => {
    const { handleToolCall } = await import('../../src/mcp/handlers.js');

    const g = new KnowledgeGraph();
    g.addNode(makeNode('f1', 'Caller', { community: 'web', file: 'web/app.go' }));
    g.addNode(makeNode('f2', 'Target', { community: 'core', file: 'core/main.go' }));
    g.addRelationship(makeRel('f1', 'f2'));

    const result = await handleToolCall('recon_impact', {
      target: 'Target',
      direction: 'upstream',
    }, g);
    expect(result).toContain('**Affected communities:**');
    expect(result).toContain('core');
    expect(result).toContain('web');
  });
});
