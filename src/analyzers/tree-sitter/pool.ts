/**
 * Worker Pool for Parallel Tree-sitter Parsing
 *
 * Manages a pool of worker_threads that each run their own
 * tree-sitter Parser. Files are distributed round-robin and
 * results are collected via Promise.
 *
 * Usage:
 *   const pool = new TreeSitterPool(4);
 *   const results = await pool.parseFiles(files);
 *   pool.terminate();
 */

import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Language } from '../../graph/types.js';
import type { FileExtractionResult } from './extractor.js';

// ─── Types ──────────────────────────────────────────────────────

export interface ParseTask {
  filePath: string;
  content: string;
  language: Language;
}

export interface ParseResult {
  filePath: string;
  result: FileExtractionResult;
  error?: string;
}

// ─── Pool Config ────────────────────────────────────────────────

/** Minimum files before enabling workers (below this, sequential is faster) */
export const WORKER_THRESHOLD = 100;

/** Default pool size = CPU cores, capped at 8 */
export const DEFAULT_POOL_SIZE = Math.min(cpus().length, 8);

// ─── WorkerPool ─────────────────────────────────────────────────

export class TreeSitterPool {
  private workers: Worker[] = [];
  private size: number;
  private workerPath: string;
  private alive = false;

  constructor(size?: number) {
    this.size = size ?? DEFAULT_POOL_SIZE;

    // Resolve worker path relative to this file's compiled location
    const thisDir = dirname(fileURLToPath(import.meta.url));
    this.workerPath = join(thisDir, 'worker.js');
  }

  /**
   * Spawn worker threads.
   * Returns false if workers can't be created (fallback to sequential).
   */
  spawn(): boolean {
    try {
      for (let i = 0; i < this.size; i++) {
        const w = new Worker(this.workerPath);
        this.workers.push(w);
      }
      this.alive = true;
      return true;
    } catch (err) {
      // Clean up any workers that were created
      this.terminate();
      console.error(`[recon] Worker pool failed to start: ${err}`);
      return false;
    }
  }

  /**
   * Parse files in parallel using the worker pool.
   *
   * Distributes tasks round-robin across workers.
   * Returns a Map<filePath, FileExtractionResult>.
   */
  async parseFiles(tasks: ParseTask[]): Promise<Map<string, ParseResult>> {
    if (!this.alive || this.workers.length === 0) {
      throw new Error('Worker pool not started. Call spawn() first.');
    }

    const results = new Map<string, ParseResult>();
    let nextId = 0;

    // Create a promise for each task
    const promises = tasks.map((task) => {
      const id = nextId++;
      const workerIdx = id % this.workers.length;
      const worker = this.workers[workerIdx];

      return new Promise<void>((resolve) => {
        const handler = (msg: { id: number; result?: FileExtractionResult; error?: string }) => {
          if (msg.id !== id) return; // Not our response
          worker.off('message', handler);

          if (msg.error) {
            results.set(task.filePath, {
              filePath: task.filePath,
              result: { symbols: [], calls: [], imports: [], heritage: [] },
              error: msg.error,
            });
          } else {
            results.set(task.filePath, {
              filePath: task.filePath,
              result: msg.result!,
            });
          }
          resolve();
        };

        worker.on('message', handler);
        worker.postMessage({
          id,
          filePath: task.filePath,
          content: task.content,
          language: task.language,
        });
      });
    });

    await Promise.all(promises);
    return results;
  }

  /**
   * Terminate all workers.
   */
  terminate(): void {
    for (const w of this.workers) {
      try { w.terminate(); } catch { /* ignore */ }
    }
    this.workers = [];
    this.alive = false;
  }

  /** Number of active workers */
  get poolSize(): number {
    return this.workers.length;
  }
}
