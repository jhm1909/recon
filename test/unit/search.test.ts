/**
 * Unit Tests: BM25 Search Index
 *
 * Tests tokenization, index building, BM25 ranking,
 * serialization/deserialization, and edge cases.
 */
import { describe, it, expect } from 'vitest';
import { BM25Index, tokenize } from '../../src/search/bm25.js';
import { KnowledgeGraph } from '../../src/graph/graph.js';
import { NodeType, Language } from '../../src/graph/types.js';
import type { Node } from '../../src/graph/types.js';

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

function buildTestGraph(): KnowledgeGraph {
  const g = new KnowledgeGraph();

  g.addNode(makeNode('fn:getUserById', 'getUserById', {
    file: 'internal/user/service.go',
    package: 'internal/user',
  }));
  g.addNode(makeNode('fn:getUser', 'getUser', {
    file: 'internal/user/service.go',
    package: 'internal/user',
  }));
  g.addNode(makeNode('fn:createUser', 'createUser', {
    file: 'internal/user/service.go',
    package: 'internal/user',
  }));
  g.addNode(makeNode('fn:validateToken', 'validateToken', {
    file: 'internal/auth/token.go',
    package: 'internal/auth',
  }));
  g.addNode(makeNode('fn:AuthMiddleware', 'AuthMiddleware', {
    file: 'internal/auth/middleware.go',
    package: 'internal/auth',
  }));
  g.addNode(makeNode('comp:UserProfile', 'UserProfile', {
    type: NodeType.Component,
    file: 'apps/web/src/components/UserProfile.tsx',
    language: Language.TypeScript,
    package: 'apps/web/src/components',
  }));
  g.addNode(makeNode('comp:LoginForm', 'LoginForm', {
    type: NodeType.Component,
    file: 'apps/web/src/components/LoginForm.tsx',
    language: Language.TypeScript,
    package: 'apps/web/src/components',
  }));
  // File node (should be skipped by BM25)
  g.addNode(makeNode('file:service.go', 'service.go', {
    type: NodeType.File,
    file: 'internal/user/service.go',
  }));

  return g;
}

// ─── Tokenizer Tests ────────────────────────────────────────────

describe('tokenize', () => {
  it('splits camelCase', () => {
    expect(tokenize('getUserById')).toEqual(['get', 'user', 'by', 'id']);
  });

  it('splits PascalCase', () => {
    expect(tokenize('AuthMiddleware')).toEqual(['auth', 'middleware']);
  });

  it('splits snake_case', () => {
    expect(tokenize('validate_token')).toEqual(['validate', 'token']);
  });

  it('splits dot notation', () => {
    expect(tokenize('Handler.GetGuild')).toEqual(['handler', 'get', 'guild']);
  });

  it('splits file paths', () => {
    expect(tokenize('internal/auth/token.go')).toEqual(['internal', 'auth', 'token', 'go']);
  });

  it('handles ACRONYM boundaries', () => {
    expect(tokenize('parseHTTPResponse')).toEqual(['parse', 'http', 'response']);
  });

  it('lowercases all tokens', () => {
    expect(tokenize('MyFunction')).toEqual(['my', 'function']);
  });

  it('returns empty for empty string', () => {
    expect(tokenize('')).toEqual([]);
  });

  it('handles single word', () => {
    expect(tokenize('middleware')).toEqual(['middleware']);
  });

  it('handles numbers', () => {
    expect(tokenize('base64Decode')).toEqual(['base', '64', 'decode']);
  });
});

// ─── BM25 Index Tests ───────────────────────────────────────────

describe('BM25Index', () => {
  describe('buildFromGraph', () => {
    it('indexes all non-File nodes', () => {
      const graph = buildTestGraph();
      const index = BM25Index.buildFromGraph(graph);
      // 7 non-File nodes
      expect(index.documentCount).toBe(7);
    });

    it('skips File nodes', () => {
      const g = new KnowledgeGraph();
      g.addNode(makeNode('file:test', 'test.go', { type: NodeType.File }));
      g.addNode(makeNode('fn:test', 'testFunc'));
      const index = BM25Index.buildFromGraph(g);
      expect(index.documentCount).toBe(1);
    });
  });

  describe('search', () => {
    it('exact name match ranks highest', () => {
      const graph = buildTestGraph();
      const index = BM25Index.buildFromGraph(graph);

      const results = index.search('getUser');
      expect(results.length).toBeGreaterThan(0);
      // "getUser" should rank higher than "getUserById" because
      // the exact tokens match more precisely
      expect(results[0].nodeId).toBe('fn:getUser');
    });

    it('finds results case-insensitively', () => {
      const graph = buildTestGraph();
      const index = BM25Index.buildFromGraph(graph);

      // All these tokenize to ["auth", "middleware"]
      const pascal = index.search('AuthMiddleware');
      const camel = index.search('authMiddleware');
      const upper = index.search('AUTH MIDDLEWARE');

      // All should find AuthMiddleware
      expect(pascal.length).toBeGreaterThan(0);
      expect(camel.length).toBeGreaterThan(0);
      expect(upper.length).toBeGreaterThan(0);
      expect(pascal[0].nodeId).toBe('fn:AuthMiddleware');
      expect(camel[0].nodeId).toBe('fn:AuthMiddleware');
      expect(upper[0].nodeId).toBe('fn:AuthMiddleware');
    });

    it('multi-token queries work', () => {
      const graph = buildTestGraph();
      const index = BM25Index.buildFromGraph(graph);

      const results = index.search('user profile');
      expect(results.length).toBeGreaterThan(0);
      // UserProfile should rank high since both tokens match
      const profileResult = results.find(r => r.nodeId === 'comp:UserProfile');
      expect(profileResult).toBeDefined();
    });

    it('respects limit', () => {
      const graph = buildTestGraph();
      const index = BM25Index.buildFromGraph(graph);

      const results = index.search('user', 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('returns empty for no match', () => {
      const graph = buildTestGraph();
      const index = BM25Index.buildFromGraph(graph);

      const results = index.search('zzzznonexistent');
      expect(results).toHaveLength(0);
    });

    it('returns empty for empty query', () => {
      const graph = buildTestGraph();
      const index = BM25Index.buildFromGraph(graph);

      const results = index.search('');
      expect(results).toHaveLength(0);
    });

    it('scores are positive numbers', () => {
      const graph = buildTestGraph();
      const index = BM25Index.buildFromGraph(graph);

      const results = index.search('user');
      for (const r of results) {
        expect(r.score).toBeGreaterThan(0);
      }
    });

    it('results are sorted by score descending', () => {
      const graph = buildTestGraph();
      const index = BM25Index.buildFromGraph(graph);

      const results = index.search('user');
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it('file path tokens contribute to ranking', () => {
      const graph = buildTestGraph();
      const index = BM25Index.buildFromGraph(graph);

      // Search for "auth" should find validateToken and AuthMiddleware
      // because they're in internal/auth/
      const results = index.search('auth');
      const authNodeIds = results.map(r => r.nodeId);
      expect(authNodeIds).toContain('fn:validateToken');
      expect(authNodeIds).toContain('fn:AuthMiddleware');
    });

    it('package tokens contribute to ranking', () => {
      const graph = buildTestGraph();
      const index = BM25Index.buildFromGraph(graph);

      // Search for "components" should find TS components
      const results = index.search('components');
      const ids = results.map(r => r.nodeId);
      expect(ids).toContain('comp:UserProfile');
      expect(ids).toContain('comp:LoginForm');
    });
  });

  describe('serialize / deserialize', () => {
    it('round-trip preserves search results', () => {
      const graph = buildTestGraph();
      const original = BM25Index.buildFromGraph(graph);

      const serialized = original.serialize();
      const restored = BM25Index.deserialize(serialized);

      const origResults = original.search('user');
      const restoredResults = restored.search('user');

      expect(restoredResults.length).toBe(origResults.length);
      expect(restoredResults[0].nodeId).toBe(origResults[0].nodeId);
      expect(restoredResults[0].score).toBeCloseTo(origResults[0].score, 5);
    });

    it('round-trip preserves document count', () => {
      const graph = buildTestGraph();
      const original = BM25Index.buildFromGraph(graph);

      const serialized = original.serialize();
      const restored = BM25Index.deserialize(serialized);

      expect(restored.documentCount).toBe(original.documentCount);
    });

    it('handles JSON round-trip', () => {
      const graph = buildTestGraph();
      const original = BM25Index.buildFromGraph(graph);

      const json = JSON.stringify(original.serialize());
      const restored = BM25Index.deserialize(JSON.parse(json));

      const results = restored.search('middleware');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].nodeId).toBe('fn:AuthMiddleware');
    });
  });

  describe('edge cases', () => {
    it('works with empty graph', () => {
      const g = new KnowledgeGraph();
      const index = BM25Index.buildFromGraph(g);
      expect(index.documentCount).toBe(0);
      expect(index.search('anything')).toHaveLength(0);
    });

    it('works with single node', () => {
      const g = new KnowledgeGraph();
      g.addNode(makeNode('fn:solo', 'solo'));
      const index = BM25Index.buildFromGraph(g);
      expect(index.documentCount).toBe(1);
      const results = index.search('solo');
      expect(results).toHaveLength(1);
      expect(results[0].nodeId).toBe('fn:solo');
    });
  });
});
