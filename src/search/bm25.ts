/**
 * BM25 Full-Text Search Index
 *
 * Standalone in-memory BM25 implementation for ranking graph nodes.
 * Tokenizes node names (camelCase/PascalCase/snake_case), file paths,
 * and package names. Supports serialization for persistence.
 */

import type { Node } from '../graph/types.js';
import { NodeType } from '../graph/types.js';
import type { KnowledgeGraph } from '../graph/graph.js';

// ─── BM25 Parameters ────────────────────────────────────────────

const K1 = 1.5;   // Term frequency saturation
const B = 0.75;    // Length normalization

// ─── Tokenizer ──────────────────────────────────────────────────

/**
 * Split a symbol name into tokens.
 * Handles camelCase, PascalCase, snake_case, and dot notation.
 *
 *   "getUserById"    → ["get", "user", "by", "id"]
 *   "Handler.GetGuild" → ["handler", "get", "guild"]
 *   "validate_token" → ["validate", "token"]
 */
export function tokenize(text: string): string[] {
  if (!text) return [];

  // Split on non-alphanumeric, then split camelCase
  const parts = text
    .replace(/([a-z])([A-Z])/g, '$1 $2')  // camelCase boundary
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')  // ACRONYMWord boundary
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')  // letter→digit boundary
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')  // digit→letter boundary
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);

  return parts.map(p => p.toLowerCase());
}

/**
 * Build a document string from a graph node for indexing.
 * Combines name, file path, and package — weighted by repetition.
 * Name tokens appear 3x to boost name relevance.
 */
function nodeToTokens(node: Node): string[] {
  const nameTokens = tokenize(node.name);
  const fileTokens = tokenize(node.file);
  const pkgTokens = tokenize(node.package);

  // Name tokens weighted 3x by repetition
  return [
    ...nameTokens, ...nameTokens, ...nameTokens,
    ...fileTokens,
    ...pkgTokens,
  ];
}

// ─── BM25 Index ─────────────────────────────────────────────────

interface DocEntry {
  nodeId: string;
  tokens: string[];
  tf: Map<string, number>;  // term → frequency in this doc
}

export interface SerializedBM25 {
  docs: Array<{
    nodeId: string;
    tokens: string[];
  }>;
}

export interface BM25Result {
  nodeId: string;
  score: number;
}

export class BM25Index {
  private docs: DocEntry[] = [];
  private df = new Map<string, number>();  // term → number of docs containing it
  private avgdl = 0;

  /**
   * Build a BM25 index from all nodes in a KnowledgeGraph.
   * Skips File nodes (not useful for symbol search).
   */
  static buildFromGraph(graph: KnowledgeGraph): BM25Index {
    const index = new BM25Index();
    const entries: DocEntry[] = [];

    for (const node of graph.nodes.values()) {
      if (node.type === NodeType.File) continue;

      const tokens = nodeToTokens(node);
      const tf = new Map<string, number>();
      for (const t of tokens) {
        tf.set(t, (tf.get(t) || 0) + 1);
      }

      entries.push({ nodeId: node.id, tokens, tf });
    }

    index.docs = entries;
    index._buildStats();
    return index;
  }

  private _buildStats(): void {
    this.df.clear();
    let totalLen = 0;

    for (const doc of this.docs) {
      totalLen += doc.tokens.length;
      // Count each unique term once per document
      const seen = new Set<string>();
      for (const t of doc.tokens) {
        if (!seen.has(t)) {
          seen.add(t);
          this.df.set(t, (this.df.get(t) || 0) + 1);
        }
      }
    }

    this.avgdl = this.docs.length > 0 ? totalLen / this.docs.length : 0;
  }

  /**
   * Search the index with a query string. Returns node IDs ranked by BM25 score.
   */
  search(query: string, limit: number = 20): BM25Result[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const N = this.docs.length;
    const results: BM25Result[] = [];

    for (const doc of this.docs) {
      let score = 0;
      const dl = doc.tokens.length;

      for (const qt of queryTokens) {
        const f = doc.tf.get(qt) || 0;
        if (f === 0) continue;

        const n = this.df.get(qt) || 0;
        // IDF with smoothing (BM25 variant that avoids negative IDF)
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        // TF saturation with length normalization
        const tfNorm = (f * (K1 + 1)) / (f + K1 * (1 - B + B * dl / this.avgdl));
        score += idf * tfNorm;
      }

      if (score > 0) {
        results.push({ nodeId: doc.nodeId, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  get documentCount(): number {
    return this.docs.length;
  }

  /**
   * Serialize the index for persistence.
   */
  serialize(): SerializedBM25 {
    return {
      docs: this.docs.map(d => ({
        nodeId: d.nodeId,
        tokens: d.tokens,
      })),
    };
  }

  /**
   * Deserialize a previously saved index.
   */
  static deserialize(data: SerializedBM25): BM25Index {
    const index = new BM25Index();

    index.docs = data.docs.map(d => {
      const tf = new Map<string, number>();
      for (const t of d.tokens) {
        tf.set(t, (tf.get(t) || 0) + 1);
      }
      return { nodeId: d.nodeId, tokens: d.tokens, tf };
    });

    index._buildStats();
    return index;
  }
}
