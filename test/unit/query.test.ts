/**
 * Unit Tests: Cypher-like Graph Query Tool
 *
 * Tests query parsing, execution against mock graph, result formatting,
 * and error handling for invalid syntax.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { KnowledgeGraph } from '../../src/graph/graph.js';
import { NodeType, RelationshipType, Language } from '../../src/graph/types.js';
import type { Node, Relationship } from '../../src/graph/types.js';
import {
  parseCypher,
  CypherParseError,
  executeQuery,
  formatResultAsMarkdown,
} from '../../src/query/index.js';

// ─── Test Graph Setup ───────────────────────────────────────────

function buildTestGraph(): KnowledgeGraph {
  const graph = new KnowledgeGraph();

  // Packages
  graph.addNode({
    id: 'go:pkg:internal/auth',
    type: NodeType.Package,
    name: 'auth',
    file: 'internal/auth',
    startLine: 0,
    endLine: 0,
    language: Language.Go,
    package: 'internal/auth',
    exported: true,
    importPath: 'myapp/internal/auth',
  });

  // Functions
  graph.addNode({
    id: 'go:func:internal/auth/handler.go:ValidateToken:10',
    type: NodeType.Function,
    name: 'ValidateToken',
    file: 'internal/auth/handler.go',
    startLine: 10,
    endLine: 30,
    language: Language.Go,
    package: 'internal/auth',
    exported: true,
  });

  graph.addNode({
    id: 'go:func:internal/auth/handler.go:parseHeader:35',
    type: NodeType.Function,
    name: 'parseHeader',
    file: 'internal/auth/handler.go',
    startLine: 35,
    endLine: 50,
    language: Language.Go,
    package: 'internal/auth',
    exported: false,
  });

  graph.addNode({
    id: 'go:func:cmd/server/main.go:main:5',
    type: NodeType.Function,
    name: 'main',
    file: 'cmd/server/main.go',
    startLine: 5,
    endLine: 20,
    language: Language.Go,
    package: 'cmd/server',
    exported: false,
  });

  // Structs
  graph.addNode({
    id: 'go:struct:internal/auth/types.go:Config:5',
    type: NodeType.Struct,
    name: 'Config',
    file: 'internal/auth/types.go',
    startLine: 5,
    endLine: 15,
    language: Language.Go,
    package: 'internal/auth',
    exported: true,
  });

  // Methods
  graph.addNode({
    id: 'go:method:internal/auth/types.go:Validate:20',
    type: NodeType.Method,
    name: 'Validate',
    file: 'internal/auth/types.go',
    startLine: 20,
    endLine: 30,
    language: Language.Go,
    package: 'internal/auth',
    exported: true,
    receiver: 'Config',
  });

  // Classes (Python)
  graph.addNode({
    id: 'py:class:models.py:Animal:1',
    type: NodeType.Class,
    name: 'Animal',
    file: 'models.py',
    startLine: 1,
    endLine: 10,
    language: Language.Python,
    package: '',
    exported: true,
  });

  graph.addNode({
    id: 'py:class:models.py:Dog:12',
    type: NodeType.Class,
    name: 'Dog',
    file: 'models.py',
    startLine: 12,
    endLine: 20,
    language: Language.Python,
    package: '',
    exported: true,
  });

  // Interface
  graph.addNode({
    id: 'go:iface:internal/auth/types.go:Authenticator:35',
    type: NodeType.Interface,
    name: 'Authenticator',
    file: 'internal/auth/types.go',
    startLine: 35,
    endLine: 45,
    language: Language.Go,
    package: 'internal/auth',
    exported: true,
  });

  // ─── Relationships ──────────────────────────────────────

  // main CALLS ValidateToken
  graph.addRelationship({
    id: 'rel:main-calls-validate',
    type: RelationshipType.CALLS,
    sourceId: 'go:func:cmd/server/main.go:main:5',
    targetId: 'go:func:internal/auth/handler.go:ValidateToken:10',
    confidence: 1.0,
  });

  // ValidateToken CALLS parseHeader
  graph.addRelationship({
    id: 'rel:validate-calls-parse',
    type: RelationshipType.CALLS,
    sourceId: 'go:func:internal/auth/handler.go:ValidateToken:10',
    targetId: 'go:func:internal/auth/handler.go:parseHeader:35',
    confidence: 1.0,
  });

  // Config HAS_METHOD Validate
  graph.addRelationship({
    id: 'rel:config-has-validate',
    type: RelationshipType.HAS_METHOD,
    sourceId: 'go:struct:internal/auth/types.go:Config:5',
    targetId: 'go:method:internal/auth/types.go:Validate:20',
    confidence: 1.0,
  });

  // Config IMPLEMENTS Authenticator
  graph.addRelationship({
    id: 'rel:config-impl-auth',
    type: RelationshipType.IMPLEMENTS,
    sourceId: 'go:struct:internal/auth/types.go:Config:5',
    targetId: 'go:iface:internal/auth/types.go:Authenticator:35',
    confidence: 0.9,
  });

  // Dog EXTENDS Animal
  graph.addRelationship({
    id: 'rel:dog-extends-animal',
    type: RelationshipType.EXTENDS,
    sourceId: 'py:class:models.py:Dog:12',
    targetId: 'py:class:models.py:Animal:1',
    confidence: 0.9,
  });

  return graph;
}

// ─── Parser Tests ───────────────────────────────────────────────

describe('parseCypher', () => {
  it('parses simple node query', () => {
    const q = parseCypher("MATCH (n:Function) RETURN n");
    expect(q.nodes).toHaveLength(1);
    expect(q.nodes[0].variable).toBe('n');
    expect(q.nodes[0].label).toBe('Function');
    expect(q.relationships).toHaveLength(0);
    expect(q.returns).toHaveLength(1);
    expect(q.returns[0].variable).toBe('n');
    expect(q.returns[0].property).toBeNull();
  });

  it('parses node query without label', () => {
    const q = parseCypher("MATCH (n) WHERE n.name = 'main' RETURN n");
    expect(q.nodes[0].label).toBeNull();
    expect(q.conditions).toHaveLength(1);
    expect(q.conditions[0].operator).toBe('=');
    expect(q.conditions[0].value).toBe('main');
  });

  it('parses relationship pattern', () => {
    const q = parseCypher("MATCH (a)-[:CALLS]->(b) RETURN a.name, b.name");
    expect(q.nodes).toHaveLength(2);
    expect(q.relationships).toHaveLength(1);
    expect(q.relationships[0].type).toBe('CALLS');
    expect(q.relationships[0].source).toBe('a');
    expect(q.relationships[0].target).toBe('b');
  });

  it('parses relationship with labels', () => {
    const q = parseCypher(
      "MATCH (s:Struct)-[:HAS_METHOD]->(m:Method) RETURN s.name, m.name",
    );
    expect(q.nodes[0]).toEqual({ variable: 's', label: 'Struct' });
    expect(q.nodes[1]).toEqual({ variable: 'm', label: 'Method' });
    expect(q.relationships[0].type).toBe('HAS_METHOD');
  });

  it('parses WHERE with CONTAINS', () => {
    const q = parseCypher(
      "MATCH (n:Function) WHERE n.package CONTAINS 'auth' RETURN n",
    );
    expect(q.conditions).toHaveLength(1);
    expect(q.conditions[0].operator).toBe('CONTAINS');
    expect(q.conditions[0].property).toBe('package');
    expect(q.conditions[0].value).toBe('auth');
  });

  it('parses WHERE with STARTS WITH', () => {
    const q = parseCypher(
      "MATCH (n:Function) WHERE n.name STARTS WITH 'Get' RETURN n",
    );
    expect(q.conditions[0].operator).toBe('STARTS WITH');
    expect(q.conditions[0].value).toBe('Get');
  });

  it('parses WHERE with <>', () => {
    const q = parseCypher(
      "MATCH (n:Function) WHERE n.language <> 'go' RETURN n",
    );
    expect(q.conditions[0].operator).toBe('<>');
    expect(q.conditions[0].value).toBe('go');
  });

  it('parses multiple WHERE conditions with AND', () => {
    const q = parseCypher(
      "MATCH (n:Function) WHERE n.exported = 'true' AND n.language = 'go' RETURN n",
    );
    expect(q.conditions).toHaveLength(2);
    expect(q.conditions[0].property).toBe('exported');
    expect(q.conditions[1].property).toBe('language');
  });

  it('parses RETURN with properties', () => {
    const q = parseCypher("MATCH (n:Function) RETURN n.name, n.file, n.startLine");
    expect(q.returns).toHaveLength(3);
    expect(q.returns[0]).toEqual({ variable: 'n', property: 'name', alias: null });
    expect(q.returns[1]).toEqual({ variable: 'n', property: 'file', alias: null });
    expect(q.returns[2]).toEqual({ variable: 'n', property: 'startLine', alias: null });
  });

  it('parses RETURN with AS alias', () => {
    const q = parseCypher("MATCH (n:Function) RETURN n.name AS funcName");
    expect(q.returns[0].alias).toBe('funcName');
  });

  it('parses LIMIT', () => {
    const q = parseCypher("MATCH (n:Function) RETURN n LIMIT 5");
    expect(q.limit).toBe(5);
  });

  it('is case-insensitive for keywords', () => {
    const q = parseCypher("match (n:Function) where n.name = 'main' return n limit 10");
    expect(q.nodes[0].label).toBe('Function');
    expect(q.conditions[0].value).toBe('main');
    expect(q.limit).toBe(10);
  });

  // Error cases
  it('throws on empty query', () => {
    expect(() => parseCypher('')).toThrow(CypherParseError);
  });

  it('throws on missing MATCH', () => {
    expect(() => parseCypher("WHERE n.name = 'x' RETURN n")).toThrow('Missing MATCH');
  });

  it('throws on missing RETURN', () => {
    expect(() => parseCypher("MATCH (n:Function)")).toThrow('Missing RETURN');
  });

  it('throws on invalid WHERE condition', () => {
    expect(() => parseCypher(
      "MATCH (n:Function) WHERE badcondition RETURN n",
    )).toThrow(CypherParseError);
  });

  it('throws on unknown variable in WHERE', () => {
    expect(() => parseCypher(
      "MATCH (n:Function) WHERE x.name = 'foo' RETURN n",
    )).toThrow("Unknown variable 'x'");
  });

  it('throws on unknown variable in RETURN', () => {
    expect(() => parseCypher(
      "MATCH (n:Function) RETURN x.name",
    )).toThrow("Unknown variable 'x'");
  });
});

// ─── Executor Tests ─────────────────────────────────────────────

describe('executeQuery', () => {
  let graph: KnowledgeGraph;

  beforeAll(() => {
    graph = buildTestGraph();
  });

  // ── Node queries ──

  it('finds all nodes of a type', () => {
    const result = executeQuery("MATCH (n:Function) RETURN n.name", graph);
    expect(result.rowCount).toBe(3); // ValidateToken, parseHeader, main
    const names = result.rows.map(r => r['n.name']);
    expect(names).toContain('ValidateToken');
    expect(names).toContain('parseHeader');
    expect(names).toContain('main');
  });

  it('filters by name with WHERE =', () => {
    const result = executeQuery(
      "MATCH (n:Function) WHERE n.name = 'main' RETURN n.name, n.file",
      graph,
    );
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]['n.name']).toBe('main');
    expect(result.rows[0]['n.file']).toBe('cmd/server/main.go');
  });

  it('filters with CONTAINS', () => {
    const result = executeQuery(
      "MATCH (n:Function) WHERE n.package CONTAINS 'auth' RETURN n.name",
      graph,
    );
    expect(result.rowCount).toBe(2);
    const names = result.rows.map(r => r['n.name']);
    expect(names).toContain('ValidateToken');
    expect(names).toContain('parseHeader');
  });

  it('filters with STARTS WITH', () => {
    const result = executeQuery(
      "MATCH (n:Function) WHERE n.name STARTS WITH 'parse' RETURN n.name",
      graph,
    );
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]['n.name']).toBe('parseHeader');
  });

  it('filters with <>', () => {
    const result = executeQuery(
      "MATCH (n:Class) WHERE n.name <> 'Dog' RETURN n.name",
      graph,
    );
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]['n.name']).toBe('Animal');
  });

  it('filters with multiple AND conditions', () => {
    const result = executeQuery(
      "MATCH (n:Function) WHERE n.exported = 'true' AND n.language = 'go' RETURN n.name",
      graph,
    );
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]['n.name']).toBe('ValidateToken');
  });

  it('returns full node when no property specified', () => {
    const result = executeQuery(
      "MATCH (n:Struct) WHERE n.name = 'Config' RETURN n",
      graph,
    );
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]['n']).toContain('Config');
    expect(result.rows[0]['n']).toContain('Struct');
  });

  it('respects LIMIT', () => {
    const result = executeQuery(
      "MATCH (n:Function) RETURN n.name LIMIT 2",
      graph,
    );
    expect(result.rowCount).toBe(2);
    expect(result.truncated).toBe(true);
  });

  it('returns no results for non-matching query', () => {
    const result = executeQuery(
      "MATCH (n:Function) WHERE n.name = 'nonexistent' RETURN n",
      graph,
    );
    expect(result.rowCount).toBe(0);
  });

  // ── Relationship queries ──

  it('traverses CALLS edges', () => {
    const result = executeQuery(
      "MATCH (a)-[:CALLS]->(b) WHERE a.name = 'main' RETURN b.name",
      graph,
    );
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]['b.name']).toBe('ValidateToken');
  });

  it('traverses CALLS edges from target side', () => {
    const result = executeQuery(
      "MATCH (a)-[:CALLS]->(b) WHERE b.name = 'parseHeader' RETURN a.name",
      graph,
    );
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]['a.name']).toBe('ValidateToken');
  });

  it('traverses HAS_METHOD edges', () => {
    const result = executeQuery(
      "MATCH (s:Struct)-[:HAS_METHOD]->(m:Method) WHERE s.name = 'Config' RETURN m.name",
      graph,
    );
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]['m.name']).toBe('Validate');
  });

  it('traverses EXTENDS edges', () => {
    const result = executeQuery(
      "MATCH (child:Class)-[:EXTENDS]->(parent:Class) RETURN child.name, parent.name",
      graph,
    );
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]['child.name']).toBe('Dog');
    expect(result.rows[0]['parent.name']).toBe('Animal');
  });

  it('traverses IMPLEMENTS edges', () => {
    const result = executeQuery(
      "MATCH (s)-[:IMPLEMENTS]->(i:Interface) RETURN s.name, i.name",
      graph,
    );
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]['s.name']).toBe('Config');
    expect(result.rows[0]['i.name']).toBe('Authenticator');
  });

  it('lists all edges of a type without conditions', () => {
    const result = executeQuery(
      "MATCH (a)-[:CALLS]->(b) RETURN a.name, b.name",
      graph,
    );
    expect(result.rowCount).toBe(2);
  });

  it('filters relationship query with labels on both sides', () => {
    const result = executeQuery(
      "MATCH (s:Struct)-[:HAS_METHOD]->(m:Method) RETURN s.name, m.name",
      graph,
    );
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]['s.name']).toBe('Config');
    expect(result.rows[0]['m.name']).toBe('Validate');
  });

  // ── Edge cases ──

  it('handles empty graph', () => {
    const empty = new KnowledgeGraph();
    const result = executeQuery("MATCH (n:Function) RETURN n.name", empty);
    expect(result.rowCount).toBe(0);
  });

  it('handles query with alias', () => {
    const result = executeQuery(
      "MATCH (n:Function) WHERE n.name = 'main' RETURN n.name AS funcName",
      graph,
    );
    expect(result.columns).toContain('funcName');
    expect(result.rows[0]['funcName']).toBe('main');
  });

  it('is case-insensitive for WHERE value matching', () => {
    const result = executeQuery(
      "MATCH (n:Function) WHERE n.name = 'MAIN' RETURN n.name",
      graph,
    );
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]['n.name']).toBe('main');
  });

  it('throws CypherParseError on invalid query', () => {
    expect(() => executeQuery('NOT CYPHER', graph)).toThrow(CypherParseError);
  });

  it('uses default limit from parameter', () => {
    const result = executeQuery("MATCH (n:Function) RETURN n", graph, 1);
    expect(result.rowCount).toBe(1);
    expect(result.truncated).toBe(true);
  });
});

// ─── Markdown Formatting ────────────────────────────────────────

describe('formatResultAsMarkdown', () => {
  it('formats empty results', () => {
    const md = formatResultAsMarkdown({
      columns: ['name'],
      rows: [],
      rowCount: 0,
      truncated: false,
    });
    expect(md).toBe('_No results._');
  });

  it('formats single-row result as table', () => {
    const md = formatResultAsMarkdown({
      columns: ['name', 'file'],
      rows: [{ name: 'main', file: 'main.go' }],
      rowCount: 1,
      truncated: false,
    });
    expect(md).toContain('| name | file |');
    expect(md).toContain('| --- | --- |');
    expect(md).toContain('| main | main.go |');
  });

  it('formats multi-row result', () => {
    const md = formatResultAsMarkdown({
      columns: ['n.name'],
      rows: [{ 'n.name': 'foo' }, { 'n.name': 'bar' }],
      rowCount: 2,
      truncated: false,
    });
    expect(md).toContain('| foo |');
    expect(md).toContain('| bar |');
  });

  it('shows truncation notice', () => {
    const md = formatResultAsMarkdown({
      columns: ['name'],
      rows: [{ name: 'a' }],
      rowCount: 1,
      truncated: true,
    });
    expect(md).toContain('truncated');
  });

  it('escapes pipe characters in cells', () => {
    const md = formatResultAsMarkdown({
      columns: ['name'],
      rows: [{ name: 'a|b' }],
      rowCount: 1,
      truncated: false,
    });
    expect(md).toContain('a\\|b');
  });
});

// ─── Integration: Full Pipeline ─────────────────────────────────

describe('end-to-end query pipeline', () => {
  let graph: KnowledgeGraph;

  beforeAll(() => {
    graph = buildTestGraph();
  });

  it('parses, executes, and formats a node query', () => {
    const result = executeQuery("MATCH (n:Class) RETURN n.name, n.language", graph);
    const md = formatResultAsMarkdown(result);
    expect(md).toContain('Animal');
    expect(md).toContain('Dog');
    expect(md).toContain('python');
  });

  it('parses, executes, and formats a relationship query', () => {
    const result = executeQuery(
      "MATCH (a)-[:CALLS]->(b) WHERE a.name = 'ValidateToken' RETURN a.name, b.name",
      graph,
    );
    const md = formatResultAsMarkdown(result);
    expect(md).toContain('ValidateToken');
    expect(md).toContain('parseHeader');
  });

  it('handles complex multi-condition query', () => {
    const result = executeQuery(
      "MATCH (n:Function) WHERE n.language = 'go' AND n.package CONTAINS 'auth' RETURN n.name, n.exported LIMIT 10",
      graph,
    );
    expect(result.rowCount).toBe(2);
    const names = result.rows.map(r => r['n.name']);
    expect(names).toContain('ValidateToken');
    expect(names).toContain('parseHeader');
  });
});
