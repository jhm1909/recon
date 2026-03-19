/**
 * Unit Tests: PR Review (reviewer.ts)
 *
 * Tests formatReview output structure. analyzeChanges requires git,
 * so we test it with mock data via formatReview directly.
 */
import { describe, it, expect } from 'vitest';
import { KnowledgeGraph } from '../../src/graph/graph.js';
import { NodeType, RelationshipType, Language } from '../../src/graph/types.js';
import type { Node, Relationship } from '../../src/graph/types.js';
import { formatReview } from '../../src/review/reviewer.js';

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

function buildGraph(): KnowledgeGraph {
  const g = new KnowledgeGraph();
  g.addNode(makeNode('f1', 'handleQuery', { package: 'mcp', file: 'src/mcp/handlers.ts', startLine: 100, endLine: 150 }));
  g.addNode(makeNode('f2', 'BM25Search', { package: 'search', file: 'src/search/bm25.ts', startLine: 20, endLine: 60 }));
  g.addNode(makeNode('f3', 'createServer', { package: 'mcp', file: 'src/mcp/server.ts', startLine: 1, endLine: 30 }));
  g.addRelationship(makeRel('f1', 'f2', RelationshipType.CALLS));
  g.addRelationship(makeRel('f3', 'f1', RelationshipType.CALLS));
  return g;
}

// ─── Tests ──────────────────────────────────────────────────────

describe('PR Review', () => {

  describe('formatReview - no changes', () => {
    it('returns no changes message when changedFiles is empty', () => {
      const result = {
        scope: 'all', base: 'main',
        changedFiles: [], changedSymbols: [], directlyModified: [],
        affected: [], fileAnalyses: [],
        overallRisk: '🟢 LOW', riskScore: 0,
        affectedCommunities: new Set<string>(), brokenFlows: [],
      };
      const output = formatReview(result, buildGraph());
      expect(output).toContain('No changes detected');
    });
  });

  describe('formatReview - with changes', () => {
    const graph = buildGraph();
    const handleQuery = graph.getNode('f1')!;
    const result = {
      scope: 'all', base: 'main',
      changedFiles: ['src/mcp/handlers.ts'],
      changedSymbols: [{ node: handleQuery, reason: 'modified' as const }],
      directlyModified: [{ node: handleQuery, reason: 'modified' as const }],
      affected: [
        { node: graph.getNode('f3')!, depth: 1, edgeType: 'CALLS', confidence: 1.0, via: 'handleQuery' },
      ],
      fileAnalyses: [{
        file: 'src/mcp/handlers.ts',
        modifiedSymbols: [{ node: handleQuery, reason: 'modified' as const }],
        risk: '🟡 MEDIUM',
        affectedCount: 1,
      }],
      overallRisk: '🟡 MEDIUM',
      riskScore: 15,
      affectedCommunities: new Set(['mcp']),
      brokenFlows: [],
    };

    it('includes PR Review header', () => {
      expect(formatReview(result, graph)).toContain('# PR Review');
    });

    it('includes summary section', () => {
      const output = formatReview(result, graph);
      expect(output).toContain('## Summary');
      expect(output).toContain('MEDIUM');
    });

    it('includes changed file count', () => {
      expect(formatReview(result, graph)).toContain('1 files');
    });

    it('includes modified symbol count', () => {
      expect(formatReview(result, graph)).toContain('1 symbols modified');
    });

    it('includes blast radius count', () => {
      const output = formatReview(result, graph);
      expect(output).toContain('1 affected symbols');
    });

    it('includes per-file analysis', () => {
      const output = formatReview(result, graph);
      expect(output).toContain('## Per-File Analysis');
      expect(output).toContain('src/mcp/handlers.ts');
    });

    it('includes modified symbol names', () => {
      const output = formatReview(result, graph);
      expect(output).toContain('handleQuery');
    });

    it('includes affected communities', () => {
      const output = formatReview(result, graph);
      expect(output).toContain('mcp');
    });

    it('includes directly affected d=1', () => {
      const output = formatReview(result, graph);
      expect(output).toContain('Directly Affected');
      expect(output).toContain('createServer');
    });

    it('includes review priorities', () => {
      const output = formatReview(result, graph);
      expect(output).toContain('Review Priorities');
    });
  });

  describe('formatReview - risk levels', () => {
    const graph = buildGraph();

    it('shows LOW risk', () => {
      const result = {
        scope: 'all', base: 'main', changedFiles: ['x.ts'],
        changedSymbols: [], directlyModified: [], affected: [],
        fileAnalyses: [], overallRisk: '🟢 LOW', riskScore: 0,
        affectedCommunities: new Set<string>(), brokenFlows: [],
      };
      expect(formatReview(result, graph)).toContain('LOW');
    });

    it('shows CRITICAL risk', () => {
      const result = {
        scope: 'all', base: 'main', changedFiles: ['x.ts'],
        changedSymbols: [], directlyModified: [], affected: [],
        fileAnalyses: [], overallRisk: '🔴 CRITICAL', riskScore: 60,
        affectedCommunities: new Set<string>(), brokenFlows: [],
      };
      expect(formatReview(result, graph)).toContain('CRITICAL');
    });
  });

  describe('formatReview - broken flows', () => {
    const graph = buildGraph();

    it('shows broken execution flows', () => {
      const result = {
        scope: 'all', base: 'main', changedFiles: ['x.ts'],
        changedSymbols: [], directlyModified: [], affected: [],
        fileAnalyses: [], overallRisk: '🟡 MEDIUM', riskScore: 15,
        affectedCommunities: new Set<string>(),
        brokenFlows: [{ name: 'MCP:handleToolCall', step: 2, total: 5 }],
      };
      const output = formatReview(result, graph);
      expect(output).toContain('Affected Execution Flows');
      expect(output).toContain('MCP:handleToolCall');
      expect(output).toContain('step 2/5');
    });
  });
});
