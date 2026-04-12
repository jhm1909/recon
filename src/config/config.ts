/**
 * Recon Config
 *
 * Loads and validates `.recon.json` from project root.
 * Priority: CLI flags > .recon.json > defaults
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── Types ───────────────────────────────────────────────────────

export interface ReconConfig {
  /** Additional project directories to index + watch */
  projects?: string[];
  /** Enable vector embeddings for semantic search */
  embeddings?: boolean;
  /** Enable file watcher for live re-indexing */
  watch?: boolean;
  /** Debounce interval in ms for file watcher */
  watchDebounce?: number;
  /** Default to HTTP mode instead of MCP stdio */
  http?: boolean;
  /** HTTP server port */
  port?: number;
  /** Additional paths to ignore (beyond built-in defaults) */
  ignore?: string[];
  /** Cross-language edge detection config */
  crossLanguage?: {
    auto?: boolean;
    routes?: string[];
    consumers?: string[];
  };
  /** Glob patterns for test file detection */
  testPatterns?: string[];
  /** Analysis rules */
  rules?: {
    largeFileThreshold?: number;
    circularDepsLevel?: 'package' | 'file';
  };
}

// ─── Defaults ────────────────────────────────────────────────────

const DEFAULTS: Required<ReconConfig> = {
  projects: [],
  embeddings: false,
  watch: true,
  watchDebounce: 1500,
  http: false,
  port: 3100,
  ignore: [],
  crossLanguage: { auto: true, routes: [], consumers: [] },
  testPatterns: ['**/*.test.*', '**/*.spec.*', '**/*_test.*', '**/__tests__/**'],
  rules: { largeFileThreshold: 30, circularDepsLevel: 'package' as const },
};

const CONFIG_FILENAME = '.recon.json';

// ─── Loader ──────────────────────────────────────────────────────

/**
 * Load .recon.json from project root.
 * Returns defaults if file doesn't exist or is invalid.
 */
export function loadConfig(projectRoot: string): Required<ReconConfig> {
  const configPath = join(projectRoot, CONFIG_FILENAME);

  if (!existsSync(configPath)) {
    return { ...DEFAULTS };
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as ReconConfig;
    return { ...DEFAULTS, ...parsed };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[recon] Warning: invalid ${CONFIG_FILENAME}: ${msg}`);
    return { ...DEFAULTS };
  }
}

// ─── Merge CLI > Config ──────────────────────────────────────────

/**
 * Merge CLI options on top of config. CLI always wins.
 */
export function mergeWithCLI(
  config: Required<ReconConfig>,
  cli: {
    projects?: string[];
    embeddings?: boolean;
    http?: boolean;
    port?: number;
    noIndex?: boolean;
    noWatch?: boolean;
    force?: boolean;
    repo?: string;
  },
): Required<ReconConfig> {
  return {
    ...config,
    // CLI overrides (only if explicitly provided)
    ...(cli.projects !== undefined ? { projects: cli.projects } : {}),
    ...(cli.embeddings !== undefined ? { embeddings: cli.embeddings } : {}),
    ...(cli.http !== undefined ? { http: cli.http } : {}),
    ...(cli.port !== undefined ? { port: cli.port } : {}),
    // --no-index disables watcher too; --no-watch disables watcher only
    ...((cli.noIndex || cli.noWatch) ? { watch: false } : {}),
  };
}

// ─── Init ────────────────────────────────────────────────────────

const INIT_TEMPLATE: ReconConfig = {
  projects: [],
  embeddings: false,
  watch: true,
  ignore: [],
};

/**
 * Create a .recon.json with defaults.
 * Returns true if created, false if already exists.
 */
export function initConfig(projectRoot: string): boolean {
  const configPath = join(projectRoot, CONFIG_FILENAME);

  if (existsSync(configPath)) {
    return false;
  }

  writeFileSync(configPath, JSON.stringify(INIT_TEMPLATE, null, 2) + '\n', 'utf-8');
  return true;
}
