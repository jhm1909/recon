/**
 * Unit Tests: Process/Flow Detection
 *
 * Tests execution flow tracing from entry points through call chains.
 */
import { describe, it, expect } from 'vitest';
import { KnowledgeGraph } from '../../src/graph/graph.js';
import { NodeType, RelationshipType, Language } from '../../src/graph/types.js';
import type { Node, Relationship } from '../../src/graph/types.js';
import { detectProcesses, getProcess } from '../../src/graph/process.js';

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

// ─── Process Detection Tests ────────────────────────────────────

describe('process detection', () => {
  it('detects a simple linear call chain', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('h1', 'HandleRequest', {
      file: 'handler/api.go',
      type: NodeType.Function,
    }));
    g.addNode(makeNode('s1', 'ProcessData', {
      file: 'service/data.go',
      type: NodeType.Function,
    }));
    g.addNode(makeNode('d1', 'SaveToDB', {
      file: 'db/store.go',
      type: NodeType.Function,
    }));

    g.addRelationship(makeRel('h1', 's1'));
    g.addRelationship(makeRel('s1', 'd1'));

    const processes = detectProcesses(g);

    expect(processes.length).toBeGreaterThanOrEqual(1);
    const p = processes.find(p => p.name === 'HandleRequest');
    expect(p).toBeDefined();
    expect(p!.steps.length).toBe(2); // ProcessData + SaveToDB
    expect(p!.depth).toBe(2);
  });

  it('detects HTTP handler → service → DB pattern', () => {
    const g = new KnowledgeGraph();

    // HTTP handler entry point
    g.addNode(makeNode('handler', 'GetUser', {
      type: NodeType.Method,
      file: 'apps/api/handler/user.go',
      receiver: 'Handler',
      package: 'handler',
    }));

    // Service layer
    g.addNode(makeNode('service', 'FindUser', {
      type: NodeType.Function,
      file: 'internal/service/user.go',
      package: 'service',
    }));

    // DB layer
    g.addNode(makeNode('repo', 'QueryUser', {
      type: NodeType.Function,
      file: 'internal/repo/user.go',
      package: 'repo',
    }));

    g.addRelationship(makeRel('handler', 'service'));
    g.addRelationship(makeRel('service', 'repo'));

    const processes = detectProcesses(g);
    const p = processes.find(p => p.name === 'Handler.GetUser');
    expect(p).toBeDefined();
    expect(p!.entryPoint.name).toBe('GetUser');
    expect(p!.steps).toHaveLength(2);
    expect(p!.steps[0].name).toBe('FindUser');
    expect(p!.steps[0].depth).toBe(1);
    expect(p!.steps[1].name).toBe('QueryUser');
    expect(p!.steps[1].depth).toBe(2);
    expect(p!.depth).toBe(2);
  });

  it('handles fan-out (one function calls many)', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('entry', 'Init', {
      file: 'handler/init.go',
    }));

    for (let i = 0; i < 5; i++) {
      g.addNode(makeNode(`s${i}`, `Setup${i}`, {
        file: `service/setup${i}.go`,
      }));
      g.addRelationship(makeRel('entry', `s${i}`));
    }

    const processes = detectProcesses(g);
    const p = processes.find(p => p.name === 'Init');
    expect(p).toBeDefined();
    // maxBranching=4 limits branches, so at least 4 steps
    expect(p!.steps.length).toBeGreaterThanOrEqual(4);
    expect(p!.complexity).toBeGreaterThan(p!.steps.length); // Boosted by fan-out
  });

  it('avoids cycles', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('a', 'A', { file: 'handler/a.go' }));
    g.addNode(makeNode('b', 'B', { file: 'service/b.go' }));
    g.addNode(makeNode('c', 'C', { file: 'service/c.go' }));

    g.addRelationship(makeRel('a', 'b'));
    g.addRelationship(makeRel('b', 'c'));
    g.addRelationship(makeRel('c', 'a')); // Cycle back to A

    const processes = detectProcesses(g);
    // Should not infinite loop
    expect(processes.length).toBeGreaterThanOrEqual(1);

    const p = processes.find(p => p.name === 'A');
    if (p) {
      // Steps should not include 'A' again (cycle avoidance)
      expect(p.steps.every(s => s.name !== 'A')).toBe(true);
    }
  });

  it('returns empty for graph with no call edges', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('f1', 'Foo'));
    g.addNode(makeNode('f2', 'Bar'));

    const processes = detectProcesses(g);
    expect(processes).toHaveLength(0);
  });

  it('returns empty for empty graph', () => {
    const g = new KnowledgeGraph();
    const processes = detectProcesses(g);
    expect(processes).toHaveLength(0);
  });

  it('sorts by complexity descending', () => {
    const g = new KnowledgeGraph();

    // Simple flow: A -> B
    g.addNode(makeNode('a', 'SimpleHandler', { file: 'handler/simple.go' }));
    g.addNode(makeNode('b', 'SimpleService', { file: 'service/simple.go' }));
    g.addRelationship(makeRel('a', 'b'));

    // Complex flow: X -> Y1, Y2, Y3 -> Z
    g.addNode(makeNode('x', 'ComplexHandler', { file: 'handler/complex.go' }));
    g.addNode(makeNode('y1', 'Step1', { file: 'service/s1.go' }));
    g.addNode(makeNode('y2', 'Step2', { file: 'service/s2.go' }));
    g.addNode(makeNode('y3', 'Step3', { file: 'service/s3.go' }));
    g.addNode(makeNode('z', 'FinalStep', { file: 'db/store.go' }));
    g.addRelationship(makeRel('x', 'y1'));
    g.addRelationship(makeRel('x', 'y2'));
    g.addRelationship(makeRel('x', 'y3'));
    g.addRelationship(makeRel('y1', 'z'));

    const processes = detectProcesses(g);
    expect(processes.length).toBeGreaterThanOrEqual(2);

    const complexIdx = processes.findIndex(p => p.name === 'ComplexHandler');
    const simpleIdx = processes.findIndex(p => p.name === 'SimpleHandler');
    expect(complexIdx).toBeLessThan(simpleIdx); // Complex should be ranked first
  });

  it('respects limit parameter', () => {
    const g = new KnowledgeGraph();

    for (let i = 0; i < 10; i++) {
      g.addNode(makeNode(`entry${i}`, `Handler${i}`, {
        file: `handler/h${i}.go`,
      }));
      g.addNode(makeNode(`leaf${i}`, `Service${i}`, {
        file: `service/s${i}.go`,
      }));
      g.addRelationship(makeRel(`entry${i}`, `leaf${i}`));
    }

    const processes = detectProcesses(g, { limit: 3 });
    expect(processes.length).toBe(3);
  });

  it('applies name filter', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('h1', 'GetUser', { file: 'handler/user.go' }));
    g.addNode(makeNode('s1', 'UserService', { file: 'service/user.go' }));
    g.addRelationship(makeRel('h1', 's1'));

    g.addNode(makeNode('h2', 'GetOrder', { file: 'handler/order.go' }));
    g.addNode(makeNode('s2', 'OrderService', { file: 'service/order.go' }));
    g.addRelationship(makeRel('h2', 's2'));

    const processes = detectProcesses(g, { filter: 'User' });
    expect(processes.length).toBe(1);
    expect(processes[0].name).toBe('GetUser');
  });

  it('skips Package and File nodes', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('pkg', 'main', { type: NodeType.Package, file: '' }));
    g.addNode(makeNode('f', 'main.go', { type: NodeType.File }));
    g.addNode(makeNode('fn', 'Main', { file: 'handler/main.go' }));
    g.addNode(makeNode('s', 'Boot', { file: 'service/boot.go' }));
    g.addRelationship(makeRel('fn', 's'));

    const processes = detectProcesses(g);
    // Only fn -> s should create a process
    for (const p of processes) {
      expect(p.entryPoint.type).not.toBe('Package');
      expect(p.entryPoint.type).not.toBe('File');
      for (const step of p.steps) {
        expect(step.type).not.toBe('Package');
        expect(step.type).not.toBe('File');
      }
    }
  });

  it('includes cross-language CALLS_API edges', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('ts1', 'fetchUser', {
      type: NodeType.Function,
      file: 'src/api/user.ts',
      language: Language.TypeScript,
    }));
    g.addNode(makeNode('go1', 'GetUser', {
      type: NodeType.Method,
      file: 'handler/user.go',
      language: Language.Go,
    }));

    g.addRelationship(makeRel('ts1', 'go1', RelationshipType.CALLS_API));

    const processes = detectProcesses(g);
    const p = processes.find(p => p.name === 'fetchUser');
    expect(p).toBeDefined();
    expect(p!.steps[0].name).toBe('GetUser');
  });
});

// ─── getProcess Tests ──────────────────────────────────────────

describe('getProcess', () => {
  it('finds a process by exact name', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('h1', 'HandleLogin', { file: 'handler/auth.go' }));
    g.addNode(makeNode('s1', 'AuthService', { file: 'service/auth.go' }));
    g.addRelationship(makeRel('h1', 's1'));

    const p = getProcess(g, 'HandleLogin');
    expect(p).not.toBeNull();
    expect(p!.name).toBe('HandleLogin');
  });

  it('finds a process by case-insensitive name', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('h1', 'HandleLogin', { file: 'handler/auth.go' }));
    g.addNode(makeNode('s1', 'AuthService', { file: 'service/auth.go' }));
    g.addRelationship(makeRel('h1', 's1'));

    const p = getProcess(g, 'handlelogin');
    expect(p).not.toBeNull();
  });

  it('returns null for non-existent process', () => {
    const g = new KnowledgeGraph();
    const p = getProcess(g, 'DoesNotExist');
    expect(p).toBeNull();
  });

  it('finds method process with receiver prefix', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('h1', 'GetUser', {
      file: 'handler/user.go',
      type: NodeType.Method,
      receiver: 'Handler',
    }));
    g.addNode(makeNode('s1', 'FindUser', { file: 'service/user.go' }));
    g.addRelationship(makeRel('h1', 's1'));

    const p = getProcess(g, 'Handler.GetUser');
    expect(p).not.toBeNull();
    expect(p!.name).toBe('Handler.GetUser');
  });
});

// ─── Handler Integration Tests ──────────────────────────────────

describe('recon_explain shows execution flows', () => {
  it('includes execution flows for entry points', async () => {
    const { handleToolCall } = await import('../../src/mcp/handlers.js');

    const g = new KnowledgeGraph();
    g.addNode(makeNode('h1', 'HandleRequest', {
      file: 'handler/api.go',
    }));
    g.addNode(makeNode('s1', 'Process', {
      file: 'service/proc.go',
    }));
    g.addRelationship(makeRel('h1', 's1'));

    const result = await handleToolCall('recon_explain', { name: 'HandleRequest' }, g);
    expect(result).toContain('# Context: HandleRequest');
    expect(result).toContain('Execution Flows');
  });

  it('includes callees section', async () => {
    const { handleToolCall } = await import('../../src/mcp/handlers.js');

    const g = new KnowledgeGraph();
    g.addNode(makeNode('h1', 'GetUser', { file: 'handler/user.go' }));
    g.addNode(makeNode('s1', 'FindUser', { file: 'service/user.go' }));
    g.addRelationship(makeRel('h1', 's1'));

    const result = await handleToolCall('recon_explain', { name: 'GetUser' }, g);
    expect(result).toContain('FindUser');
    expect(result).toContain('Callees');
  });

  it('shows no execution flows for isolated nodes', async () => {
    const { handleToolCall } = await import('../../src/mcp/handlers.js');

    const g = new KnowledgeGraph();
    g.addNode(makeNode('f1', 'Isolated'));

    const result = await handleToolCall('recon_explain', { name: 'Isolated' }, g);
    expect(result).toContain('Execution Flows (0)');
  });
});

// ─── Resource Tests ──────────────────────────────────────────────

describe('recon://process/{name} resource (removed in v6)', () => {
  it('recon://process URI throws Unknown resource URI (resource removed)', async () => {
    const { parseUri } = await import('../../src/mcp/resources.js');
    expect(() => parseUri('recon://process/Handler.GetUser')).toThrow('Unknown resource URI');
  });
});
