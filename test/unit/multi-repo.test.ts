/**
 * Unit Tests: Multi-Repo Support
 *
 * Tests multi-repo storage, filtering, and recon_list_repos tool.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { KnowledgeGraph } from '../../src/graph/graph.js';
import { NodeType, RelationshipType, Language } from '../../src/graph/types.js';
import type { Node, Relationship } from '../../src/graph/types.js';
import type { IndexMeta } from '../../src/storage/types.js';
import { saveIndex, loadIndex, listRepos, defaultRepoName } from '../../src/storage/store.js';
import { handleToolCall } from '../../src/mcp/handlers.js';

// ─── Helpers ─────────────────────────────────────────────────────

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

function makeMeta(overrides?: Partial<IndexMeta>): IndexMeta {
  return {
    version: 1,
    indexedAt: new Date().toISOString(),
    gitCommit: 'abc1234',
    gitBranch: 'main',
    stats: {
      goPackages: 2,
      goSymbols: 5,
      tsModules: 0,
      tsSymbols: 0,
      relationships: 1,
      indexTimeMs: 100,
    },
    fileHashes: {},
    ...overrides,
  };
}

function buildRepoGraph(repoName: string): KnowledgeGraph {
  const g = new KnowledgeGraph();

  g.addNode(makeNode(`${repoName}:func:main`, `${repoName}Main`, {
    file: `${repoName}/main.go`,
    package: `${repoName}/cmd`,
    repo: repoName,
  }));
  g.addNode(makeNode(`${repoName}:func:helper`, `${repoName}Helper`, {
    file: `${repoName}/util.go`,
    package: `${repoName}/util`,
    repo: repoName,
  }));

  g.addRelationship(makeRel(
    `${repoName}:func:main`,
    `${repoName}:func:helper`,
  ));

  return g;
}

// ─── Tests ───────────────────────────────────────────────────────

describe('multi-repo storage', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'recon-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('saves and loads repo-specific index', async () => {
    const graph = buildRepoGraph('backend');
    const meta = makeMeta();

    await saveIndex(tempDir, graph, meta, 'backend');

    const loaded = await loadIndex(tempDir, 'backend');
    expect(loaded).not.toBeNull();
    expect(loaded!.graph.nodeCount).toBe(2);
    expect(loaded!.graph.relationshipCount).toBe(1);
    expect(loaded!.meta.gitCommit).toBe('abc1234');
  });

  it('keeps legacy index separate from repo indices', async () => {
    const legacyGraph = buildRepoGraph('legacy');
    const repoGraph = buildRepoGraph('backend');

    await saveIndex(tempDir, legacyGraph, makeMeta());
    await saveIndex(tempDir, repoGraph, makeMeta(), 'backend');

    const legacy = await loadIndex(tempDir);
    const repo = await loadIndex(tempDir, 'backend');

    expect(legacy).not.toBeNull();
    expect(repo).not.toBeNull();
    expect(legacy!.graph.nodeCount).toBe(2);
    expect(repo!.graph.nodeCount).toBe(2);
  });

  it('returns null for non-existent repo', async () => {
    const result = await loadIndex(tempDir, 'nonexistent');
    expect(result).toBeNull();
  });

  it('lists all indexed repos', async () => {
    const graph1 = buildRepoGraph('frontend');
    const graph2 = buildRepoGraph('backend');

    await saveIndex(tempDir, graph1, makeMeta(), 'frontend');
    await saveIndex(tempDir, graph2, makeMeta(), 'backend');

    const repos = await listRepos(tempDir);
    const names = repos.map(r => r.name).sort();

    expect(names).toContain('backend');
    expect(names).toContain('frontend');
  });

  it('includes legacy index in listRepos', async () => {
    const graph = buildRepoGraph('legacy');
    await saveIndex(tempDir, graph, makeMeta());

    const repos = await listRepos(tempDir);
    expect(repos.length).toBeGreaterThanOrEqual(1);
    expect(repos[0].nodeCount).toBe(2);
  });

  it('defaultRepoName derives name from path', () => {
    expect(defaultRepoName('/home/user/myproject')).toBe('myproject');
    expect(defaultRepoName('C:\\Users\\dev\\cool-app')).toBe('cool-app');
  });
});

describe('multi-repo handler filtering', () => {
  let graph: KnowledgeGraph;

  beforeEach(() => {
    graph = new KnowledgeGraph();

    // Add nodes from two repos
    const backendNodes = buildRepoGraph('backend');
    const frontendNodes = buildRepoGraph('frontend');

    for (const node of backendNodes.nodes.values()) {
      graph.addNode(node);
    }
    for (const rel of backendNodes.relationships.values()) {
      graph.addRelationship(rel);
    }
    for (const node of frontendNodes.nodes.values()) {
      graph.addNode(node);
    }
    for (const rel of frontendNodes.relationships.values()) {
      graph.addRelationship(rel);
    }
  });

  it('recon_find returns all nodes without repo filter', async () => {
    const result = await handleToolCall('recon_find', { query: '*Main' }, graph);
    expect(result).toContain('backendMain');
    expect(result).toContain('frontendMain');
  });

  it('recon_explain works with specific node', async () => {
    const result = await handleToolCall('recon_explain', {
      name: 'backendMain',
    }, graph);
    expect(result).toContain('backendMain');
    expect(result).toContain('# Context:');
  });

  it('recon_impact finds upstream callers', async () => {
    const result = await handleToolCall('recon_impact', {
      target: 'backendHelper',
      direction: 'upstream',
    }, graph);
    expect(result).toContain('backendMain');
  });
});

describe('listRepos storage function', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'recon-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns empty list when no repos indexed', async () => {
    const repos = await listRepos(tempDir);
    expect(repos.length).toBe(0);
  });

  it('lists repos with stats', async () => {
    const graph = buildRepoGraph('myrepo');
    await saveIndex(tempDir, graph, makeMeta({
      gitBranch: 'develop',
      gitCommit: 'def5678',
    }), 'myrepo');

    const repos = await listRepos(tempDir);
    expect(repos.length).toBeGreaterThanOrEqual(1);
    const names = repos.map(r => r.name);
    expect(names).toContain('myrepo');
  });
});

describe('Node repo field', () => {
  it('nodes can have repo field set', () => {
    const node = makeNode('test:func:foo', 'foo', { repo: 'my-repo' });
    expect(node.repo).toBe('my-repo');
  });

  it('repo field is optional (backwards compat)', () => {
    const node = makeNode('test:func:bar', 'bar');
    expect(node.repo).toBeUndefined();
  });

  it('repo field survives serialization', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('test:func:foo', 'foo', { repo: 'my-repo' }));

    const serialized = g.serialize();
    const deserialized = KnowledgeGraph.deserialize(serialized);

    const node = deserialized.getNode('test:func:foo');
    expect(node?.repo).toBe('my-repo');
  });
});
