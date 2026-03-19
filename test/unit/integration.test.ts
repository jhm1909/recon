/**
 * Integration Test: Index → Query → Verify
 *
 * Tests the full pipeline: create graph from real TypeScript code,
 * build BM25 index, search, and verify results.
 */
import { describe, it, expect } from 'vitest';
import { KnowledgeGraph } from '../../src/graph/graph.js';
import { NodeType, RelationshipType, Language } from '../../src/graph/types.js';
import type { Node, Relationship } from '../../src/graph/types.js';
import { BM25Index } from '../../src/search/bm25.js';
import { detectProcesses } from '../../src/graph/process.js';
import { exportGraph } from '../../src/export/exporter.js';
import { formatReview } from '../../src/review/reviewer.js';

// ─── Build a realistic mini-codebase graph ──────────────────────

function buildRealisticGraph(): KnowledgeGraph {
  const g = new KnowledgeGraph();

  // --- Package: auth ---
  g.addNode({
    id: 'ts:func:src/auth/validate.ts:validateToken',
    type: NodeType.Function, name: 'validateToken',
    file: 'src/auth/validate.ts', startLine: 1, endLine: 20,
    language: Language.TypeScript, package: 'auth', exported: true,
  });
  g.addNode({
    id: 'ts:func:src/auth/validate.ts:hashPassword',
    type: NodeType.Function, name: 'hashPassword',
    file: 'src/auth/validate.ts', startLine: 22, endLine: 35,
    language: Language.TypeScript, package: 'auth', exported: true,
  });
  g.addNode({
    id: 'ts:iface:src/auth/types.ts:AuthConfig',
    type: NodeType.Interface, name: 'AuthConfig',
    file: 'src/auth/types.ts', startLine: 1, endLine: 8,
    language: Language.TypeScript, package: 'auth', exported: true,
  });

  // --- Package: api ---
  g.addNode({
    id: 'ts:func:src/api/routes.ts:handleLogin',
    type: NodeType.Function, name: 'handleLogin',
    file: 'src/api/routes.ts', startLine: 1, endLine: 30,
    language: Language.TypeScript, package: 'api', exported: true,
  });
  g.addNode({
    id: 'ts:func:src/api/routes.ts:handleRegister',
    type: NodeType.Function, name: 'handleRegister',
    file: 'src/api/routes.ts', startLine: 32, endLine: 55,
    language: Language.TypeScript, package: 'api', exported: true,
  });
  g.addNode({
    id: 'ts:func:src/api/middleware.ts:authMiddleware',
    type: NodeType.Function, name: 'authMiddleware',
    file: 'src/api/middleware.ts', startLine: 1, endLine: 15,
    language: Language.TypeScript, package: 'api', exported: true,
  });

  // --- Package: db ---
  g.addNode({
    id: 'ts:func:src/db/users.ts:findUser',
    type: NodeType.Function, name: 'findUser',
    file: 'src/db/users.ts', startLine: 1, endLine: 12,
    language: Language.TypeScript, package: 'db', exported: true,
  });
  g.addNode({
    id: 'ts:func:src/db/users.ts:createUser',
    type: NodeType.Function, name: 'createUser',
    file: 'src/db/users.ts', startLine: 14, endLine: 28,
    language: Language.TypeScript, package: 'db', exported: true,
  });

  // --- Entry point ---
  g.addNode({
    id: 'ts:func:src/index.ts:main',
    type: NodeType.Function, name: 'main',
    file: 'src/index.ts', startLine: 1, endLine: 20,
    language: Language.TypeScript, package: 'root', exported: true,
  });

  // --- Relationships ---
  // handleLogin → validateToken, findUser
  g.addRelationship({ id: 'r1', type: RelationshipType.CALLS, sourceId: 'ts:func:src/api/routes.ts:handleLogin', targetId: 'ts:func:src/auth/validate.ts:validateToken', confidence: 1.0 });
  g.addRelationship({ id: 'r2', type: RelationshipType.CALLS, sourceId: 'ts:func:src/api/routes.ts:handleLogin', targetId: 'ts:func:src/db/users.ts:findUser', confidence: 1.0 });

  // handleRegister → hashPassword, createUser
  g.addRelationship({ id: 'r3', type: RelationshipType.CALLS, sourceId: 'ts:func:src/api/routes.ts:handleRegister', targetId: 'ts:func:src/auth/validate.ts:hashPassword', confidence: 1.0 });
  g.addRelationship({ id: 'r4', type: RelationshipType.CALLS, sourceId: 'ts:func:src/api/routes.ts:handleRegister', targetId: 'ts:func:src/db/users.ts:createUser', confidence: 1.0 });

  // authMiddleware → validateToken
  g.addRelationship({ id: 'r5', type: RelationshipType.CALLS, sourceId: 'ts:func:src/api/middleware.ts:authMiddleware', targetId: 'ts:func:src/auth/validate.ts:validateToken', confidence: 1.0 });

  // main → handleLogin, handleRegister
  g.addRelationship({ id: 'r6', type: RelationshipType.CALLS, sourceId: 'ts:func:src/index.ts:main', targetId: 'ts:func:src/api/routes.ts:handleLogin', confidence: 1.0 });
  g.addRelationship({ id: 'r7', type: RelationshipType.CALLS, sourceId: 'ts:func:src/index.ts:main', targetId: 'ts:func:src/api/routes.ts:handleRegister', confidence: 1.0 });

  return g;
}

// ─── Integration Tests ──────────────────────────────────────────

describe('Integration: Full Pipeline', () => {

  it('graph → BM25 → search finds correct symbols', () => {
    const graph = buildRealisticGraph();
    const index = BM25Index.buildFromGraph(graph);

    // Search for "validate"
    const results = index.search('validate', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].nodeId).toContain('validateToken');
  });

  it('graph → BM25 → search ranks exact name highest', () => {
    const graph = buildRealisticGraph();
    const index = BM25Index.buildFromGraph(graph);

    const results = index.search('handleLogin', 5);
    expect(results[0].nodeId).toContain('handleLogin');
  });

  it('graph → BM25 → search handles camelCase splitting', () => {
    const graph = buildRealisticGraph();
    const index = BM25Index.buildFromGraph(graph);

    // Search for just "password" should find hashPassword
    const results = index.search('password', 5);
    expect(results.some(r => r.nodeId.includes('hashPassword'))).toBe(true);
  });

  it('graph → context → callers and callees are correct', () => {
    const graph = buildRealisticGraph();
    const nodeId = 'ts:func:src/auth/validate.ts:validateToken';

    const callers = graph.getIncoming(nodeId);
    const callees = graph.getOutgoing(nodeId);

    // validateToken is called by handleLogin and authMiddleware
    expect(callers.length).toBe(2);
    expect(callers.map(r => r.sourceId).sort()).toEqual([
      'ts:func:src/api/middleware.ts:authMiddleware',
      'ts:func:src/api/routes.ts:handleLogin',
    ]);

    // validateToken doesn't call anything in this test graph
    expect(callees.length).toBe(0);
  });

  it('graph → blast radius → downstream impact', () => {
    const graph = buildRealisticGraph();

    // If we change validateToken, what's affected?
    const callers = graph.getIncoming('ts:func:src/auth/validate.ts:validateToken');
    expect(callers.length).toBe(2); // handleLogin, authMiddleware

    // Second-level: who calls handleLogin?
    const d2 = graph.getIncoming('ts:func:src/api/routes.ts:handleLogin');
    expect(d2.length).toBe(1); // main
    expect(d2[0].sourceId).toContain('main');
  });

  it('graph → process detection → finds entry points', () => {
    const graph = buildRealisticGraph();
    const processes = detectProcesses(graph);

    // main should be detected as an entry point
    expect(processes.some(p => p.name.includes('main'))).toBe(true);
  });

  it('graph → export → mermaid output valid', () => {
    const graph = buildRealisticGraph();
    const output = exportGraph(graph, { format: 'mermaid' });

    expect(output).toContain('graph TD');
    expect(output).toContain('validateToken');
    expect(output).toContain('handleLogin');
    expect(output).toContain('subgraph');
  });

  it('graph → export → dot output valid', () => {
    const graph = buildRealisticGraph();
    const output = exportGraph(graph, { format: 'dot' });

    expect(output).toContain('digraph recon');
    expect(output).toContain('validateToken');
    expect(output).toContain('->');
  });

  it('graph → review → no changes produces clean output', () => {
    const graph = buildRealisticGraph();
    const result = {
      scope: 'all', base: 'main',
      changedFiles: [], changedSymbols: [],
      directlyModified: [], affected: [],
      fileAnalyses: [],
      overallRisk: '🟢 LOW', riskScore: 0,
      affectedCommunities: new Set<string>(),
      brokenFlows: [],
    };
    const output = formatReview(result, graph);
    expect(output).toContain('No changes');
  });

  it('graph versioning increments on mutation', () => {
    const graph = buildRealisticGraph();
    const v1 = graph.version;

    graph.addNode({
      id: 'new:node', type: NodeType.Function, name: 'newFunc',
      file: 'src/new.ts', startLine: 1, endLine: 5,
      language: Language.TypeScript, package: 'test', exported: true,
    });

    expect(graph.version).toBeGreaterThan(v1);
  });

  it('graph → remove → BM25 rebuild reflects removal', () => {
    const graph = buildRealisticGraph();

    // Initial search
    let index = BM25Index.buildFromGraph(graph);
    expect(index.search('validateToken', 5).length).toBeGreaterThan(0);

    // Remove auth file
    graph.removeNodesByFile('src/auth/validate.ts');

    // Rebuild BM25
    index = BM25Index.buildFromGraph(graph);
    const results = index.search('validateToken', 5);
    expect(results.length).toBe(0); // Gone
  });

  it('full round trip: graph → index → serialize → deserialize → search', () => {
    const graph = buildRealisticGraph();
    const index = BM25Index.buildFromGraph(graph);

    // Serialize
    const serialized = index.serialize();
    const json = JSON.parse(JSON.stringify(serialized)); // simulate disk round-trip

    // Deserialize
    const restored = BM25Index.deserialize(json);

    // Search should work identically
    const original = index.search('handleLogin', 5);
    const fromDisk = restored.search('handleLogin', 5);

    expect(fromDisk.length).toBe(original.length);
    expect(fromDisk[0].nodeId).toBe(original[0].nodeId);
  });
});
