/**
 * In-Memory Vector Store
 *
 * Stores embeddings as Float32Arrays and supports cosine similarity search.
 * Serializable to JSON for persistence in .recon/embeddings.json.
 */

// ─── Types ──────────────────────────────────────────────────────

export interface VectorEntry {
  nodeId: string;
  embedding: Float32Array;
}

export interface VectorSearchResult {
  nodeId: string;
  score: number; // cosine similarity (0-1, higher is better)
}

export interface SerializedVectorStore {
  dimensions: number;
  entries: Array<{
    nodeId: string;
    embedding: number[];
  }>;
}

// ─── Cosine Similarity ─────────────────────────────────────────

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

// ─── VectorStore ────────────────────────────────────────────────

export class VectorStore {
  private entries: VectorEntry[] = [];
  readonly dimensions: number;

  constructor(dimensions: number) {
    this.dimensions = dimensions;
  }

  /**
   * Add a vector entry to the store.
   */
  add(nodeId: string, embedding: Float32Array): void {
    if (embedding.length !== this.dimensions) {
      throw new Error(
        `Embedding dimension mismatch: expected ${this.dimensions}, got ${embedding.length}`,
      );
    }
    this.entries.push({ nodeId, embedding });
  }

  /**
   * Search for the k nearest neighbors by cosine similarity.
   */
  search(query: Float32Array, k: number = 10): VectorSearchResult[] {
    if (query.length !== this.dimensions) {
      throw new Error(
        `Query dimension mismatch: expected ${this.dimensions}, got ${query.length}`,
      );
    }

    const scored: VectorSearchResult[] = [];

    for (const entry of this.entries) {
      const score = cosineSimilarity(query, entry.embedding);
      scored.push({ nodeId: entry.nodeId, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  /**
   * Check if a node already has an embedding.
   */
  has(nodeId: string): boolean {
    return this.entries.some(e => e.nodeId === nodeId);
  }

  get size(): number {
    return this.entries.length;
  }

  /**
   * Get all node IDs that have embeddings.
   */
  nodeIds(): Set<string> {
    return new Set(this.entries.map(e => e.nodeId));
  }

  /**
   * Serialize for JSON persistence.
   */
  serialize(): SerializedVectorStore {
    return {
      dimensions: this.dimensions,
      entries: this.entries.map(e => ({
        nodeId: e.nodeId,
        embedding: Array.from(e.embedding),
      })),
    };
  }

  /**
   * Deserialize from JSON.
   */
  static deserialize(data: SerializedVectorStore): VectorStore {
    const store = new VectorStore(data.dimensions);
    for (const entry of data.entries) {
      store.entries.push({
        nodeId: entry.nodeId,
        embedding: new Float32Array(entry.embedding),
      });
    }
    return store;
  }
}
