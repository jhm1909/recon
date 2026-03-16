/**
 * Unit Tests: MCP Tool Handlers
 *
 * Tests recon_query, recon_impact, recon_context against a mock graph.
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

describe('recon_query handler', () => {
  let graph: KnowledgeGraph;

  beforeEach(() => {
    graph = buildMockGraph();
  });

  it('finds symbols by substring match', async () => {
    const result = await handleToolCall('recon_query', { query: 'Login' }, graph);
    expect(result).toContain('LoginHandler');
    expect(result).toContain('LoginPage');
    expect(result).toContain('LoginForm');
  });

  it('returns match count', async () => {
    const result = await handleToolCall('recon_query', { query: 'Login' }, graph);
    expect(result).toContain('**Matches:** 3');
  });

  it('filters by type', async () => {
    const result = await handleToolCall('recon_query', {
      query: 'Login',
      type: 'Component',
    }, graph);
    expect(result).toContain('LoginPage');
    expect(result).toContain('LoginForm');
    expect(result).not.toContain('LoginHandler');
  });

  it('filters by language', async () => {
    const result = await handleToolCall('recon_query', {
      query: 'Login',
      language: 'go',
    }, graph);
    expect(result).toContain('LoginHandler');
    expect(result).not.toContain('LoginPage');
  });

  it('filters by package', async () => {
    const result = await handleToolCall('recon_query', {
      query: 'Login',
      package: 'apps/web',
    }, graph);
    expect(result).toContain('LoginPage');
    expect(result).toContain('LoginForm');
    expect(result).not.toContain('LoginHandler');
  });

  it('respects limit', async () => {
    const result = await handleToolCall('recon_query', {
      query: 'Login',
      limit: 1,
    }, graph);
    expect(result).toContain('showing 1');
  });

  it('throws on missing query', async () => {
    await expect(
      handleToolCall('recon_query', {}, graph),
    ).rejects.toThrow("'query' parameter is required");
  });

  it('exact match scores higher than substring', async () => {
    const result = await handleToolCall('recon_query', { query: 'DecodeJWT' }, graph);
    // DecodeJWT should appear first (exact name match via BM25)
    expect(result).toContain('DecodeJWT');
    // BM25 tokenizes "DecodeJWT" → ["decode", "jwt"], also matching jwt package
    const lines = result.split('\n').filter(l => l.startsWith('- **'));
    expect(lines[0]).toContain('DecodeJWT');
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
    // and LoginForm (CALLS_API to LoginHandler)
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
    // 2 direct callers but cross-app (apps/api + apps/web) → CRITICAL
    expect(result).toContain('**Risk:** CRITICAL');
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

  it('throws on missing target', async () => {
    await expect(
      handleToolCall('recon_impact', { direction: 'upstream' }, graph),
    ).rejects.toThrow("'target' is required");
  });

  it('throws on invalid direction', async () => {
    await expect(
      handleToolCall('recon_impact', { target: 'Foo', direction: 'sideways' }, graph),
    ).rejects.toThrow('Invalid direction');
  });

  it('throws on unknown symbol', async () => {
    await expect(
      handleToolCall('recon_impact', { target: 'NonExistent', direction: 'upstream' }, graph),
    ).rejects.toThrow('not found');
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

describe('recon_context handler', () => {
  let graph: KnowledgeGraph;

  beforeEach(() => {
    graph = buildMockGraph();
  });

  it('shows callers and callees', async () => {
    const result = await handleToolCall('recon_context', {
      name: 'ValidateToken',
    }, graph);
    // Callers: AuthMiddleware, LoginHandler
    expect(result).toContain('AuthMiddleware');
    expect(result).toContain('LoginHandler');
    // Callees: DecodeJWT
    expect(result).toContain('DecodeJWT');
  });

  it('shows node metadata', async () => {
    const result = await handleToolCall('recon_context', {
      name: 'ValidateToken',
    }, graph);
    expect(result).toContain('# Context: ValidateToken');
    expect(result).toContain('**Type:** Function');
    expect(result).toContain('**Language:** go');
    expect(result).toContain('internal/auth');
  });

  it('shows component usage relationships', async () => {
    const result = await handleToolCall('recon_context', {
      name: 'LoginForm',
    }, graph);
    // Used by: LoginPage (USES_COMPONENT incoming)
    expect(result).toContain('LoginPage');
  });

  it('throws on missing name', async () => {
    await expect(
      handleToolCall('recon_context', {}, graph),
    ).rejects.toThrow("'name' is required");
  });

  it('throws on unknown symbol', async () => {
    await expect(
      handleToolCall('recon_context', { name: 'NonExistent' }, graph),
    ).rejects.toThrow('not found');
  });

  it('disambiguates with file filter', async () => {
    const result = await handleToolCall('recon_context', {
      name: 'ValidateToken',
      file: 'token.go',
    }, graph);
    expect(result).toContain('# Context: ValidateToken');
  });
});

describe('recon_packages handler', () => {
  let graph: KnowledgeGraph;

  beforeEach(() => {
    graph = buildMockGraph();
  });

  it('lists all packages', async () => {
    const result = await handleToolCall('recon_packages', {}, graph);
    expect(result).toContain('internal/auth');
    expect(result).toContain('internal/jwt');
  });

  it('shows package relationships', async () => {
    const result = await handleToolCall('recon_packages', {}, graph);
    expect(result).toContain('Recon');
    expect(result).toContain('Package Overview');
  });

  it('filters by language', async () => {
    const result = await handleToolCall('recon_packages', { language: 'go' }, graph);
    expect(result).toContain('internal/auth');
  });
});

describe('recon_api_map handler', () => {
  let graph: KnowledgeGraph;

  beforeEach(() => {
    graph = buildMockGraph();
  });

  it('shows API routes with consumers', async () => {
    const result = await handleToolCall('recon_api_map', {}, graph);
    expect(result).toContain('POST');
    expect(result).toContain('/api/auth/login');
    expect(result).toContain('LoginHandler');
    expect(result).toContain('LoginForm');
  });

  it('filters by HTTP method', async () => {
    const result = await handleToolCall('recon_api_map', { method: 'GET' }, graph);
    // No GET routes in mock graph
    expect(result).toContain('**Total routes:** 0');
  });

  it('filters by pattern', async () => {
    const result = await handleToolCall('recon_api_map', { pattern: 'login' }, graph);
    expect(result).toContain('/api/auth/login');
  });
});

describe('unknown tool', () => {
  it('throws for unknown tool name', async () => {
    const graph = buildMockGraph();
    await expect(
      handleToolCall('recon_nonexistent', {}, graph),
    ).rejects.toThrow('Unknown tool');
  });
});
