/**
 * recon_rules — Code Quality Rules
 *
 * Five static-analysis rules that operate on the KnowledgeGraph:
 *   dead_code      — Exported symbols with no callers / importers
 *   unused_exports — Exported symbols used only within their own file
 *   circular_deps  — Package-level import cycles (DFS WHITE/GRAY/BLACK)
 *   large_files    — Files whose symbol count exceeds a threshold
 *   orphans        — File-type nodes with no relationships at all
 */

import type { KnowledgeGraph, Node } from '../graph/index.js';
import { NodeType, RelationshipType } from '../graph/index.js';

// ─── Public Types ───────────────────────────────────────────────

export interface RuleItem {
  name: string;
  file?: string;
  line?: number;
  detail?: string;
}

export interface RuleResult {
  rule: RuleName;
  items: RuleItem[];
  count: number;
}

export type RuleName =
  | 'dead_code'
  | 'unused_exports'
  | 'circular_deps'
  | 'large_files'
  | 'orphans';

export interface RuleOptions {
  /** large_files: flag files with symbol count > threshold (default 30) */
  threshold?: number;
}

// ─── Dispatcher ─────────────────────────────────────────────────

export function runRule(
  graph: KnowledgeGraph,
  rule: RuleName,
  options?: RuleOptions,
): RuleResult {
  switch (rule) {
    case 'dead_code':
      return ruleDeadCode(graph);
    case 'unused_exports':
      return ruleUnusedExports(graph);
    case 'circular_deps':
      return ruleCircularDeps(graph);
    case 'large_files':
      return ruleLargeFiles(graph, options?.threshold ?? 30);
    case 'orphans':
      return ruleOrphans(graph);
  }
}

// ─── Rule: dead_code ────────────────────────────────────────────

/**
 * Find exported symbols (not Package/File/Module, not isTest) that have
 * zero incoming CALLS, IMPORTS, or USES_COMPONENT edges, ignoring self-loops.
 */
function ruleDeadCode(graph: KnowledgeGraph): RuleResult {
  const EXCLUDED_TYPES = new Set<NodeType>([
    NodeType.Package,
    NodeType.File,
    NodeType.Module,
  ]);

  const USAGE_TYPES = new Set<RelationshipType>([
    RelationshipType.CALLS,
    RelationshipType.IMPORTS,
    RelationshipType.USES_COMPONENT,
  ]);

  const items: RuleItem[] = [];

  for (const node of graph.nodes.values()) {
    if (!node.exported) continue;
    if (EXCLUDED_TYPES.has(node.type)) continue;
    if (node.isTest) continue;

    const incoming = graph.getIncoming(node.id);
    const usages = incoming.filter(
      r => USAGE_TYPES.has(r.type) && r.sourceId !== node.id,
    );

    if (usages.length === 0) {
      items.push({
        name: node.name,
        file: node.file,
        line: node.startLine > 0 ? node.startLine : undefined,
        detail: `exported ${node.type} with no callers`,
      });
    }
  }

  return { rule: 'dead_code', items, count: items.length };
}

// ─── Rule: unused_exports ────────────────────────────────────────

/**
 * Find exported symbols where ALL incoming edges come from the same file.
 * Also flags symbols with zero incoming edges.
 * Excludes Package, File, Module nodes.
 */
function ruleUnusedExports(graph: KnowledgeGraph): RuleResult {
  const EXCLUDED_TYPES = new Set<NodeType>([
    NodeType.Package,
    NodeType.File,
    NodeType.Module,
  ]);

  const items: RuleItem[] = [];

  for (const node of graph.nodes.values()) {
    if (!node.exported) continue;
    if (EXCLUDED_TYPES.has(node.type)) continue;

    const incoming = graph.getIncoming(node.id);

    if (incoming.length === 0) {
      // No callers at all — also considered unused export
      items.push({
        name: node.name,
        file: node.file,
        line: node.startLine > 0 ? node.startLine : undefined,
        detail: 'exported with no incoming references',
      });
      continue;
    }

    // Check if every caller lives in the same file
    const hasCrossFileCaller = incoming.some(r => {
      const source = graph.getNode(r.sourceId);
      return source !== undefined && source.file !== node.file;
    });

    if (!hasCrossFileCaller) {
      items.push({
        name: node.name,
        file: node.file,
        line: node.startLine > 0 ? node.startLine : undefined,
        detail: 'exported but only referenced within the same file',
      });
    }
  }

  return { rule: 'unused_exports', items, count: items.length };
}

// ─── Rule: circular_deps ─────────────────────────────────────────

/**
 * Build a package-level import graph from Package nodes and IMPORTS edges,
 * then run iterative DFS with WHITE/GRAY/BLACK coloring to find back-edges.
 *
 * Returns an array of cycles, where each cycle is a string[] of package names.
 */
export function findCircularDeps(graph: KnowledgeGraph): string[][] {
  // Collect all Package nodes
  const packages = new Map<string, string>(); // nodeId → packageName

  for (const node of graph.nodes.values()) {
    if (node.type === NodeType.Package) {
      packages.set(node.id, node.package || node.name);
    }
  }

  // Build adjacency list: nodeId → Set<nodeId> for IMPORTS edges
  const adj = new Map<string, Set<string>>();
  for (const id of packages.keys()) {
    adj.set(id, new Set());
  }

  for (const rel of graph.relationships.values()) {
    if (rel.type !== RelationshipType.IMPORTS) continue;
    if (!packages.has(rel.sourceId) || !packages.has(rel.targetId)) continue;
    adj.get(rel.sourceId)!.add(rel.targetId);
  }

  // DFS coloring
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();

  for (const id of packages.keys()) {
    color.set(id, WHITE);
  }

  const cycles: string[][] = [];

  // Iterative DFS to avoid stack overflow on large graphs
  for (const startId of packages.keys()) {
    if (color.get(startId) !== WHITE) continue;

    // Stack entries: [nodeId, iterator over neighbors, path so far]
    const stack: Array<[string, Iterator<string>, string[]]> = [];
    const path: string[] = [];
    const pathSet = new Set<string>();

    color.set(startId, GRAY);
    path.push(startId);
    pathSet.add(startId);
    stack.push([startId, adj.get(startId)![Symbol.iterator](), path]);

    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const [, iter] = top;
      const next = iter.next();

      if (next.done) {
        // Backtrack
        const [nodeId] = stack.pop()!;
        color.set(nodeId, BLACK);
        pathSet.delete(nodeId);
        path.pop();
      } else {
        const neighborId = next.value;
        const nColor = color.get(neighborId) ?? WHITE;

        if (nColor === GRAY) {
          // Back-edge: found a cycle. Extract the cycle from the current path.
          const cycleStart = path.indexOf(neighborId);
          if (cycleStart !== -1) {
            const cycle = path.slice(cycleStart).map(id => packages.get(id) ?? id);
            cycles.push(cycle);
          } else {
            // Self-loop case
            const pkgName = packages.get(neighborId) ?? neighborId;
            cycles.push([pkgName]);
          }
        } else if (nColor === WHITE) {
          color.set(neighborId, GRAY);
          path.push(neighborId);
          pathSet.add(neighborId);
          stack.push([neighborId, adj.get(neighborId)![Symbol.iterator](), path]);
        }
        // BLACK: already fully processed, skip
      }
    }
  }

  return cycles;
}

function ruleCircularDeps(graph: KnowledgeGraph): RuleResult {
  const cycles = findCircularDeps(graph);

  const items: RuleItem[] = cycles.map(cycle => ({
    name: cycle.join(' → '),
    detail: `cycle: ${cycle.join(' → ')} → ${cycle[0]}`,
  }));

  return { rule: 'circular_deps', items, count: items.length };
}

// ─── Rule: large_files ──────────────────────────────────────────

/**
 * Group nodes by file, count non-Package/File/Module symbols,
 * and flag files whose count exceeds the threshold.
 */
function ruleLargeFiles(graph: KnowledgeGraph, threshold: number): RuleResult {
  const EXCLUDED_TYPES = new Set<NodeType>([
    NodeType.Package,
    NodeType.File,
    NodeType.Module,
  ]);

  const fileCounts = new Map<string, number>();

  for (const node of graph.nodes.values()) {
    if (EXCLUDED_TYPES.has(node.type)) continue;
    if (!node.file) continue;
    fileCounts.set(node.file, (fileCounts.get(node.file) ?? 0) + 1);
  }

  const items: RuleItem[] = [];

  for (const [file, count] of fileCounts) {
    if (count > threshold) {
      items.push({
        name: file,
        file,
        detail: `${count} symbols (threshold: ${threshold})`,
      });
    }
  }

  // Sort by count descending (largest first)
  items.sort((a, b) => {
    const ca = fileCounts.get(a.file ?? '') ?? 0;
    const cb = fileCounts.get(b.file ?? '') ?? 0;
    return cb - ca;
  });

  return { rule: 'large_files', items, count: items.length };
}

// ─── Rule: orphans ──────────────────────────────────────────────

/**
 * Find File-type nodes with zero incoming AND zero outgoing relationships.
 */
function ruleOrphans(graph: KnowledgeGraph): RuleResult {
  const items: RuleItem[] = [];

  for (const node of graph.nodes.values()) {
    if (node.type !== NodeType.File) continue;

    const incoming = graph.getIncoming(node.id);
    const outgoing = graph.getOutgoing(node.id);

    if (incoming.length === 0 && outgoing.length === 0) {
      items.push({
        name: node.name,
        file: node.file,
        line: node.startLine > 0 ? node.startLine : undefined,
        detail: 'file node with no relationships',
      });
    }
  }

  return { rule: 'orphans', items, count: items.length };
}

// ─── Formatter ──────────────────────────────────────────────────

/**
 * Format a RuleResult as markdown text for MCP responses.
 */
export function formatRuleResult(result: RuleResult): string {
  const lines: string[] = [
    `# Rule: ${result.rule}`,
    '',
    `**Issues found:** ${result.count}`,
    '',
  ];

  if (result.count === 0) {
    lines.push('No issues found.');
    return lines.join('\n');
  }

  for (const item of result.items) {
    const loc = item.file
      ? item.line
        ? ` — \`${item.file}:${item.line}\``
        : ` — \`${item.file}\``
      : '';
    const detail = item.detail ? ` (${item.detail})` : '';
    lines.push(`- **${item.name}**${loc}${detail}`);
  }

  return lines.join('\n');
}
