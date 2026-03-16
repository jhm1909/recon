/**
 * Hybrid Search — BM25 + Vector with Reciprocal Rank Fusion
 *
 * Combines keyword search (BM25) with semantic search (vector embeddings)
 * using RRF to merge rankings without score normalization.
 *
 * When embeddings are not available, falls back to pure BM25.
 */

import type { BM25Result } from './bm25.js';
import type { VectorSearchResult, VectorStore } from './vector-store.js';
import type { Node } from '../graph/types.js';
import type { KnowledgeGraph } from '../graph/graph.js';

// ─── RRF Constant ───────────────────────────────────────────────

/**
 * Standard RRF constant from the literature.
 * Higher values give more weight to lower-ranked results.
 */
const RRF_K = 60;

// ─── Types ──────────────────────────────────────────────────────

export interface HybridSearchResult {
  nodeId: string;
  score: number;          // Combined RRF score
  sources: ('bm25' | 'semantic')[];
  bm25Score?: number;     // Original BM25 score
  semanticScore?: number; // Original cosine similarity
}

// ─── RRF Merge ──────────────────────────────────────────────────

/**
 * Merge BM25 and vector search results using Reciprocal Rank Fusion.
 * Items found by both methods get boosted scores.
 */
export function mergeWithRRF(
  bm25Results: BM25Result[],
  semanticResults: VectorSearchResult[],
  limit: number = 20,
): HybridSearchResult[] {
  const merged = new Map<string, HybridSearchResult>();

  // Process BM25 results
  for (let i = 0; i < bm25Results.length; i++) {
    const r = bm25Results[i];
    const rrfScore = 1 / (RRF_K + i + 1);

    merged.set(r.nodeId, {
      nodeId: r.nodeId,
      score: rrfScore,
      sources: ['bm25'],
      bm25Score: r.score,
    });
  }

  // Process semantic results and merge
  for (let i = 0; i < semanticResults.length; i++) {
    const r = semanticResults[i];
    const rrfScore = 1 / (RRF_K + i + 1);

    const existing = merged.get(r.nodeId);
    if (existing) {
      // Found by both — sum RRF scores
      existing.score += rrfScore;
      existing.sources.push('semantic');
      existing.semanticScore = r.score;
    } else {
      merged.set(r.nodeId, {
        nodeId: r.nodeId,
        score: rrfScore,
        sources: ['semantic'],
        semanticScore: r.score,
      });
    }
  }

  // Sort by combined RRF score descending
  const sorted = Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return sorted;
}

// ─── Hybrid Search Pipeline ────────────────────────────────────

/**
 * Execute hybrid search: BM25 + vector (if available).
 * Falls back to BM25-only when no vector store is provided.
 */
export function hybridSearch(
  bm25Results: BM25Result[],
  vectorStore: VectorStore | null,
  queryEmbedding: Float32Array | null,
  limit: number = 20,
): HybridSearchResult[] {
  // If no vector store or query embedding, return BM25 as-is
  if (!vectorStore || !queryEmbedding || vectorStore.size === 0) {
    return bm25Results.slice(0, limit).map((r, i) => ({
      nodeId: r.nodeId,
      score: 1 / (RRF_K + i + 1),
      sources: ['bm25'] as ('bm25' | 'semantic')[],
      bm25Score: r.score,
    }));
  }

  // Get semantic results
  const semanticResults = vectorStore.search(queryEmbedding, limit * 2);

  // Merge with RRF
  return mergeWithRRF(bm25Results, semanticResults, limit);
}

/**
 * Format hybrid search results as markdown.
 */
export function formatHybridResults(
  results: HybridSearchResult[],
  graph: KnowledgeGraph,
): string {
  if (results.length === 0) return '_No results found._';

  const lines: string[] = [];

  for (const r of results) {
    const node = graph.getNode(r.nodeId);
    if (!node) continue;

    const sources = r.sources.join('+');
    lines.push(
      `- **${node.name}** (${node.type}) — \`${node.file}:${node.startLine}\` | ` +
      `${node.language} | [${sources}]`,
    );
  }

  return lines.join('\n');
}
