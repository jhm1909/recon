/**
 * PR Reviewer — Graph-aware code review
 *
 * Orchestrates: git diff → symbol mapping → blast radius → risk assessment → review report.
 * Reuses existing primitives from handlers (parseGitDiff, blast radius BFS).
 */

import { execSync } from 'node:child_process';
import type { Node } from '../graph/types.js';
import { NodeType, RelationshipType } from '../graph/types.js';
import type { KnowledgeGraph } from '../graph/graph.js';
import { detectProcesses } from '../graph/process.js';
import { exportGraph } from '../export/exporter.js';

// ─── Types ──────────────────────────────────────────────────────

export interface ReviewOptions {
  scope?: 'staged' | 'unstaged' | 'branch' | 'all';
  base?: string;
  includeDiagram?: boolean;
  includeTests?: boolean;
}

interface DiffHunk {
  file: string;
  startLine: number;
  lineCount: number;
}

interface ChangedSymbol {
  node: Node;
  reason: 'modified' | 'in_changed_file';
}

interface AffectedSymbol {
  node: Node;
  depth: number;
  edgeType: string;
  confidence: number;
  via: string;
}

interface FileAnalysis {
  file: string;
  modifiedSymbols: ChangedSymbol[];
  risk: string;
  affectedCount: number;
}

interface ReviewResult {
  scope: string;
  base: string;
  changedFiles: string[];
  changedSymbols: ChangedSymbol[];
  directlyModified: ChangedSymbol[];
  affected: AffectedSymbol[];
  fileAnalyses: FileAnalysis[];
  overallRisk: string;
  riskScore: number;
  affectedCommunities: Set<string>;
  brokenFlows: Array<{ name: string; step: number; total: number }>;
}

// ─── Git Utilities ──────────────────────────────────────────────

function parseGitDiff(projectRoot: string, scope: string, base: string): DiffHunk[] {
  let diffCmd: string;

  switch (scope) {
    case 'staged':
      diffCmd = 'git diff --cached --unified=0';
      break;
    case 'unstaged':
      diffCmd = 'git diff --unified=0';
      break;
    case 'branch':
      diffCmd = `git diff ${base}...HEAD --unified=0`;
      break;
    case 'all':
    default:
      diffCmd = 'git diff HEAD --unified=0';
      break;
  }

  let output: string;
  try {
    output = execSync(diffCmd, { cwd: projectRoot, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
  } catch {
    return [];
  }

  if (!output.trim()) return [];

  const hunks: DiffHunk[] = [];
  let currentFile = '';

  for (const line of output.split('\n')) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch) {
      currentFile = fileMatch[1];
      continue;
    }

    const hunkMatch = line.match(/^@@ .+ \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch && currentFile) {
      hunks.push({
        file: currentFile,
        startLine: parseInt(hunkMatch[1], 10),
        lineCount: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
      });
    }
  }

  return hunks;
}

function getChangedFiles(projectRoot: string, scope: string, base: string): string[] {
  let cmd: string;

  switch (scope) {
    case 'staged':
      cmd = 'git diff --cached --name-only';
      break;
    case 'unstaged':
      cmd = 'git diff --name-only';
      break;
    case 'branch':
      cmd = `git diff ${base}...HEAD --name-only`;
      break;
    case 'all':
    default:
      cmd = 'git diff HEAD --name-only';
      break;
  }

  try {
    const output = execSync(cmd, { cwd: projectRoot, encoding: 'utf-8' });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function getBranchName(): string {
  try {
    return execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

function isTestFile(file: string): boolean {
  return /[._]test\.|[._]spec\.|__tests__|test\/|tests\/|_test\.go$/i.test(file);
}

// ─── Core Analysis ──────────────────────────────────────────────

/**
 * Analyze changes and their blast radius.
 */
export function analyzeChanges(
  graph: KnowledgeGraph,
  projectRoot: string,
  options: ReviewOptions = {},
): ReviewResult {
  const scope = options.scope || 'all';
  const base = options.base || 'main';
  const includeTests = options.includeTests ?? false;

  // 1. Get diff data
  const changedFiles = getChangedFiles(projectRoot, scope, base);
  const hunks = parseGitDiff(projectRoot, scope, base);

  // 2. Map to symbols
  const changedSymbols: ChangedSymbol[] = [];
  const changedFileSet = new Set(changedFiles);

  for (const node of graph.nodes.values()) {
    if (node.type === NodeType.Package || node.type === NodeType.File) continue;
    if (!includeTests && isTestFile(node.file)) continue;
    if (!changedFileSet.has(node.file)) continue;

    if (node.startLine > 0 && node.endLine > 0) {
      const directlyModified = hunks.some(
        h => h.file === node.file &&
          h.startLine <= node.endLine &&
          (h.startLine + h.lineCount - 1) >= node.startLine,
      );
      changedSymbols.push({ node, reason: directlyModified ? 'modified' : 'in_changed_file' });
    } else {
      changedSymbols.push({ node, reason: 'in_changed_file' });
    }
  }

  // Deduplicate
  const symbolMap = new Map<string, ChangedSymbol>();
  for (const cs of changedSymbols) {
    const existing = symbolMap.get(cs.node.id);
    if (!existing || cs.reason === 'modified') {
      symbolMap.set(cs.node.id, cs);
    }
  }

  const uniqueSymbols = Array.from(symbolMap.values());
  const directlyModified = uniqueSymbols.filter(s => s.reason === 'modified');

  // 3. Blast radius BFS for each modified symbol
  const affected: AffectedSymbol[] = [];
  const affectedIds = new Set<string>(uniqueSymbols.map(s => s.node.id));

  for (const cs of directlyModified) {
    let frontier = [cs.node.id];
    const visited = new Set<string>([cs.node.id]);

    for (let depth = 1; depth <= 2 && frontier.length > 0; depth++) {
      const next: string[] = [];

      for (const nodeId of frontier) {
        const incoming = graph.getIncoming(nodeId);

        for (const edge of incoming) {
          if (visited.has(edge.sourceId)) continue;
          visited.add(edge.sourceId);

          const neighbor = graph.getNode(edge.sourceId);
          if (!neighbor) continue;
          if (!includeTests && isTestFile(neighbor.file)) continue;

          if (!affectedIds.has(neighbor.id)) {
            affectedIds.add(neighbor.id);
            affected.push({
              node: neighbor,
              depth,
              edgeType: edge.type,
              confidence: edge.confidence,
              via: cs.node.name,
            });
          }

          next.push(edge.sourceId);
        }
      }

      frontier = next;
    }
  }

  // 4. Per-file analysis
  const fileAnalyses: FileAnalysis[] = [];
  for (const file of changedFiles) {
    const fileSymbols = uniqueSymbols.filter(s => s.node.file === file);
    const fileModified = fileSymbols.filter(s => s.reason === 'modified');
    const fileAffected = affected.filter(a => fileModified.some(m => a.via === m.node.name));

    let risk: string;
    const d1 = fileAffected.filter(a => a.depth === 1);
    if (d1.length >= 10) risk = '🔴 HIGH';
    else if (d1.length >= 3) risk = '🟡 MEDIUM';
    else if (fileModified.length === 0) risk = '🟢 LOW (unchanged symbols)';
    else risk = '🟢 LOW';

    // New files
    const isNewFile = !Array.from(graph.nodes.values()).some(n => n.file === file);
    if (isNewFile) risk = '🟢 NEW';

    fileAnalyses.push({
      file,
      modifiedSymbols: fileSymbols,
      risk,
      affectedCount: fileAffected.length,
    });
  }

  // Sort: high risk first
  fileAnalyses.sort((a, b) => {
    const riskOrder = (r: string) => r.includes('🔴') ? 3 : r.includes('🟡') ? 2 : 1;
    return riskOrder(b.risk) - riskOrder(a.risk);
  });

  // 5. Overall risk
  const d1Count = affected.filter(a => a.depth === 1).length;
  const highConfCount = affected.filter(a => a.confidence >= 0.9).length;
  const crossFiles = new Set(affected.map(a => a.node.file)).size;

  let riskScore = 0;
  riskScore += d1Count * 3;
  riskScore += highConfCount * 2;
  riskScore += crossFiles > 5 ? 20 : 0;

  let overallRisk: string;
  if (riskScore >= 50) overallRisk = '🔴 CRITICAL';
  else if (riskScore >= 20) overallRisk = '🟠 HIGH';
  else if (riskScore >= 10) overallRisk = '🟡 MEDIUM';
  else overallRisk = '🟢 LOW';

  // 6. Affected communities
  const affectedCommunities = new Set<string>();
  for (const cs of uniqueSymbols) {
    if (cs.node.community) affectedCommunities.add(cs.node.community);
  }
  for (const a of affected) {
    if (a.node.community) affectedCommunities.add(a.node.community);
  }

  // 7. Broken execution flows
  const brokenFlows: Array<{ name: string; step: number; total: number }> = [];
  try {
    const processes = detectProcesses(graph, { limit: 50 });
    const modifiedIds = new Set(directlyModified.map(s => s.node.id));

    for (const proc of processes) {
      // Check entry point
      const entryNode = graph.findByName(proc.entryPoint.name)
        .find(n => n.file === proc.entryPoint.file);
      if (entryNode && modifiedIds.has(entryNode.id)) {
        brokenFlows.push({ name: proc.name, step: 0, total: proc.steps.length });
        continue;
      }
      // Check steps
      for (let i = 0; i < proc.steps.length; i++) {
        const stepNode = graph.findByName(proc.steps[i].name)
          .find(n => n.file === proc.steps[i].file);
        if (stepNode && modifiedIds.has(stepNode.id)) {
          brokenFlows.push({ name: proc.name, step: i + 1, total: proc.steps.length });
          break;
        }
      }
    }
  } catch { /* ignore process detection errors */ }

  return {
    scope,
    base,
    changedFiles,
    changedSymbols: uniqueSymbols,
    directlyModified,
    affected,
    fileAnalyses,
    overallRisk,
    riskScore,
    affectedCommunities,
    brokenFlows,
  };
}

// ─── Format Review Report ───────────────────────────────────────

/**
 * Format analysis results as a markdown review report.
 */
export function formatReview(
  result: ReviewResult,
  graph: KnowledgeGraph,
  options: ReviewOptions = {},
): string {
  const branch = getBranchName();
  const { directlyModified, affected, fileAnalyses, brokenFlows, affectedCommunities } = result;
  const d1 = affected.filter(a => a.depth === 1);
  const d2 = affected.filter(a => a.depth === 2);

  if (result.changedFiles.length === 0) {
    return [
      '# PR Review',
      '',
      `**Scope:** ${result.scope}${result.scope === 'branch' ? ` (base: ${result.base})` : ''}`,
      '',
      '_No changes detected._',
    ].join('\n');
  }

  const lines: string[] = [
    `# PR Review: ${branch}`,
    '',
    '## Summary',
    `- **Risk:** ${result.overallRisk}`,
    `- **Changed:** ${result.changedFiles.length} files, ${directlyModified.length} symbols modified`,
    `- **Blast radius:** ${affected.length} affected symbols (${d1.length} direct, ${d2.length} indirect)`,
    ...(affectedCommunities.size > 0
      ? [`- **Communities:** ${Array.from(affectedCommunities).join(', ')} (${affectedCommunities.size})`]
      : []),
    ...(brokenFlows.length > 0
      ? [`- **Breaking flows:** ${brokenFlows.length} execution path(s) impacted`]
      : []),
    '',
  ];

  // Per-file analysis
  lines.push('## Per-File Analysis');
  lines.push('');

  for (const fa of fileAnalyses) {
    lines.push(`### \`${fa.file}\` — ${fa.risk}`);

    const modified = fa.modifiedSymbols.filter(s => s.reason === 'modified');
    const inFile = fa.modifiedSymbols.filter(s => s.reason === 'in_changed_file');

    if (modified.length > 0) {
      lines.push(`**Modified:** ${modified.map(s => `\`${s.node.name}\` (${s.node.type})`).join(', ')}`);

      // Show callers for modified symbols
      for (const s of modified) {
        const callers = graph.getIncoming(s.node.id, RelationshipType.CALLS);
        if (callers.length > 0) {
          const callerNames = callers.slice(0, 5).map(r => {
            const caller = graph.getNode(r.sourceId);
            return caller ? `\`${caller.name}\`` : 'unknown';
          });
          const more = callers.length > 5 ? ` +${callers.length - 5} more` : '';
          lines.push(`  - ${s.node.name} → ${callers.length} caller(s): ${callerNames.join(', ')}${more}`);
        }
      }
    }

    if (inFile.length > 0 && modified.length > 0) {
      lines.push(`**Also in file:** ${inFile.length} other symbols`);
    }

    lines.push('');
  }

  // Affected symbols
  if (d1.length > 0) {
    lines.push('## Directly Affected (d=1)');
    lines.push('');
    const confLabel = (c: number) => c >= 0.9 ? '🔴' : c >= 0.7 ? '🟡' : '🟢';
    for (const a of d1.slice(0, 20)) {
      lines.push(`- ${confLabel(a.confidence)} **${a.node.name}** (${a.node.type}) ← via \`${a.via}\` | \`${a.node.file}:${a.node.startLine}\``);
    }
    if (d1.length > 20) lines.push(`_...and ${d1.length - 20} more_`);
    lines.push('');
  }

  // Broken flows
  if (brokenFlows.length > 0) {
    lines.push('## Affected Execution Flows');
    lines.push('');
    for (const f of brokenFlows) {
      const role = f.step === 0 ? 'entry point' : `step ${f.step}/${f.total}`;
      lines.push(`- **${f.name}** — modified at ${role}`);
    }
    lines.push('');
  }

  // Architecture diagram
  if (options.includeDiagram !== false && directlyModified.length > 0) {
    try {
      const symbolNames = directlyModified.slice(0, 5).map(s => s.node.name);
      const diagram = exportGraph(graph, {
        format: 'mermaid',
        symbol: symbolNames[0],
        depth: 2,
        limit: 20,
        skipFiles: true,
        direction: 'TD',
      });

      if (diagram && !diagram.includes('No nodes')) {
        lines.push('## Architecture Diagram');
        lines.push('');
        lines.push('```mermaid');
        lines.push(diagram);
        lines.push('```');
        lines.push('');
      }
    } catch { /* skip diagram on error */ }
  }

  // Review priorities
  const priorities = directlyModified
    .map(s => {
      const callerCount = graph.getIncoming(s.node.id, RelationshipType.CALLS).length;
      return { name: s.node.name, type: s.node.type, file: s.node.file, callerCount };
    })
    .sort((a, b) => b.callerCount - a.callerCount)
    .slice(0, 5);

  if (priorities.length > 0) {
    lines.push('## Review Priorities');
    lines.push('');
    let idx = 1;
    for (const p of priorities) {
      const risk = p.callerCount >= 5 ? '🔴' : p.callerCount >= 2 ? '🟡' : '🟢';
      lines.push(`${idx}. ${risk} **${p.name}** — ${p.callerCount} caller(s) | \`${p.file}\``);
      idx++;
    }
    lines.push('');
  }

  return lines.join('\n');
}
