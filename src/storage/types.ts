/**
 * Storage Types
 *
 * Interfaces for index metadata and file hashing.
 */

export interface IndexStats {
  tsModules: number;
  tsSymbols: number;
  treeSitterFiles?: number;
  treeSitterSymbols?: number;
  relationships: number;
  indexTimeMs: number;
}

export interface IndexMeta {
  version: 1;
  indexedAt: string;        // ISO 8601
  gitCommit: string;        // HEAD commit hash
  gitBranch: string;        // Current branch
  stats: IndexStats;
  fileHashes: Record<string, string>; // relativePath → sha256 hex
  apiRoutes?: Array<{       // Go API route map (Phase 4)
    method: string;
    pattern: string;
    handler: string;
  }>;
}
