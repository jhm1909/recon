/**
 * Staleness Check
 *
 * Checks if the Recon index is behind the current git HEAD.
 * Returns a warning hint for agents when index is stale.
 */

import { execSync } from 'node:child_process';

export interface StalenessInfo {
    isStale: boolean;
    commitsBehind: number;
    hint?: string;
}

/**
 * Check how many commits the index is behind HEAD.
 * Fail-open: if git is unavailable, assume not stale.
 */
export function checkStaleness(repoPath: string, lastCommit: string): StalenessInfo {
    if (!lastCommit) return { isStale: false, commitsBehind: 0 };

    try {
        const result = execSync(
            `git rev-list --count ${lastCommit}..HEAD`,
            { cwd: repoPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
        ).trim();

        const commitsBehind = parseInt(result, 10) || 0;

        if (commitsBehind > 0) {
            return {
                isStale: true,
                commitsBehind,
                hint: `⚠️ Index is ${commitsBehind} commit${commitsBehind > 1 ? 's' : ''} behind HEAD. Run \`recon index\` to update.`,
            };
        }

        return { isStale: false, commitsBehind: 0 };
    } catch {
        // Git unavailable or commit not found — fail open
        return { isStale: false, commitsBehind: 0 };
    }
}
