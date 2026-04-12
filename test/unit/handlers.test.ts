/**
 * Unit Tests: MCP Tool Handlers (v6)
 *
 * Tests recon_find, recon_impact, recon_explain, recon_map, recon_rules
 * against a mock graph.
 *
 * The mock graph models a small Go + TS codebase:
 *
 *   [AuthMiddleware] --CALLS--> [ValidateToken] --CALLS--> [DecodeJWT]
 *   [LoginHandler]   --CALLS--> [ValidateToken]
 *   [UserService]    --CALLS--> [LoginHandler]
 *   [LoginPage]      --USES_COMPONENT--> [LoginForm]
 *   [LoginForm]      --CALLS_API--> [LoginHandler]
 *   [AuthPkg]        --IMPORTS--> [JWTPkg]
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { KnowledgeGraph } from '../../src/graph/graph.js';
import { NodeType, RelationshipType, Language } from '../../src/graph/types.js';
import type { Node, Relationship } from '../../src/graph/types.js';
import { handleToolCall } from '../../src/mcp/handlers.js';

// ─── Mock Graph Builder ─────────────────────────────────────────

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
  metadata?: Relationship['metadata'],
): Relationship {
  return {
    id: `${sourceId}-${type}-${targetId}`,
    type,
    sourceId,
    targetId,
    confidence: 1.0,
    metadata,
  };
}

function buildMockGraph(): KnowledgeGraph {
  const g = new KnowledgeGraph();

  // ── Packages ──
  g.addNode(makeNode('go:pkg:internal/auth', 'auth', {
    type: NodeType.Package,
    file: '',
    package: 'internal/auth',
    importPath: 'myapp/internal/auth',
    files: ['internal/auth/middleware.go', 'internal/auth/token.go'],
    imports: ['myapp/internal/jwt'],
  }));
  g.addNode(makeNode('go:pkg:internal/jwt', 'jwt', {
    type: NodeType.Package,
    file: '',
    package: 'internal/jwt',
    importPath: 'myapp/internal/jwt',
    files: ['internal/jwt/decode.go'],
    imports: [],
  }));

  // ── Go Functions ──
  g.addNode(makeNode('go:func:auth.AuthMiddleware', 'AuthMiddleware', {
    file: 'internal/auth/middleware.go',
    startLine: 10,
    endLine: 30,
    package: 'internal/auth',
  }));
  g.addNode(makeNode('go:func:auth.ValidateToken', 'ValidateToken', {
    file: 'internal/auth/token.go',
    startLine: 5,
    endLine: 25,
    package: 'internal/auth',
  }));
  g.addNode(makeNode('go:func:jwt.DecodeJWT', 'DecodeJWT', {
    file: 'internal/jwt/decode.go',
    startLine: 1,
    endLine: 20,
    package: 'internal/jwt',
  }));
  g.addNode(makeNode('go:func:handler.LoginHandler', 'LoginHandler', {
    file: 'apps/api/handler/login.go',
    startLine: 15,
    endLine: 45,
    package: 'apps/api/handler',
  }));
  g.addNode(makeNode('go:func:service.UserService', 'UserService', {
    file: 'apps/api/service/user.go',
    startLine: 10,
    endLine: 50,
    package: 'apps/api/service',
  }));

  // ── TS Components ──
  g.addNode(makeNode('ts:comp:LoginPage', 'LoginPage', {
    type: NodeType.Component,
    file: 'apps/web/src/pages/LoginPage.tsx',
    startLine: 5,
    endLine: 40,
    language: Language.TypeScript,
    package: 'apps/web/src/pages',
  }));
  g.addNode(makeNode('ts:comp:LoginForm', 'LoginForm', {
    type: NodeType.Component,
    file: 'apps/web/src/components/LoginForm.tsx',
    startLine: 1,
    endLine: 60,
    language: Language.TypeScript,
    package: 'apps/web/src/components',
  }));

  // ── Relationships ──
  // AuthMiddleware -> ValidateToken -> DecodeJWT
  g.addRelationship(makeRel(
    'go:func:auth.AuthMiddleware', 'go:func:auth.ValidateToken',
  ));
  g.addRelationship(makeRel(
    'go:func:auth.ValidateToken', 'go:func:jwt.DecodeJWT',
  ));
  // LoginHandler -> ValidateToken
  g.addRelationship(makeRel(
    'go:func:handler.LoginHandler', 'go:func:auth.ValidateToken',
  ));
  // UserService -> LoginHandler
  g.addRelationship(makeRel(
    'go:func:service.UserService', 'go:func:handler.LoginHandler',
  ));
  // LoginPage -> LoginForm (component usage)
  g.addRelationship(makeRel(
    'ts:comp:LoginPage', 'ts:comp:LoginForm',
    RelationshipType.USES_COMPONENT,
  ));
  // LoginForm -> LoginHandler (cross-language API call)
  g.addRelationship(makeRel(
    'ts:comp:LoginForm', 'go:func:handler.LoginHandler',
    RelationshipType.CALLS_API,
    { httpMethod: 'POST', urlPattern: '/api/auth/login' },
  ));
  // auth pkg -> jwt pkg
  g.addRelationship(makeRel(
    'go:pkg:internal/auth', 'go:pkg:internal/jwt',
    RelationshipType.IMPORTS,
  ));

  return g;
}

// ─── Tests ──────────────────────────────────────────────────────

describe('recon_find handler', () => {
  let graph: KnowledgeGraph;

  beforeEach(() => {
    graph = buildMockGraph();
  });

  it('finds symbols by substring match', async () => {
    const result = await handleToolCall('recon_find', { query: 'Login' }, graph);
    expect(result).toContain('LoginHandler');
    expect(result).toContain('LoginPage');
    expect(result).toContain('LoginForm');
  });

  it('returns result count', async () => {
    const result = await handleToolCall('recon_find', { query: 'Login' }, graph);
    expect(result).toContain('Found 3');
  });

  it('filters by type', async () => {
    const result = await handleToolCall('recon_find', {
      query: 'Login',
      type: 'Component',
    }, graph);
    expect(result).toContain('LoginPage');
    expect(result).toContain('LoginForm');
    expect(result).not.toContain('LoginHandler');
  });

  it('filters by language', async () => {
    const result = await handleToolCall('recon_find', {
      query: 'Login',
      language: 'go',
    }, graph);
    expect(result).toContain('LoginHandler');
    expect(result).not.toContain('LoginPage');
  });

  it('filters by package', async () => {
    const result = await handleToolCall('recon_find', {
      query: 'Login',
      package: 'apps/web',
    }, graph);
    expect(result).toContain('LoginPage');
    expect(result).toContain('LoginForm');
    expect(result).not.toContain('LoginHandler');
  });

  it('respects limit', async () => {
    const result = await handleToolCall('recon_find', {
      query: 'Login',
      limit: 1,
    }, graph);
    // Should only have 1 result entry (count the bold names)
    const entries = result.split('\n').filter(l => l.startsWith('- **'));
    expect(entries.length).toBe(1);
  });

  it('returns structured error on missing query', async () => {
    const result = await handleToolCall('recon_find', {}, graph);
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe('invalid_parameter');
  });

  it('exact match appears in results', async () => {
    const result = await handleToolCall('recon_find', { query: 'DecodeJWT' }, graph);
    expect(result).toContain('DecodeJWT');
  });
});

describe('recon_impact handler', () => {
  let graph: KnowledgeGraph;

  beforeEach(() => {
    graph = buildMockGraph();
  });

  it('finds upstream callers at d=1', async () => {
    const result = await handleToolCall('recon_impact', {
      target: 'ValidateToken',
      direction: 'upstream',
    }, graph);
    // d=1 should include AuthMiddleware and LoginHandler
    expect(result).toContain('AuthMiddleware');
    expect(result).toContain('LoginHandler');
    expect(result).toContain('WILL BREAK');
  });

  it('finds transitive upstream at d=2', async () => {
    const result = await handleToolCall('recon_impact', {
      target: 'ValidateToken',
      direction: 'upstream',
    }, graph);
    // d=2 should include UserService (calls LoginHandler which calls ValidateToken)
    expect(result).toContain('UserService');
  });

  it('finds downstream callees', async () => {
    const result = await handleToolCall('recon_impact', {
      target: 'AuthMiddleware',
      direction: 'downstream',
    }, graph);
    // d=1: ValidateToken
    expect(result).toContain('ValidateToken');
    // d=2: DecodeJWT
    expect(result).toContain('DecodeJWT');
  });

  it('reports risk level', async () => {
    const result = await handleToolCall('recon_impact', {
      target: 'ValidateToken',
      direction: 'upstream',
    }, graph);
    // 2 direct callers from different apps -> CRITICAL
    expect(result).toContain('CRITICAL');
  });

  it('respects maxDepth', async () => {
    const result = await handleToolCall('recon_impact', {
      target: 'ValidateToken',
      direction: 'upstream',
      maxDepth: 1,
    }, graph);
    // Only d=1, no UserService at d=2
    expect(result).toContain('AuthMiddleware');
    expect(result).not.toContain('UserService');
  });

  it('returns structured error on missing target', async () => {
    const result = await handleToolCall('recon_impact', { direction: 'upstream' }, graph);
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe('invalid_parameter');
  });

  it('returns structured error on invalid direction', async () => {
    const result = await handleToolCall('recon_impact', { target: 'Foo', direction: 'sideways' }, graph);
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe('invalid_parameter');
  });

  it('returns structured error on unknown symbol', async () => {
    const result = await handleToolCall('recon_impact', { target: 'NonExistent', direction: 'upstream' }, graph);
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe('symbol_not_found');
  });

  it('disambiguates with file filter', async () => {
    const result = await handleToolCall('recon_impact', {
      target: 'ValidateToken',
      direction: 'upstream',
      file: 'token.go',
    }, graph);
    expect(result).toContain('ValidateToken');
  });
});

describe('recon_explain handler', () => {
  let graph: KnowledgeGraph;

  beforeEach(() => {
    graph = buildMockGraph();
  });

  it('shows callers and callees', async () => {
    const result = await handleToolCall('recon_explain', {
      name: 'ValidateToken',
    }, graph);
    // Callers: AuthMiddleware, LoginHandler
    expect(result).toContain('AuthMiddleware');
    expect(result).toContain('LoginHandler');
    // Callees: DecodeJWT
    expect(result).toContain('DecodeJWT');
  });

  it('shows node metadata', async () => {
    const result = await handleToolCall('recon_explain', {
      name: 'ValidateToken',
    }, graph);
    expect(result).toContain('# Context: ValidateToken');
    expect(result).toContain('**Type:** Function');
    expect(result).toContain('**Language:** go');
    expect(result).toContain('internal/auth');
  });

  it('shows component usage relationships', async () => {
    const result = await handleToolCall('recon_explain', {
      name: 'LoginForm',
    }, graph);
    // Used by: LoginPage (USES_COMPONENT incoming)
    expect(result).toContain('LoginPage');
  });

  it('returns structured error on missing name', async () => {
    const result = await handleToolCall('recon_explain', {}, graph);
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe('invalid_parameter');
  });

  it('returns structured error on unknown symbol', async () => {
    const result = await handleToolCall('recon_explain', { name: 'NonExistent' }, graph);
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe('symbol_not_found');
  });

  it('disambiguates with file filter', async () => {
    const result = await handleToolCall('recon_explain', {
      name: 'ValidateToken',
      file: 'token.go',
    }, graph);
    expect(result).toContain('# Context: ValidateToken');
  });
});

describe('recon_map handler', () => {
  let graph: KnowledgeGraph;

  beforeEach(() => {
    graph = buildMockGraph();
  });

  it('lists all packages', async () => {
    const result = await handleToolCall('recon_map', {}, graph);
    expect(result).toContain('internal/auth');
    expect(result).toContain('internal/jwt');
  });

  it('shows package overview header', async () => {
    const result = await handleToolCall('recon_map', {}, graph);
    expect(result).toContain('Package Overview');
  });

  it('shows node count', async () => {
    const result = await handleToolCall('recon_map', {}, graph);
    // Should contain stats line with node count
    expect(result).toContain('nodes');
  });
});

describe('recon_rules handler', () => {
  let graph: KnowledgeGraph;

  beforeEach(() => {
    graph = buildMockGraph();
  });

  it('runs a specific rule', async () => {
    const result = await handleToolCall('recon_rules', { rule: 'dead_code' }, graph);
    expect(result).toContain('Rule: dead_code');
    expect(result).toContain('Issues found');
  });

  it('runs all rules when no rule specified', async () => {
    const result = await handleToolCall('recon_rules', {}, graph);
    expect(result).toContain('Code Quality Report');
    expect(result).toContain('dead_code');
    expect(result).toContain('unused_exports');
    expect(result).toContain('circular_deps');
    expect(result).toContain('large_files');
    expect(result).toContain('orphans');
  });

  it('returns structured error for invalid rule', async () => {
    const result = await handleToolCall('recon_rules', { rule: 'nonexistent' }, graph);
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe('invalid_parameter');
  });
});

describe('unknown tool', () => {
  it('returns structured error for unknown tool name', async () => {
    const graph = buildMockGraph();
    const result = await handleToolCall('recon_nonexistent', {}, graph);
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe('unknown_tool');
    expect(parsed.tool).toBe('recon_nonexistent');
  });
});

describe('empty graph', () => {
  it('returns empty_graph error for non-map tools', async () => {
    const emptyGraph = new KnowledgeGraph();
    const result = await handleToolCall('recon_find', { query: 'test' }, emptyGraph);
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe('empty_graph');
  });

  it('allows recon_map on empty graph', async () => {
    const emptyGraph = new KnowledgeGraph();
    const result = await handleToolCall('recon_map', {}, emptyGraph);
    // Should not return an error, but show empty overview
    expect(result).toContain('Package Overview');
  });
});
