/**
 * File Hashing
 *
 * SHA-256 hashing for incremental indexing.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/**
 * Compute SHA-256 hash of a string.
 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Compute SHA-256 hash of a file's content.
 */
export async function hashFile(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Compute SHA-256 hashes for multiple files.
 * Skips files that can't be read (logs warning).
 */
export async function hashFiles(filePaths: string[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  await Promise.all(
    filePaths.map(async (fp) => {
      try {
        result[fp] = await hashFile(fp);
      } catch {
        // Skip files that can't be read
      }
    }),
  );

  return result;
}
