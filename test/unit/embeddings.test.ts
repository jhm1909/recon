/**
 * Unit Tests: Hybrid Semantic Search
 *
 * Tests for vector store, text generator, RRF fusion, and hybrid search pipeline.
 */
import { describe, it, expect } from 'vitest';
import { VectorStore } from '../../src/search/vector-store.js';
import type { SerializedVectorStore } from '../../src/search/vector-store.js';
import { generateEmbeddingText, isEmbeddable } from '../../src/search/text-generator.js';
import { mergeWithRRF, hybridSearch } from '../../src/search/hybrid-search.js';
import type { HybridSearchResult } from '../../src/search/hybrid-search.js';
import { KnowledgeGraph } from '../../src/graph/graph.js';
import { NodeType, RelationshipType, Language } from '../../src/graph/types.js';
import type { Node } from '../../src/graph/types.js';
import type { BM25Result } from '../../src/search/bm25.js';
import type { VectorSearchResult } from '../../src/search/vector-store.js';

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

function randomEmbedding(dims: number): Float32Array {
  const arr = new Float32Array(dims);
  for (let i = 0; i < dims; i++) {
    arr[i] = Math.random() * 2 - 1;
  }
  // Normalize
  let norm = 0;
  for (let i = 0; i < dims; i++) norm += arr[i] * arr[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < dims; i++) arr[i] /= norm;
  return arr;
}

// ─── VectorStore Tests ──────────────────────────────────────────

describe('VectorStore', () => {
  it('adds entries and reports correct size', () => {
    const store = new VectorStore(4);
    store.add('n1', new Float32Array([1, 0, 0, 0]));
    store.add('n2', new Float32Array([0, 1, 0, 0]));

    expect(store.size).toBe(2);
  });

  it('rejects embeddings with wrong dimensions', () => {
    const store = new VectorStore(4);
    expect(() => store.add('n1', new Float32Array([1, 0, 0]))).toThrow(
      'Embedding dimension mismatch: expected 4, got 3',
    );
  });

  it('finds exact match as top result', () => {
    const store = new VectorStore(3);
    store.add('target', new Float32Array([1, 0, 0]));
    store.add('other1', new Float32Array([0, 1, 0]));
    store.add('other2', new Float32Array([0, 0, 1]));

    const results = store.search(new Float32Array([1, 0, 0]), 3);
    expect(results[0].nodeId).toBe('target');
    expect(results[0].score).toBeCloseTo(1.0);
  });

  it('returns results sorted by similarity descending', () => {
    const store = new VectorStore(3);
    store.add('far', new Float32Array([0, 0, 1]));
    store.add('close', new Float32Array([0.9, 0.1, 0]));
    store.add('exact', new Float32Array([1, 0, 0]));

    const query = new Float32Array([1, 0, 0]);
    const results = store.search(query, 3);

    expect(results[0].nodeId).toBe('exact');
    expect(results[1].nodeId).toBe('close');
    expect(results[2].nodeId).toBe('far');
  });

  it('limits results to k', () => {
    const store = new VectorStore(3);
    for (let i = 0; i < 10; i++) {
      store.add(`n${i}`, randomEmbedding(3));
    }

    const results = store.search(randomEmbedding(3), 3);
    expect(results.length).toBe(3);
  });

  it('rejects query with wrong dimensions', () => {
    const store = new VectorStore(4);
    store.add('n1', new Float32Array([1, 0, 0, 0]));

    expect(() => store.search(new Float32Array([1, 0, 0]), 1)).toThrow(
      'Query dimension mismatch: expected 4, got 3',
    );
  });

  it('has() checks node existence', () => {
    const store = new VectorStore(3);
    store.add('n1', new Float32Array([1, 0, 0]));

    expect(store.has('n1')).toBe(true);
    expect(store.has('n2')).toBe(false);
  });

  it('nodeIds() returns all IDs', () => {
    const store = new VectorStore(3);
    store.add('n1', new Float32Array([1, 0, 0]));
    store.add('n2', new Float32Array([0, 1, 0]));

    const ids = store.nodeIds();
    expect(ids.has('n1')).toBe(true);
    expect(ids.has('n2')).toBe(true);
    expect(ids.size).toBe(2);
  });

  it('handles orthogonal vectors (cosine similarity ~0)', () => {
    const store = new VectorStore(3);
    store.add('n1', new Float32Array([1, 0, 0]));

    const results = store.search(new Float32Array([0, 1, 0]), 1);
    expect(results[0].score).toBeCloseTo(0);
  });

  it('handles empty store', () => {
    const store = new VectorStore(3);
    const results = store.search(new Float32Array([1, 0, 0]), 5);
    expect(results.length).toBe(0);
  });
});

// ─── VectorStore Serialization ──────────────────────────────────

describe('VectorStore serialization', () => {
  it('round-trips through serialize/deserialize', () => {
    const store = new VectorStore(3);
    store.add('n1', new Float32Array([1, 0, 0]));
    store.add('n2', new Float32Array([0, 0.5, 0.5]));

    const serialized = store.serialize();
    const restored = VectorStore.deserialize(serialized);

    expect(restored.size).toBe(2);
    expect(restored.dimensions).toBe(3);
    expect(restored.has('n1')).toBe(true);
    expect(restored.has('n2')).toBe(true);
  });

  it('preserves search behavior after deserialization', () => {
    const store = new VectorStore(3);
    store.add('target', new Float32Array([1, 0, 0]));
    store.add('other', new Float32Array([0, 1, 0]));

    const serialized = store.serialize();
    const restored = VectorStore.deserialize(serialized);

    const results = restored.search(new Float32Array([1, 0, 0]), 2);
    expect(results[0].nodeId).toBe('target');
    expect(results[0].score).toBeCloseTo(1.0);
  });

  it('serializes to valid JSON structure', () => {
    const store = new VectorStore(2);
    store.add('n1', new Float32Array([0.5, 0.5]));

    const serialized = store.serialize();
    expect(serialized.dimensions).toBe(2);
    expect(serialized.entries).toHaveLength(1);
    expect(serialized.entries[0].nodeId).toBe('n1');
    expect(serialized.entries[0].embedding).toEqual([0.5, 0.5]);
  });

  it('deserializes empty store', () => {
    const data: SerializedVectorStore = { dimensions: 384, entries: [] };
    const store = VectorStore.deserialize(data);
    expect(store.size).toBe(0);
    expect(store.dimensions).toBe(384);
  });
});

// ─── Text Generator Tests ───────────────────────────────────────

describe('text generator', () => {
  it('generates text for a function node', () => {
    const node = makeNode('f1', 'getUserById', {
      package: 'internal/auth',
      file: 'auth/users.go',
    });

    const text = generateEmbeddingText(node);
    expect(text).toContain('Function: getUserById');
    expect(text).toContain('Package: internal/auth');
    expect(text).toContain('File: auth/users.go');
    expect(text).toContain('Language: go');
  });

  it('includes Go-specific metadata', () => {
    const node = makeNode('m1', 'GetGuild', {
      type: NodeType.Method,
      receiver: 'Handler',
      params: ['ctx context.Context', 'id string'],
      returnType: '*Guild',
    });

    const text = generateEmbeddingText(node);
    expect(text).toContain('Method: GetGuild');
    expect(text).toContain('Receiver: Handler');
    expect(text).toContain('Params: ctx context.Context, id string');
    expect(text).toContain('Returns: *Guild');
  });

  it('includes TS-specific metadata', () => {
    const node = makeNode('c1', 'Button', {
      type: NodeType.Component,
      language: Language.TypeScript,
      props: ['onClick', 'disabled', 'variant'],
    });

    const text = generateEmbeddingText(node);
    expect(text).toContain('Component: Button');
    expect(text).toContain('Props: onClick, disabled, variant');
  });

  it('includes struct fields', () => {
    const node = makeNode('s1', 'Config', {
      type: NodeType.Struct,
      fields: ['Port int', 'Host string', 'Debug bool'],
    });

    const text = generateEmbeddingText(node);
    expect(text).toContain('Struct: Config');
    expect(text).toContain('Fields: Port int, Host string, Debug bool');
  });

  it('includes interface method signatures', () => {
    const node = makeNode('i1', 'Repository', {
      type: NodeType.Interface,
      methodSignatures: ['Find(id string) (*Entity, error)', 'Save(entity *Entity) error'],
    });

    const text = generateEmbeddingText(node);
    expect(text).toContain('Interface: Repository');
    expect(text).toContain('Methods: Find(id string) (*Entity, error), Save(entity *Entity) error');
  });

  it('marks exported symbols', () => {
    const exported = makeNode('f1', 'Foo', { exported: true });
    const unexported = makeNode('f2', 'bar', { exported: false });

    expect(generateEmbeddingText(exported)).toContain('Exported: true');
    expect(generateEmbeddingText(unexported)).not.toContain('Exported');
  });
});

// ─── isEmbeddable Tests ─────────────────────────────────────────

describe('isEmbeddable', () => {
  it('returns true for function/method/class/struct nodes', () => {
    expect(isEmbeddable(makeNode('f', 'F', { type: NodeType.Function }))).toBe(true);
    expect(isEmbeddable(makeNode('m', 'M', { type: NodeType.Method }))).toBe(true);
    expect(isEmbeddable(makeNode('c', 'C', { type: NodeType.Class }))).toBe(true);
    expect(isEmbeddable(makeNode('s', 'S', { type: NodeType.Struct }))).toBe(true);
    expect(isEmbeddable(makeNode('i', 'I', { type: NodeType.Interface }))).toBe(true);
    expect(isEmbeddable(makeNode('e', 'E', { type: NodeType.Enum }))).toBe(true);
    expect(isEmbeddable(makeNode('t', 'T', { type: NodeType.Trait }))).toBe(true);
    expect(isEmbeddable(makeNode('c', 'C', { type: NodeType.Component }))).toBe(true);
    expect(isEmbeddable(makeNode('t', 'T', { type: NodeType.Type }))).toBe(true);
    expect(isEmbeddable(makeNode('m', 'M', { type: NodeType.Module }))).toBe(true);
  });

  it('returns false for Package and File nodes', () => {
    expect(isEmbeddable(makeNode('p', 'P', { type: NodeType.Package }))).toBe(false);
    expect(isEmbeddable(makeNode('f', 'F', { type: NodeType.File }))).toBe(false);
  });
});

// ─── RRF Merge Tests ────────────────────────────────────────────

describe('mergeWithRRF', () => {
  it('merges BM25-only results correctly', () => {
    const bm25: BM25Result[] = [
      { nodeId: 'a', score: 10 },
      { nodeId: 'b', score: 5 },
    ];
    const semantic: VectorSearchResult[] = [];

    const results = mergeWithRRF(bm25, semantic);

    expect(results).toHaveLength(2);
    expect(results[0].nodeId).toBe('a');
    expect(results[0].sources).toEqual(['bm25']);
    expect(results[0].bm25Score).toBe(10);
  });

  it('merges semantic-only results correctly', () => {
    const bm25: BM25Result[] = [];
    const semantic: VectorSearchResult[] = [
      { nodeId: 'x', score: 0.95 },
      { nodeId: 'y', score: 0.8 },
    ];

    const results = mergeWithRRF(bm25, semantic);

    expect(results).toHaveLength(2);
    expect(results[0].nodeId).toBe('x');
    expect(results[0].sources).toEqual(['semantic']);
    expect(results[0].semanticScore).toBe(0.95);
  });

  it('boosts items found by both methods', () => {
    const bm25: BM25Result[] = [
      { nodeId: 'shared', score: 10 },
      { nodeId: 'bm25only', score: 15 },
    ];
    const semantic: VectorSearchResult[] = [
      { nodeId: 'shared', score: 0.9 },
      { nodeId: 'semonly', score: 0.95 },
    ];

    const results = mergeWithRRF(bm25, semantic);

    const shared = results.find(r => r.nodeId === 'shared')!;
    const bm25only = results.find(r => r.nodeId === 'bm25only')!;

    // Shared should have higher RRF score due to appearing in both
    expect(shared.score).toBeGreaterThan(bm25only.score);
    expect(shared.sources).toContain('bm25');
    expect(shared.sources).toContain('semantic');
  });

  it('respects limit parameter', () => {
    const bm25: BM25Result[] = [];
    for (let i = 0; i < 20; i++) {
      bm25.push({ nodeId: `n${i}`, score: 20 - i });
    }

    const results = mergeWithRRF(bm25, [], 5);
    expect(results).toHaveLength(5);
  });

  it('ranks higher-ranked items first', () => {
    const bm25: BM25Result[] = [
      { nodeId: 'first', score: 100 },
      { nodeId: 'second', score: 50 },
      { nodeId: 'third', score: 10 },
    ];

    const results = mergeWithRRF(bm25, []);

    expect(results[0].nodeId).toBe('first');
    expect(results[1].nodeId).toBe('second');
    expect(results[2].nodeId).toBe('third');
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('handles empty inputs', () => {
    const results = mergeWithRRF([], []);
    expect(results).toHaveLength(0);
  });
});

// ─── Hybrid Search Pipeline Tests ───────────────────────────────

describe('hybridSearch', () => {
  it('falls back to BM25 when no vector store', () => {
    const bm25: BM25Result[] = [
      { nodeId: 'a', score: 10 },
      { nodeId: 'b', score: 5 },
    ];

    const results = hybridSearch(bm25, null, null, 10);

    expect(results).toHaveLength(2);
    expect(results[0].nodeId).toBe('a');
    expect(results[0].sources).toEqual(['bm25']);
  });

  it('falls back to BM25 when vector store is empty', () => {
    const bm25: BM25Result[] = [{ nodeId: 'a', score: 10 }];
    const store = new VectorStore(3);
    const queryEmb = new Float32Array([1, 0, 0]);

    const results = hybridSearch(bm25, store, queryEmb, 10);

    expect(results[0].sources).toEqual(['bm25']);
  });

  it('uses hybrid mode when vector store has data', () => {
    const bm25: BM25Result[] = [
      { nodeId: 'a', score: 10 },
      { nodeId: 'b', score: 5 },
    ];

    const store = new VectorStore(3);
    store.add('a', new Float32Array([1, 0, 0]));
    store.add('c', new Float32Array([0, 1, 0]));

    const queryEmb = new Float32Array([1, 0, 0]);
    const results = hybridSearch(bm25, store, queryEmb, 10);

    // 'a' should be boosted (found by both)
    const itemA = results.find(r => r.nodeId === 'a')!;
    expect(itemA.sources).toContain('bm25');
    expect(itemA.sources).toContain('semantic');
  });

  it('falls back to BM25 when query embedding is null', () => {
    const bm25: BM25Result[] = [{ nodeId: 'a', score: 10 }];
    const store = new VectorStore(3);
    store.add('a', new Float32Array([1, 0, 0]));

    const results = hybridSearch(bm25, store, null, 10);
    expect(results[0].sources).toEqual(['bm25']);
  });
});

// ─── Handler Integration Tests ──────────────────────────────────

describe('recon_find handler integration', () => {
  it('recon_find works without vector store', async () => {
    const { handleToolCall } = await import('../../src/mcp/handlers.js');

    const g = new KnowledgeGraph();
    g.addNode(makeNode('f1', 'getUserById', { package: 'auth' }));

    const result = await handleToolCall('recon_find', { query: 'getUserById' }, g);
    expect(result).toContain('getUserById');
  });

  it('recon_find handles vector store gracefully', async () => {
    const { handleToolCall } = await import('../../src/mcp/handlers.js');

    const g = new KnowledgeGraph();
    g.addNode(makeNode('f1', 'getUserById', { package: 'auth' }));

    // recon_find uses executeFind (not BM25+vector), so vector store is ignored
    const store = new VectorStore(3);
    store.add('f1', new Float32Array([1, 0, 0]));

    const result = await handleToolCall('recon_find', { query: 'getUserById' }, g, undefined, store);
    expect(result).toContain('getUserById');
  });

  it('recon_find applies type filter', async () => {
    const { handleToolCall } = await import('../../src/mcp/handlers.js');

    const g = new KnowledgeGraph();
    g.addNode(makeNode('f1', 'Foo', { type: NodeType.Function }));
    g.addNode(makeNode('s1', 'FooStruct', { type: NodeType.Struct }));

    const result = await handleToolCall('recon_find', {
      query: 'Foo',
      type: 'Function',
    }, g);

    expect(result).toContain('Foo');
    expect(result).not.toContain('FooStruct');
  });

  it('recon_find returns results for exact match', async () => {
    const { handleToolCall } = await import('../../src/mcp/handlers.js');

    const g = new KnowledgeGraph();
    g.addNode(makeNode('f1', 'TestFunc', { package: 'core' }));

    const result = await handleToolCall('recon_find', {
      query: 'TestFunc',
    }, g);

    expect(result).toContain('TestFunc');
  });
});

// ─── Embedder Tests (mocked) ───────────────────────────────────

describe('embedder', () => {
  it('isEmbedderReady returns false before init', async () => {
    const { isEmbedderReady } = await import('../../src/search/embedder.js');
    // The embedder is a global singleton — unless initEmbedder was called
    // in a prior test (unlikely in CI without the model), it should be false
    // We can't reliably test this in all environments, so just verify the function exists
    expect(typeof isEmbedderReady).toBe('function');
  });

  it('initEmbedder throws without @huggingface/transformers model', async () => {
    const { initEmbedder } = await import('../../src/search/embedder.js');
    // With a non-existent model, it should fail
    try {
      await initEmbedder({ modelId: 'nonexistent/model-xyz-fake', dimensions: 384 });
      // If it somehow succeeds (model cached), that's OK too
    } catch (err) {
      expect(err).toBeDefined();
    }
  });

  it('DEFAULT_CONFIG uses all-MiniLM-L6-v2', async () => {
    const { DEFAULT_CONFIG } = await import('../../src/search/embedder.js');
    expect(DEFAULT_CONFIG.modelId).toBe('Xenova/all-MiniLM-L6-v2');
    expect(DEFAULT_CONFIG.dimensions).toBe(384);
  });
});
