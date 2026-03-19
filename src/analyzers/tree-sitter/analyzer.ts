/**
 * Tree-sitter Analyzer
 *
 * Walks a directory for Python, Rust, Java, C, and C++ source files,
 * parses them with tree-sitter, and returns an AnalyzerResult.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Language } from '../../graph/types.js';
import type { AnalyzerResult } from '../types.js';
import { getLanguageForFile, isLanguageAvailable, getAvailableLanguages } from './parser.js';
import { extractFromFile, buildGraphFromExtractions } from './extractor.js';
import type { FileExtractionResult } from './extractor.js';
import { hashContent } from '../../utils/hash.js';

// ─── Ignore patterns ────────────────────────────────────────────

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.recon', '.reference', 'vendor', 'target',
  'build', 'dist', 'out', '.venv', 'venv', '__pycache__', '.mypy_cache',
  '.pytest_cache', '.cargo', 'bin', 'obj', '.gradle', '.idea',
]);

const MAX_FILE_SIZE = 1_000_000; // 1 MB

// ─── File Discovery ─────────────────────────────────────────────

interface SourceFile {
  absolutePath: string;
  relativePath: string;
  language: Language;
}

function findSourceFiles(rootDir: string): SourceFile[] {
  const files: SourceFile[] = [];

  function walk(dir: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        walk(join(dir, entry.name));
      } else if (entry.isFile()) {
        const absPath = join(dir, entry.name);
        const lang = getLanguageForFile(entry.name);
        if (!lang) continue;
        if (!isLanguageAvailable(lang)) continue;

        try {
          const stat = statSync(absPath);
          if (stat.size > MAX_FILE_SIZE) continue;
        } catch {
          continue;
        }

        files.push({
          absolutePath: absPath,
          relativePath: relative(rootDir, absPath).replace(/\\/g, '/'),
          language: lang,
        });
      }
    }
  }

  walk(rootDir);
  return files;
}

// ─── Main Analyzer ──────────────────────────────────────────────

export interface TreeSitterAnalysisResult {
  result: AnalyzerResult;
  stats: {
    files: number;
    symbols: number;
    calls: number;
    skipped: number;
    languages: Record<string, number>;
  };
  fileHashes: Record<string, string>;
}

/**
 * Analyze a codebase with tree-sitter for all supported languages.
 *
 * @param rootDir - Project root directory
 * @param previousHashes - Optional file hashes from previous index for incremental mode
 */
export function analyzeTreeSitter(
  rootDir: string,
  previousHashes?: Record<string, string>,
): TreeSitterAnalysisResult {
  const available = getAvailableLanguages();
  if (available.length === 0) {
    return {
      result: { nodes: [], relationships: [] },
      stats: { files: 0, symbols: 0, calls: 0, skipped: 0, languages: {} },
      fileHashes: {},
    };
  }

  const sourceFiles = findSourceFiles(rootDir);
  const fileHashes: Record<string, string> = {};
  const languageCounts: Record<string, number> = {};
  let skipped = 0;

  // Read files and filter unchanged ones (incremental)
  interface FileToProcess {
    relativePath: string;
    content: string;
    language: Language;
  }
  const filesToProcess: FileToProcess[] = [];

  for (const file of sourceFiles) {
    let content: string;
    try {
      content = readFileSync(file.absolutePath, 'utf-8');
    } catch {
      continue;
    }

    const hash = hashContent(content);
    fileHashes[file.relativePath] = hash;

    if (previousHashes && previousHashes[file.relativePath] === hash) {
      skipped++;
      continue;
    }

    filesToProcess.push({
      relativePath: file.relativePath,
      content,
      language: file.language,
    });
  }

  // Extract symbols — sequential (always works)
  const extractions = new Map<string, FileExtractionResult>();
  let totalCalls = 0;

  for (const file of filesToProcess) {
    const result = extractFromFile(file.relativePath, file.content, file.language);
    extractions.set(file.relativePath, result);
    totalCalls += result.calls.length;

    const langKey = file.language;
    languageCounts[langKey] = (languageCounts[langKey] || 0) + 1;
  }

  // Build graph from extractions
  const graphResult = buildGraphFromExtractions(extractions);

  return {
    result: graphResult,
    stats: {
      files: extractions.size,
      symbols: graphResult.nodes.length,
      calls: totalCalls,
      skipped,
      languages: languageCounts,
    },
    fileHashes,
  };
}

/**
 * Async version that uses worker pool for large codebases.
 * Falls back to sequential analyzeTreeSitter if pool fails.
 *
 * @param rootDir - Project root directory
 * @param previousHashes - Optional file hashes for incremental mode
 */
export async function analyzeTreeSitterParallel(
  rootDir: string,
  previousHashes?: Record<string, string>,
): Promise<TreeSitterAnalysisResult> {
  const available = getAvailableLanguages();
  if (available.length === 0) {
    return {
      result: { nodes: [], relationships: [] },
      stats: { files: 0, symbols: 0, calls: 0, skipped: 0, languages: {} },
      fileHashes: {},
    };
  }

  const sourceFiles = findSourceFiles(rootDir);
  const fileHashes: Record<string, string> = {};
  const languageCounts: Record<string, number> = {};
  let skipped = 0;

  // Read files and filter unchanged
  interface FileToProcess {
    relativePath: string;
    content: string;
    language: Language;
  }
  const filesToProcess: FileToProcess[] = [];

  for (const file of sourceFiles) {
    let content: string;
    try {
      content = readFileSync(file.absolutePath, 'utf-8');
    } catch {
      continue;
    }

    const hash = hashContent(content);
    fileHashes[file.relativePath] = hash;

    if (previousHashes && previousHashes[file.relativePath] === hash) {
      skipped++;
      continue;
    }

    filesToProcess.push({
      relativePath: file.relativePath,
      content,
      language: file.language,
    });
  }

  // Below threshold → use sequential path
  const { WORKER_THRESHOLD, TreeSitterPool } = await import('./pool.js');
  if (filesToProcess.length < WORKER_THRESHOLD) {
    return analyzeTreeSitter(rootDir, previousHashes);
  }

  // Try parallel parsing with worker pool
  const pool = new TreeSitterPool();
  const poolStarted = pool.spawn();

  if (!poolStarted) {
    console.error('[recon] Worker pool unavailable, using sequential parser.');
    pool.terminate();
    return analyzeTreeSitter(rootDir, previousHashes);
  }

  console.error(`[recon] Worker pool started: ${pool.poolSize} threads for ${filesToProcess.length} files`);
  const parseStart = performance.now();

  try {
    const tasks = filesToProcess.map(f => ({
      filePath: f.relativePath,
      content: f.content,
      language: f.language,
    }));

    const parseResults = await pool.parseFiles(tasks);

    const extractions = new Map<string, FileExtractionResult>();
    let totalCalls = 0;
    let errors = 0;

    for (const [filePath, pr] of parseResults) {
      if (pr.error) {
        errors++;
        continue;
      }
      extractions.set(filePath, pr.result);
      totalCalls += pr.result.calls.length;

      // Count languages
      const file = filesToProcess.find(f => f.relativePath === filePath);
      if (file) {
        languageCounts[file.language] = (languageCounts[file.language] || 0) + 1;
      }
    }

    const parseElapsed = Math.round(performance.now() - parseStart);
    console.error(`[recon] Worker pool: parsed ${extractions.size} files in ${parseElapsed}ms (${errors} errors)`);

    // Build graph from extractions
    const graphResult = buildGraphFromExtractions(extractions);

    return {
      result: graphResult,
      stats: {
        files: extractions.size,
        symbols: graphResult.nodes.length,
        calls: totalCalls,
        skipped,
        languages: languageCounts,
      },
      fileHashes,
    };
  } catch (err) {
    console.error(`[recon] Worker pool error: ${err}. Falling back to sequential.`);
    return analyzeTreeSitter(rootDir, previousHashes);
  } finally {
    pool.terminate();
  }
}

