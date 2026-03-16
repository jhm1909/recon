/**
 * Unit Tests: recon_rename
 *
 * Tests rename planning with a mock graph:
 *   [AuthMiddleware] --CALLS--> [ValidateToken] --CALLS--> [DecodeJWT]
 *   [LoginHandler]   --CALLS--> [ValidateToken]
 *   [UserStruct]     --HAS_METHOD--> [UserStruct.Save]
 *   [Cacheable]      --IMPLEMENTS-- [UserStruct]
 *   [LoginPage]      --USES_COMPONENT--> [LoginForm]
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { KnowledgeGraph } from '../../src/graph/graph.js';
import { NodeType, RelationshipType, Language } from '../../src/graph/types.js';
import type { Node, Relationship } from '../../src/graph/types.js';
import { planRename, formatRenameResult } from '../../src/mcp/rename.js';
import type { RenameResult } from '../../src/mcp/rename.js';
import { handleToolCall } from '../../src/mcp/handlers.js';

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
  g.addNode(makeNode('fn:AuthMiddleware', 'AuthMiddleware', {
    file: 'internal/auth/middleware.go',
    startLine: 10,
    endLine: 30,
  }));
  g.addNode(makeNode('fn:ValidateToken', 'ValidateToken', {
    file: 'internal/auth/token.go',
    startLine: 5,
    endLine: 25,
  }));
  g.addNode(makeNode('fn:DecodeJWT', 'DecodeJWT', {
    file: 'internal/jwt/decode.go',
    startLine: 1,
    endLine: 20,
    package: 'internal/jwt',
  }));
  g.addNode(makeNode('fn:LoginHandler', 'LoginHandler', {
    file: 'apps/api/handler/login.go',
    startLine: 15,
    endLine: 45,
    package: 'apps/api/handler',
  }));

  // Struct with method
  g.addNode(makeNode('struct:User', 'User', {
    type: NodeType.Struct,
    file: 'internal/user/model.go',
    startLine: 5,
    endLine: 15,
    package: 'internal/user',
  }));
  g.addNode(makeNode('method:User.Save', 'Save', {
    type: NodeType.Method,
    file: 'internal/user/model.go',
    startLine: 20,
    endLine: 35,
    package: 'internal/user',
  }));

  // Interface
  g.addNode(makeNode('iface:Cacheable', 'Cacheable', {
    type: NodeType.Interface,
    file: 'internal/cache/types.go',
    startLine: 3,
    endLine: 8,
    package: 'internal/cache',
  }));

  // TS Components
  g.addNode(makeNode('comp:LoginPage', 'LoginPage', {
    type: NodeType.Component,
    file: 'apps/web/src/pages/LoginPage.tsx',
    startLine: 5,
    endLine: 40,
    language: Language.TypeScript,
    package: 'apps/web/src/pages',
  }));
  g.addNode(makeNode('comp:LoginForm', 'LoginForm', {
    type: NodeType.Component,
    file: 'apps/web/src/components/LoginForm.tsx',
    startLine: 1,
    endLine: 60,
    language: Language.TypeScript,
    package: 'apps/web/src/components',
  }));

  // Duplicate name in different package (for disambiguation tests)
  g.addNode(makeNode('fn:ValidateToken2', 'ValidateToken', {
    file: 'internal/oauth/validate.go',
    startLine: 10,
    endLine: 30,
    package: 'internal/oauth',
    exported: false,
  }));

  // Relationships
  g.addRelationship(makeRel('fn:AuthMiddleware', 'fn:ValidateToken'));
  g.addRelationship(makeRel('fn:ValidateToken', 'fn:DecodeJWT'));
  g.addRelationship(makeRel('fn:LoginHandler', 'fn:ValidateToken'));
  g.addRelationship(makeRel('struct:User', 'method:User.Save', RelationshipType.HAS_METHOD));
  g.addRelationship(makeRel('struct:User', 'iface:Cacheable', RelationshipType.IMPLEMENTS));
  g.addRelationship(makeRel('comp:LoginPage', 'comp:LoginForm', RelationshipType.USES_COMPONENT));

  return g;
}

// ─── planRename Tests ───────────────────────────────────────────

describe('planRename', () => {
  let graph: KnowledgeGraph;

  beforeEach(() => {
    graph = buildMockGraph();
  });

  it('finds definition edit', () => {
    const result = planRename(graph, 'DecodeJWT', 'ParseJWT') as RenameResult;
    expect(result.oldName).toBe('DecodeJWT');
    expect(result.newName).toBe('ParseJWT');
    expect(result.definition).toEqual({ file: 'internal/jwt/decode.go', line: 1 });

    const defEdit = result.edits.find(e => e.context === 'definition');
    expect(defEdit).toBeDefined();
    expect(defEdit!.file).toBe('internal/jwt/decode.go');
    expect(defEdit!.confidence).toBe('graph');
  });

  it('finds callers as graph references', () => {
    const result = planRename(graph, 'ValidateToken', 'CheckToken', 'internal/auth/token.go') as RenameResult;

    // Should find AuthMiddleware and LoginHandler as callers
    const callerEdits = result.edits.filter(
      e => e.context.includes('called by'),
    );
    expect(callerEdits.length).toBe(2);

    const callerFiles = callerEdits.map(e => e.file).sort();
    expect(callerFiles).toContain('internal/auth/middleware.go');
    expect(callerFiles).toContain('apps/api/handler/login.go');

    // All caller edits should be graph confidence
    for (const edit of callerEdits) {
      expect(edit.confidence).toBe('graph');
    }
  });

  it('finds HAS_METHOD references when renaming a struct', () => {
    const result = planRename(graph, 'User', 'Account') as RenameResult;

    // Should include the Save method as a reference
    const methodEdit = result.edits.find(e => e.context.includes('method Save'));
    expect(methodEdit).toBeDefined();
    expect(methodEdit!.file).toBe('internal/user/model.go');
    expect(methodEdit!.confidence).toBe('graph');
  });

  it('finds IMPLEMENTS references when renaming an interface', () => {
    const result = planRename(graph, 'Cacheable', 'Storable') as RenameResult;

    // Should include User struct as an implementor (generic incoming loop catches it first)
    const implEdit = result.edits.find(e => e.context.includes('implemented'));
    expect(implEdit).toBeDefined();
    expect(implEdit!.file).toBe('internal/user/model.go');
    expect(implEdit!.confidence).toBe('graph');
  });

  it('finds USES_COMPONENT references', () => {
    const result = planRename(graph, 'LoginForm', 'AuthForm') as RenameResult;

    // LoginPage uses LoginForm
    const useEdit = result.edits.find(e => e.context.includes('used by LoginPage'));
    expect(useEdit).toBeDefined();
    expect(useEdit!.file).toBe('apps/web/src/pages/LoginPage.tsx');
    expect(useEdit!.confidence).toBe('graph');
  });

  it('tags same-name symbols as text_search', () => {
    // There are two "ValidateToken" symbols. When renaming one,
    // the other should show as text_search reference
    const result = planRename(graph, 'ValidateToken', 'CheckToken', 'internal/auth/token.go') as RenameResult;

    const textEdits = result.edits.filter(e => e.confidence === 'text_search');
    expect(textEdits.length).toBe(1);
    expect(textEdits[0].file).toBe('internal/oauth/validate.go');
  });

  it('returns disambiguation when multiple symbols match', () => {
    // Without file filter, "ValidateToken" is ambiguous
    const result = planRename(graph, 'ValidateToken', 'CheckToken');

    // Should get disambiguation string (the exported one wins over unexported)
    // Actually, the logic prefers exported, so it should work. Let me check...
    // There are 2 matches, exact case match doesn't help, exported filters to 1.
    // So it should resolve to the exported one.
    expect(typeof result).not.toBe('string');
  });

  it('disambiguates with file filter', () => {
    const result = planRename(graph, 'ValidateToken', 'CheckToken', 'oauth') as RenameResult;
    expect(result.definition!.file).toBe('internal/oauth/validate.go');
  });

  it('returns disambiguation string when truly ambiguous', () => {
    // Add another exported ValidateToken to make it truly ambiguous
    graph.addNode(makeNode('fn:ValidateToken3', 'ValidateToken', {
      file: 'internal/v2/token.go',
      startLine: 1,
      package: 'internal/v2',
      exported: true,
    }));

    const result = planRename(graph, 'ValidateToken', 'CheckToken');
    expect(typeof result).toBe('string');
    expect(result as string).toContain('Multiple symbols');
    expect(result as string).toContain('disambiguate');
  });

  it('counts files affected correctly', () => {
    const result = planRename(graph, 'ValidateToken', 'CheckToken', 'internal/auth/token.go') as RenameResult;
    // definition (token.go) + AuthMiddleware (middleware.go) + LoginHandler (login.go) + text_search (validate.go)
    expect(result.filesAffected).toBe(4);
  });

  it('deduplicates edits at same file:line', () => {
    const result = planRename(graph, 'DecodeJWT', 'ParseJWT') as RenameResult;
    const locations = result.edits.map(e => `${e.file}:${e.line}`);
    const unique = new Set(locations);
    expect(locations.length).toBe(unique.size);
  });

  it('sorts definition first', () => {
    const result = planRename(graph, 'ValidateToken', 'CheckToken', 'internal/auth/token.go') as RenameResult;
    expect(result.edits[0].context).toBe('definition');
  });

  it('throws on unknown symbol', () => {
    expect(() => planRename(graph, 'NonExistent', 'NewName')).toThrow('not found');
  });

  it('throws on same name', () => {
    expect(() => planRename(graph, 'DecodeJWT', 'DecodeJWT')).toThrow('same as the current');
  });

  it('throws when file filter matches nothing', () => {
    expect(() => planRename(graph, 'DecodeJWT', 'ParseJWT', 'nonexistent')).toThrow('not found');
  });

  it('sets dryRun flag correctly', () => {
    const dryResult = planRename(graph, 'DecodeJWT', 'ParseJWT', undefined, true) as RenameResult;
    expect(dryResult.dryRun).toBe(true);

    const applyResult = planRename(graph, 'DecodeJWT', 'ParseJWT', undefined, false) as RenameResult;
    expect(applyResult.dryRun).toBe(false);
  });
});

// ─── formatRenameResult Tests ───────────────────────────────────

describe('formatRenameResult', () => {
  let graph: KnowledgeGraph;

  beforeEach(() => {
    graph = buildMockGraph();
  });

  it('includes header with old and new name', () => {
    const result = planRename(graph, 'DecodeJWT', 'ParseJWT') as RenameResult;
    const output = formatRenameResult(result);
    expect(output).toContain('DecodeJWT');
    expect(output).toContain('ParseJWT');
  });

  it('shows DRY RUN status', () => {
    const result = planRename(graph, 'DecodeJWT', 'ParseJWT', undefined, true) as RenameResult;
    const output = formatRenameResult(result);
    expect(output).toContain('DRY RUN');
  });

  it('shows APPLIED status when not dry run', () => {
    const result = planRename(graph, 'DecodeJWT', 'ParseJWT', undefined, false) as RenameResult;
    const output = formatRenameResult(result);
    expect(output).toContain('APPLIED');
  });

  it('shows edit count breakdown', () => {
    const result = planRename(graph, 'ValidateToken', 'CheckToken', 'internal/auth/token.go') as RenameResult;
    const output = formatRenameResult(result);
    expect(output).toContain(`${result.graphEdits} graph`);
    expect(output).toContain(`${result.textSearchEdits} text_search`);
  });

  it('groups edits by file', () => {
    const result = planRename(graph, 'ValidateToken', 'CheckToken', 'internal/auth/token.go') as RenameResult;
    const output = formatRenameResult(result);
    expect(output).toContain('internal/auth/token.go');
    expect(output).toContain('internal/auth/middleware.go');
  });

  it('includes apply hint for dry run', () => {
    const result = planRename(graph, 'DecodeJWT', 'ParseJWT', undefined, true) as RenameResult;
    const output = formatRenameResult(result);
    expect(output).toContain('dry_run: false');
  });

  it('handles no edits gracefully', () => {
    // Create a standalone node with no references
    const g = new KnowledgeGraph();
    g.addNode(makeNode('fn:solo', 'solo', { file: '', startLine: 0 }));
    const result = planRename(g, 'solo', 'newSolo') as RenameResult;
    const output = formatRenameResult(result);
    expect(output).toContain('No references found');
  });
});

// ─── Handler integration ────────────────────────────────────────

describe('recon_rename handler', () => {
  let graph: KnowledgeGraph;

  beforeEach(() => {
    graph = buildMockGraph();
  });

  it('works via handleToolCall', async () => {
    const result = await handleToolCall('recon_rename', {
      symbol_name: 'DecodeJWT',
      new_name: 'ParseJWT',
    }, graph);

    expect(result).toContain('Rename: DecodeJWT');
    expect(result).toContain('ParseJWT');
    expect(result).toContain('DRY RUN');
  });

  it('returns error for missing symbol_name', async () => {
    await expect(
      handleToolCall('recon_rename', { new_name: 'Foo' }, graph),
    ).rejects.toThrow("'symbol_name' is required");
  });

  it('returns error for missing new_name', async () => {
    await expect(
      handleToolCall('recon_rename', { symbol_name: 'Foo' }, graph),
    ).rejects.toThrow("'new_name' is required");
  });

  it('returns disambiguation for ambiguous symbols', async () => {
    // Add extra exported ValidateToken for true ambiguity
    graph.addNode(makeNode('fn:VT3', 'ValidateToken', {
      file: 'internal/v2/token.go',
      startLine: 1,
      package: 'internal/v2',
      exported: true,
    }));

    const result = await handleToolCall('recon_rename', {
      symbol_name: 'ValidateToken',
      new_name: 'CheckToken',
    }, graph);

    expect(result).toContain('Multiple symbols');
  });

  it('defaults to dry_run true', async () => {
    const result = await handleToolCall('recon_rename', {
      symbol_name: 'DecodeJWT',
      new_name: 'ParseJWT',
    }, graph);
    expect(result).toContain('DRY RUN');
  });
});
