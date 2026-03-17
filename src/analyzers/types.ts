/**
 * Analyzer Types
 *
 * Shared interfaces for analyzers.
 */

import type { Node, Relationship } from '../graph/types.js';

// ─── Analyzer Result ────────────────────────────────────────────

export interface AnalyzerResult {
  nodes: Node[];
  relationships: Relationship[];
}
