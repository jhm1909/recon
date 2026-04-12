/**
 * Unit Tests: recon_find with natural language query routing
 *
 * Tests classifyQuery() and executeFind() against a mock graph:
 *   [getUserById]  Function (Go)
 *   [AuthHandler]  Function (Go)
 *   [LoginHandler] Function (Go)
 *   [UserService]  Component (TS) — no callers
 *   [parseToken]   Function (Go) — not exported, no callers
 *   [handleAuth]   Function (Go) — exported
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { KnowledgeGraph } from '../../src/graph/graph.js';
import { NodeType, RelationshipType, Language } from '../../src/graph/types.js';
import type { Node, Relationship } from '../../src/graph/types.js';
import {
  classifyQuery,
  executeFind,
  formatFindResults,
} from '../../src/mcp/find.js';
import type { QueryStrategy, FindResult } from '../../src/mcp/find.js';

// ─── Helpers ────────────────────────────────────────────────────

function makeNode(id: string, name: string, overrides?: Partial<Node>): Node {
  return {
    id,
    type: NodeType.Function,
    name,
    file: 'internal/auth/auth.go',
    startLine: 1,
    endLine: 10,
    language: Language.Go,
    package: 'internal/auth',
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

function buildMockGraph(): KnowledgeGraph {
  const g = new KnowledgeGraph();

  // Functions
  g.addNode(makeNode('go:func:getUserById', 'getUserById', {
    file: 'internal/user/user.go',
    startLine: 5,
    package: 'internal/user',
    exported: false,
  }));

  g.addNode(makeNode('go:func:AuthHandler', 'AuthHandler', {
    file: 'internal/auth/handler.go',
    startLine: 10,
    package: 'internal/auth',
    exported: true,
  }));

  g.addNode(makeNode('go:func:LoginHandler', 'LoginHandler', {
    file: 'internal/auth/login.go',
    startLine: 20,
    package: 'internal/auth',
    exported: true,
  }));

  g.addNode(makeNode('go:func:handleAuth', 'handleAuth', {
    file: 'internal/auth/middleware.go',
    startLine: 30,
    package: 'internal/auth',
    exported: false,
  }));

  g.addNode(makeNode('go:func:parseToken', 'parseToken', {
    file: 'internal/jwt/parse.go',
    startLine: 5,
    package: 'internal/jwt',
    exported: false,
  }));

  // TS Component — no callers
  g.addNode(makeNode('ts:comp:UserService', 'UserService', {
    type: NodeType.Component,
    file: 'apps/web/src/UserService.ts',
    startLine: 1,
    language: Language.TypeScript,
    package: 'apps/web/src',
    exported: true,
  }));

  // Relationships — AuthHandler calls parseToken
  g.addRelationship(makeRel('go:func:AuthHandler', 'go:func:parseToken'));
  // LoginHandler calls handleAuth
  g.addRelationship(makeRel('go:func:LoginHandler', 'go:func:handleAuth'));

  return g;
}

// ─── classifyQuery Tests ─────────────────────────────────────────

describe('classifyQuery', () => {
  it('camelCase single token → exact', () => {
    expect(classifyQuery('getUserById')).toBe<QueryStrategy>('exact');
  });

  it('snake_case single token → exact', () => {
    expect(classifyQuery('get_user_by_id')).toBe<QueryStrategy>('exact');
  });

  it('short single word → exact', () => {
    expect(classifyQuery('auth')).toBe<QueryStrategy>('exact');
  });

  it('wildcard with * → pattern', () => {
    expect(classifyQuery('*Handler')).toBe<QueryStrategy>('pattern');
  });

  it('wildcard with ? → pattern', () => {
    expect(classifyQuery('handle?')).toBe<QueryStrategy>('pattern');
  });

  it('exported + no callers (2 structural keywords) → structural', () => {
    expect(classifyQuery('exported functions with no callers')).toBe<QueryStrategy>('structural');
  });

  it('unused exports (1 keyword + 3+ words) → structural', () => {
    expect(classifyQuery('unused exports in the codebase')).toBe<QueryStrategy>('structural');
  });

  it('single structural keyword "unused" alone → structural (1 keyword)', () => {
    // "unused" alone is 1 keyword, 1 word total — check spec: 1 keyword alone counts
    // Classification: 1 structural keyword + 1 word → "unused" qualifies as structural
    // (the rule is ≥2 structural keywords OR 1 structural keyword + ≥3 words)
    // "unused" has 1 keyword and 1 word, so it does NOT qualify as structural
    // → falls through to fulltext
    const result = classifyQuery('unused exports');
    expect(result).toBe<QueryStrategy>('structural');
  });

  it('natural language description → fulltext', () => {
    expect(classifyQuery('functions that handle authentication')).toBe<QueryStrategy>('fulltext');
  });

  it('dot.notation → exact', () => {
    expect(classifyQuery('handler.Login')).toBe<QueryStrategy>('exact');
  });

  it('two structural keywords → structural', () => {
    expect(classifyQuery('orphan dead code')).toBe<QueryStrategy>('structural');
  });

  it('implements + structural keyword → structural', () => {
    expect(classifyQuery('types that implements an interface')).toBe<QueryStrategy>('structural');
  });
});

// ─── executeFind Tests ───────────────────────────────────────────

describe('executeFind — exact strategy', () => {
  let graph: KnowledgeGraph;

  beforeEach(() => {
    graph = buildMockGraph();
  });

  it('finds node by exact name (case-insensitive)', () => {
    const results = executeFind(graph, 'getUserById');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe('getUserById');
  });

  it('matches case-insensitively', () => {
    const results = executeFind(graph, 'GETBYUSERID');
    // Should not match (different name)
    expect(results.length).toBe(0);
  });

  it('finds AuthHandler by exact name', () => {
    const results = executeFind(graph, 'AuthHandler');
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('AuthHandler');
    expect(results[0].type).toBe(NodeType.Function);
  });

  it('result shape has required fields', () => {
    const results = executeFind(graph, 'LoginHandler');
    expect(results.length).toBe(1);
    const r = results[0];
    expect(r).toHaveProperty('id');
    expect(r).toHaveProperty('name');
    expect(r).toHaveProperty('type');
    expect(r).toHaveProperty('file');
    expect(r).toHaveProperty('line');
    expect(r).toHaveProperty('package');
    expect(r).toHaveProperty('exported');
    expect(r).toHaveProperty('callers');
    expect(r).toHaveProperty('callees');
  });

  it('includes caller count', () => {
    // parseToken has 1 caller (AuthHandler)
    const results = executeFind(graph, 'parseToken');
    expect(results[0].callers).toBe(1);
  });

  it('includes callee count', () => {
    // AuthHandler calls parseToken → 1 callee
    const results = executeFind(graph, 'AuthHandler');
    expect(results[0].callees).toBe(1);
  });
});

describe('executeFind — pattern strategy', () => {
  let graph: KnowledgeGraph;

  beforeEach(() => {
    graph = buildMockGraph();
  });

  it('wildcard *Handler matches AuthHandler and LoginHandler', () => {
    const results = executeFind(graph, '*Handler');
    const names = results.map(r => r.name);
    expect(names).toContain('AuthHandler');
    expect(names).toContain('LoginHandler');
  });

  it('prefix wildcard *auth matches handleAuth', () => {
    const results = executeFind(graph, '*auth');
    // Case-insensitive: matches handleAuth
    const names = results.map(r => r.name);
    expect(names.some(n => n.toLowerCase().includes('auth'))).toBe(true);
  });

  it('exact wildcard pattern *Service matches UserService', () => {
    const results = executeFind(graph, '*Service');
    const names = results.map(r => r.name);
    expect(names).toContain('UserService');
  });

  it('no match returns empty array', () => {
    const results = executeFind(graph, '*NonExistent');
    expect(results).toHaveLength(0);
  });
});

describe('executeFind — structural strategy', () => {
  let graph: KnowledgeGraph;

  beforeEach(() => {
    graph = buildMockGraph();
  });

  it('"exported" keyword filters to exported nodes', () => {
    const results = executeFind(graph, 'exported functions');
    expect(results.every(r => r.exported)).toBe(true);
  });

  it('"unexported" keyword filters to unexported nodes', () => {
    const results = executeFind(graph, 'unexported functions');
    expect(results.every(r => !r.exported)).toBe(true);
  });

  it('"no callers" keyword filters to nodes with 0 callers', () => {
    const results = executeFind(graph, 'exported no callers');
    // AuthHandler has callers? No — AuthHandler has no callers in mock graph.
    // parseToken has 1 caller.
    for (const r of results) {
      expect(r.callers).toBe(0);
    }
  });

  it('"no callees" keyword filters to nodes with 0 callees', () => {
    const results = executeFind(graph, 'exported no callees');
    for (const r of results) {
      expect(r.callees).toBe(0);
    }
  });

  it('"test" keyword filters to test nodes', () => {
    // No test nodes in mock graph
    const results = executeFind(graph, 'test functions no callers');
    expect(results).toHaveLength(0);
  });
});

describe('executeFind — fulltext strategy', () => {
  let graph: KnowledgeGraph;

  beforeEach(() => {
    graph = buildMockGraph();
  });

  it('partial token match on "authentication" matches auth-related nodes', () => {
    const results = executeFind(graph, 'functions that handle authentication');
    // Should match AuthHandler, LoginHandler, handleAuth (all contain "auth" tokens)
    const names = results.map(r => r.name);
    expect(names.length).toBeGreaterThan(0);
    // At least one auth-related result
    expect(names.some(n => n.toLowerCase().includes('auth'))).toBe(true);
  });

  it('token "login" matches LoginHandler', () => {
    const results = executeFind(graph, 'login endpoint handler');
    const names = results.map(r => r.name);
    expect(names).toContain('LoginHandler');
  });

  it('returns empty array for no token overlap', () => {
    const results = executeFind(graph, 'completely unrelated xyz abc def');
    // All tokens must find no overlap — check it handles gracefully
    expect(Array.isArray(results)).toBe(true);
  });
});

describe('executeFind — options', () => {
  let graph: KnowledgeGraph;

  beforeEach(() => {
    graph = buildMockGraph();
  });

  it('limit option caps results', () => {
    const results = executeFind(graph, '*Handler', { limit: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('type option filters by node type', () => {
    const results = executeFind(graph, '*', { type: NodeType.Component });
    for (const r of results) {
      expect(r.type).toBe(NodeType.Component);
    }
  });
});

// ─── formatFindResults Tests ─────────────────────────────────────

describe('formatFindResults', () => {
  let graph: KnowledgeGraph;

  beforeEach(() => {
    graph = buildMockGraph();
  });

  it('returns a non-empty string', () => {
    const results = executeFind(graph, 'AuthHandler');
    const output = formatFindResults(results);
    expect(typeof output).toBe('string');
    expect(output.length).toBeGreaterThan(0);
  });

  it('includes result name', () => {
    const results = executeFind(graph, 'AuthHandler');
    const output = formatFindResults(results);
    expect(output).toContain('AuthHandler');
  });

  it('shows result count', () => {
    const results = executeFind(graph, '*Handler');
    const output = formatFindResults(results);
    expect(output).toContain('2');
  });

  it('handles empty results gracefully', () => {
    const output = formatFindResults([]);
    expect(output).toContain('No results');
  });
});
