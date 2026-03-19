/**
 * Tree-sitter Worker Thread
 *
 * Runs in a separate thread to parse files with tree-sitter.
 * Each worker has its own Parser instance and lazily loads grammars.
 *
 * Protocol:
 *   Main → Worker: { id, filePath, content, language }
 *   Worker → Main: { id, result: FileExtractionResult } | { id, error: string }
 */

import { parentPort } from 'node:worker_threads';
import { extractFromFile } from './extractor.js';
import type { Language } from '../../graph/types.js';

if (!parentPort) {
  throw new Error('worker.ts must be run as a worker thread');
}

parentPort.on('message', (msg: {
  id: number;
  filePath: string;
  content: string;
  language: Language;
}) => {
  try {
    const result = extractFromFile(msg.filePath, msg.content, msg.language);
    parentPort!.postMessage({ id: msg.id, result });
  } catch (err: any) {
    parentPort!.postMessage({ id: msg.id, error: err?.message || String(err) });
  }
});
