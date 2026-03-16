/**
 * Unit Tests: MCP Resources
 *
 * Tests resource URI parsing, data returned for each resource type,
 * and edge cases (empty graph, unknown URIs, disambiguation).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { KnowledgeGraph } from '../../src/graph/graph.js';
import { NodeType, RelationshipType, Language } from '../../src/graph/types.js';
import type { Node, Relationship } from '../../src/graph/types.js';
import {
  parseUri,
  readResource,
  getResourceDefinitions,
  getResourceTemplates,
} from '../../src/mcp/resources.js';

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

  // Packages
  g.addNode(makeNode('pkg:auth', 'auth', {
    type: NodeType.Package,
    file: '',
    startLine: 0,
    endLine: 0,
    package: 'internal/auth',
    importPath: 'myapp/internal/auth',
    files: ['internal/auth/middleware.go', 'internal/auth/token.go'],
  }));
  g.addNode(makeNode('pkg:user', 'user', {
    type: NodeType.Package,
    file: '',
    startLine: 0,
    endLine: 0,
    package: 'internal/user',
    importPath: 'myapp/internal/user',
    files: ['internal/user/model.go'],
  }));
  g.addNode(makeNode('mod:web', 'web', {
    type: NodeType.Module,
    file: '',
    startLine: 0,
    endLine: 0,
    language: Language.TypeScript,
    package: 'apps/web',
  }));

  // Functions
  g.addNode(makeNode('fn:AuthMiddleware', 'AuthMiddleware', {
    file: 'internal/auth/middleware.go',
    startLine: 10,
    endLine: 30,
  }));
  g.addNode(makeNode('fn:ValidateToken', 'ValidateToken', {
    file: 'internal/auth/token.go',
    startLine: 5,
    endLine: 25,
    params: ['token string'],
    returnType: 'error',
  }));
  g.addNode(makeNode('fn:DecodeJWT', 'DecodeJWT', {
    file: 'internal/jwt/decode.go',
    startLine: 1,
    endLine: 20,
    package: 'internal/jwt',
  }));

  // Struct with method
  g.addNode(makeNode('struct:User', 'User', {
    type: NodeType.Struct,
    file: 'internal/user/model.go',
    startLine: 5,
    endLine: 15,
    package: 'internal/user',
    fields: ['ID int', 'Name string', 'Email string'],
  }));
  g.addNode(makeNode('method:User.Save', 'Save', {
    type: NodeType.Method,
    file: 'internal/user/model.go',
    startLine: 20,
    endLine: 35,
    package: 'internal/user',
    receiver: 'User',
  }));

  // Component
  g.addNode(makeNode('comp:LoginForm', 'LoginForm', {
    type: NodeType.Component,
    file: 'apps/web/src/components/LoginForm.tsx',
    startLine: 1,
    endLine: 60,
    language: Language.TypeScript,
    package: 'apps/web/src/components',
    props: ['onSubmit', 'loading'],
  }));

  // Relationships
  g.addRelationship(makeRel('fn:AuthMiddleware', 'fn:ValidateToken'));
  g.addRelationship(makeRel('fn:ValidateToken', 'fn:DecodeJWT'));
  g.addRelationship(makeRel('struct:User', 'method:User.Save', RelationshipType.HAS_METHOD));
  g.addRelationship(makeRel('pkg:auth', 'pkg:user', RelationshipType.IMPORTS));

  return g;
}

// ─── parseUri ───────────────────────────────────────────────────

describe('parseUri', () => {
  it('parses recon://packages', () => {
    expect(parseUri('recon://packages')).toEqual({ resourceType: 'packages' });
  });

  it('parses recon://stats', () => {
    expect(parseUri('recon://stats')).toEqual({ resourceType: 'stats' });
  });

  it('parses recon://symbol/{name}', () => {
    expect(parseUri('recon://symbol/AuthMiddleware')).toEqual({
      resourceType: 'symbol',
      param: 'AuthMiddleware',
    });
  });

  it('parses recon://symbol with encoded name', () => {
    expect(parseUri('recon://symbol/User.Save')).toEqual({
      resourceType: 'symbol',
      param: 'User.Save',
    });
  });

  it('parses recon://file/{path}', () => {
    expect(parseUri('recon://file/internal/auth/token.go')).toEqual({
      resourceType: 'file',
      param: 'internal/auth/token.go',
    });
  });

  it('throws on unknown URI', () => {
    expect(() => parseUri('recon://unknown')).toThrow('Unknown resource URI');
  });

  it('throws on non-recon URI', () => {
    expect(() => parseUri('https://example.com')).toThrow('Unknown resource URI');
  });
});

// ─── getResourceDefinitions / getResourceTemplates ──────────────

describe('resource definitions', () => {
  it('returns static resource definitions', () => {
    const defs = getResourceDefinitions();
    expect(defs.length).toBe(2);
    expect(defs.map(d => d.uri)).toContain('recon://packages');
    expect(defs.map(d => d.uri)).toContain('recon://stats');
    for (const d of defs) {
      expect(d.name).toBeTruthy();
      expect(d.description).toBeTruthy();
      expect(d.mimeType).toBe('text/yaml');
    }
  });

  it('returns resource templates', () => {
    const templates = getResourceTemplates();
    expect(templates.length).toBe(3);
    expect(templates.map(t => t.uriTemplate)).toContain('recon://symbol/{name}');
    expect(templates.map(t => t.uriTemplate)).toContain('recon://file/{path}');
    expect(templates.map(t => t.uriTemplate)).toContain('recon://process/{name}');
    for (const t of templates) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.mimeType).toBe('text/yaml');
    }
  });
});

// ─── readResource: packages ─────────────────────────────────────

describe('readResource: packages', () => {
  let graph: KnowledgeGraph;

  beforeEach(() => {
    graph = buildMockGraph();
  });

  it('lists all packages and modules', () => {
    const output = readResource('recon://packages', graph);
    expect(output).toContain('package_count: 3');
    expect(output).toContain('auth');
    expect(output).toContain('user');
    expect(output).toContain('web');
  });

  it('includes import paths', () => {
    const output = readResource('recon://packages', graph);
    expect(output).toContain('myapp/internal/auth');
  });

  it('shows dependency counts', () => {
    const output = readResource('recon://packages', graph);
    // auth imports user, so auth has imports: 1
    expect(output).toContain('imports: 1');
    // user is imported by auth, so user has imported_by: 1
    expect(output).toContain('imported_by: 1');
  });

  it('shows file count when available', () => {
    const output = readResource('recon://packages', graph);
    expect(output).toContain('files: 2'); // auth has 2 files
  });

  it('handles empty graph', () => {
    const empty = new KnowledgeGraph();
    const output = readResource('recon://packages', empty);
    expect(output).toContain('packages: []');
  });
});

// ─── readResource: stats ────────────────────────────────────────

describe('readResource: stats', () => {
  let graph: KnowledgeGraph;

  beforeEach(() => {
    graph = buildMockGraph();
  });

  it('shows total counts', () => {
    const output = readResource('recon://stats', graph);
    expect(output).toContain(`total_nodes: ${graph.nodeCount}`);
    expect(output).toContain(`total_relationships: ${graph.relationshipCount}`);
  });

  it('breaks down nodes by type', () => {
    const output = readResource('recon://stats', graph);
    expect(output).toContain('nodes_by_type:');
    expect(output).toContain('Function:');
    expect(output).toContain('Package:');
    expect(output).toContain('Struct:');
  });

  it('breaks down nodes by language', () => {
    const output = readResource('recon://stats', graph);
    expect(output).toContain('nodes_by_language:');
    expect(output).toContain('go:');
    expect(output).toContain('typescript:');
  });

  it('breaks down relationships by type', () => {
    const output = readResource('recon://stats', graph);
    expect(output).toContain('relationships_by_type:');
    expect(output).toContain('CALLS:');
    expect(output).toContain('HAS_METHOD:');
    expect(output).toContain('IMPORTS:');
  });

  it('handles empty graph', () => {
    const empty = new KnowledgeGraph();
    const output = readResource('recon://stats', empty);
    expect(output).toContain('total_nodes: 0');
    expect(output).toContain('total_relationships: 0');
  });
});

// ─── readResource: symbol ───────────────────────────────────────

describe('readResource: symbol', () => {
  let graph: KnowledgeGraph;

  beforeEach(() => {
    graph = buildMockGraph();
  });

  it('returns symbol details', () => {
    const output = readResource('recon://symbol/ValidateToken', graph);
    expect(output).toContain('name: "ValidateToken"');
    expect(output).toContain('type: Function');
    expect(output).toContain('file: "internal/auth/token.go"');
    expect(output).toContain('lines: 5-25');
    expect(output).toContain('exported: true');
  });

  it('shows incoming relationships', () => {
    const output = readResource('recon://symbol/ValidateToken', graph);
    expect(output).toContain('incoming:');
    expect(output).toContain('CALLS');
    expect(output).toContain('AuthMiddleware');
  });

  it('shows outgoing relationships', () => {
    const output = readResource('recon://symbol/ValidateToken', graph);
    expect(output).toContain('outgoing:');
    expect(output).toContain('DecodeJWT');
  });

  it('shows optional fields', () => {
    const output = readResource('recon://symbol/ValidateToken', graph);
    expect(output).toContain('params:');
    expect(output).toContain('return_type:');
  });

  it('shows struct fields', () => {
    // Add a uniquely-named struct to avoid disambiguation with 'user' package
    graph.addNode(makeNode('struct:Profile', 'Profile', {
      type: NodeType.Struct,
      file: 'internal/user/profile.go',
      startLine: 1,
      endLine: 10,
      package: 'internal/user',
      fields: ['Name string', 'Avatar string'],
    }));
    const output = readResource('recon://symbol/Profile', graph);
    expect(output).toContain('fields:');
    expect(output).toContain('Name string');
  });

  it('shows component props', () => {
    const output = readResource('recon://symbol/LoginForm', graph);
    expect(output).toContain('props:');
    expect(output).toContain('onSubmit');
  });

  it('shows method receiver', () => {
    const output = readResource('recon://symbol/Save', graph);
    expect(output).toContain('receiver: "User"');
  });

  it('returns disambiguation for multiple matches', () => {
    // Add a second ValidateToken
    graph.addNode(makeNode('fn:VT2', 'ValidateToken', {
      file: 'internal/oauth/validate.go',
      package: 'internal/oauth',
    }));
    const output = readResource('recon://symbol/ValidateToken', graph);
    expect(output).toContain('matches: 2');
    expect(output).toContain('symbols:');
    expect(output).toContain('internal/auth/token.go');
    expect(output).toContain('internal/oauth/validate.go');
  });

  it('returns error for unknown symbol', () => {
    const output = readResource('recon://symbol/NonExistent', graph);
    expect(output).toContain('error:');
    expect(output).toContain('not found');
  });
});

// ─── readResource: file ─────────────────────────────────────────

describe('readResource: file', () => {
  let graph: KnowledgeGraph;

  beforeEach(() => {
    graph = buildMockGraph();
  });

  it('lists symbols in a file', () => {
    const output = readResource('recon://file/internal/user/model.go', graph);
    expect(output).toContain('User');
    expect(output).toContain('Save');
    expect(output).toContain('Struct');
    expect(output).toContain('Method');
  });

  it('counts symbols correctly', () => {
    const output = readResource('recon://file/internal/user/model.go', graph);
    expect(output).toContain('total_symbols: 2');
  });

  it('works with substring path match', () => {
    const output = readResource('recon://file/model.go', graph);
    expect(output).toContain('User');
    expect(output).toContain('Save');
  });

  it('shows file path in output', () => {
    const output = readResource('recon://file/internal/auth/token.go', graph);
    expect(output).toContain('file: "internal/auth/token.go"');
    expect(output).toContain('ValidateToken');
  });

  it('shows exported status', () => {
    const output = readResource('recon://file/internal/auth/token.go', graph);
    expect(output).toContain('exported: true');
  });

  it('returns error for no matches', () => {
    const output = readResource('recon://file/nonexistent.go', graph);
    expect(output).toContain('error:');
    expect(output).toContain('No symbols found');
  });

  it('matches multiple files with broad pattern', () => {
    const output = readResource('recon://file/internal/auth', graph);
    // Should find AuthMiddleware (middleware.go) and ValidateToken (token.go)
    expect(output).toContain('AuthMiddleware');
    expect(output).toContain('ValidateToken');
    expect(output).toContain('total_symbols: 2');
  });
});
