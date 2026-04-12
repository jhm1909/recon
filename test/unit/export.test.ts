/**
 * Unit Tests: Graph Export (Mermaid)
 */
import { describe, it, expect } from 'vitest';
import { KnowledgeGraph } from '../../src/graph/graph.js';
import { NodeType, RelationshipType, Language } from '../../src/graph/types.js';
import type { Node, Relationship } from '../../src/graph/types.js';
import { exportGraph, filterGraph, toMermaid } from '../../src/export/exporter.js';

// ─── Helpers ────────────────────────────────────────────────────

function makeNode(id: string, name: string, overrides?: Partial<Node>): Node {
  return {
    id, type: NodeType.Function, name, file: 'src/test.ts',
    startLine: 1, endLine: 10, language: Language.TypeScript,
    package: 'test', exported: true, ...overrides,
  };
}

function makeRel(src: string, tgt: string, type = RelationshipType.CALLS): Relationship {
  return { id: `${src}-${type}-${tgt}`, type, sourceId: src, targetId: tgt, confidence: 1.0 };
}

function buildTestGraph(): KnowledgeGraph {
  const g = new KnowledgeGraph();
  g.addNode(makeNode('f1', 'handleQuery', { package: 'mcp', type: NodeType.Function }));
  g.addNode(makeNode('f2', 'BM25Search', { package: 'search', type: NodeType.Function }));
  g.addNode(makeNode('f3', 'VectorStore', { package: 'search', type: NodeType.Class }));
  g.addNode(makeNode('f4', 'createServer', { package: 'mcp', type: NodeType.Function }));
  g.addNode(makeNode('i1', 'Searchable', { package: 'search', type: NodeType.Interface }));
  g.addRelationship(makeRel('f1', 'f2', RelationshipType.CALLS));
  g.addRelationship(makeRel('f4', 'f1', RelationshipType.CALLS));
  g.addRelationship(makeRel('f3', 'i1', RelationshipType.IMPLEMENTS));
  return g;
}

// ─── Tests ──────────────────────────────────────────────────────

describe('Graph Export', () => {

  describe('toMermaid', () => {
    it('generates valid mermaid header', () => {
      const { nodes, rels } = filterGraph(buildTestGraph(), { format: 'mermaid' });
      expect(toMermaid(nodes, rels)).toContain('graph TD');
    });

    it('includes node names', () => {
      const { nodes, rels } = filterGraph(buildTestGraph(), { format: 'mermaid' });
      const output = toMermaid(nodes, rels);
      expect(output).toContain('handleQuery');
      expect(output).toContain('BM25Search');
    });

    it('includes edge arrows', () => {
      const { nodes, rels } = filterGraph(buildTestGraph(), { format: 'mermaid' });
      expect(toMermaid(nodes, rels)).toContain('-->');
    });

    it('respects LR direction', () => {
      const { nodes, rels } = filterGraph(buildTestGraph(), { format: 'mermaid' });
      expect(toMermaid(nodes, rels, 'LR')).toContain('graph LR');
    });

    it('groups into subgraphs by package', () => {
      const { nodes, rels } = filterGraph(buildTestGraph(), { format: 'mermaid' });
      const output = toMermaid(nodes, rels);
      expect(output).toContain('subgraph');
      expect(output).toContain('mcp');
      expect(output).toContain('search');
    });

    it('returns empty graph message for no nodes', () => {
      expect(toMermaid([], [])).toContain('No nodes');
    });
  });

  describe('filterGraph', () => {
    it('filters by package', () => {
      const { nodes } = filterGraph(buildTestGraph(), { format: 'mermaid', package: 'search' });
      expect(nodes.length).toBe(3); // BM25Search, VectorStore, Searchable
      expect(nodes.every(n => n.package === 'search')).toBe(true);
    });

    it('filters by node type', () => {
      const { nodes } = filterGraph(buildTestGraph(), { format: 'mermaid', types: [NodeType.Class] });
      expect(nodes.length).toBe(1);
      expect(nodes[0].name).toBe('VectorStore');
    });

    it('filters by edge type', () => {
      const { rels } = filterGraph(buildTestGraph(), { format: 'mermaid', edges: [RelationshipType.IMPLEMENTS] });
      expect(rels.every(r => r.type === RelationshipType.IMPLEMENTS)).toBe(true);
    });

    it('respects limit', () => {
      const { nodes } = filterGraph(buildTestGraph(), { format: 'mermaid', limit: 2 });
      expect(nodes.length).toBeLessThanOrEqual(2);
    });

    it('ego graph via symbol', () => {
      const { nodes } = filterGraph(buildTestGraph(), { format: 'mermaid', symbol: 'handleQuery', depth: 1 });
      expect(nodes.length).toBeGreaterThanOrEqual(2);
      expect(nodes.some(n => n.name === 'handleQuery')).toBe(true);
    });

    it('returns empty for unknown symbol', () => {
      const { nodes } = filterGraph(buildTestGraph(), { format: 'mermaid', symbol: 'nonexistent' });
      expect(nodes.length).toBe(0);
    });
  });

  describe('exportGraph', () => {
    it('generates mermaid', () => {
      expect(exportGraph(buildTestGraph(), { format: 'mermaid' })).toContain('graph');
    });

    it('returns no-nodes for empty graph', () => {
      expect(exportGraph(new KnowledgeGraph(), { format: 'mermaid' })).toContain('No nodes');
    });

    it('applies package filter', () => {
      const output = exportGraph(buildTestGraph(), { format: 'mermaid', package: 'search' });
      expect(output).toContain('BM25Search');
    });
  });
});
