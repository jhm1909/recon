/**
 * recon_find — Natural Language Query Routing
 *
 * Classifies a free-text query into one of four strategies and executes
 * the appropriate search over the knowledge graph.
 */

import type { KnowledgeGraph, Node } from '../graph/index.js';
import { NodeType, RelationshipType } from '../graph/index.js';

// ─── Types ──────────────────────────────────────────────────────

export type QueryStrategy = 'exact' | 'pattern' | 'structural' | 'fulltext';

export interface FindResult {
  id: string;
  name: string;
  type: NodeType;
  file: string;
  line: number;
  package: string;
  exported: boolean;
  callers: number;
  callees: number;
  method?: boolean;
}

export interface FindOptions {
  limit?: number;
  type?: NodeType;
}

// ─── Structural Keywords ─────────────────────────────────────────

const STRUCTURAL_KEYWORDS = [
  'exported',
  'unexported',
  'no callers',
  'no callees',
  'unused',
  'implements',
  'extends',
  'orphan',
  'dead',
  'circular',
  'test',
  'entry point',
] as const;

// ─── Classification ──────────────────────────────────────────────

/**
 * Count how many structural keywords appear in the query.
 * Multi-word keywords (e.g. "no callers") count as one.
 */
function countStructuralKeywords(query: string): number {
  const lower = query.toLowerCase();
  let count = 0;
  for (const kw of STRUCTURAL_KEYWORDS) {
    if (lower.includes(kw)) {
      count++;
    }
  }
  return count;
}

/**
 * Classify a natural-language query into a search strategy.
 *
 * Rules (evaluated in order):
 *  1. Contains `*` or `?`                             → pattern
 *  2. Single token that looks like code                → exact
 *  3. 2+ structural keywords                           → structural
 *  4. 1 structural keyword + 3+ words total            → structural
 *  5. Otherwise                                        → fulltext
 */
export function classifyQuery(query: string): QueryStrategy {
  const trimmed = query.trim();

  // Rule 1: wildcard
  if (trimmed.includes('*') || trimmed.includes('?')) {
    return 'pattern';
  }

  // Rule 2: single code-like token
  // Code-like: camelCase, snake_case, dot.notation, PascalCase — no spaces, no pure lowercase English words
  const words = trimmed.split(/\s+/);
  if (words.length === 1) {
    const token = words[0];
    // Looks like code if it contains uppercase, underscore, or dot
    const isCodeLike =
      /[A-Z]/.test(token) ||          // has uppercase (camelCase / PascalCase)
      token.includes('_') ||           // snake_case
      token.includes('.');             // dot.notation
    if (isCodeLike) return 'exact';
    // Single short word (like "auth") → exact
    return 'exact';
  }

  // Count structural keywords
  const kwCount = countStructuralKeywords(trimmed);
  const wordCount = words.length;

  // Rule 3: 2+ structural keywords → structural
  if (kwCount >= 2) {
    return 'structural';
  }

  // Rule 4: 1 structural keyword + 3+ words → structural
  if (kwCount === 1 && wordCount >= 3) {
    return 'structural';
  }

  // Rule 4b: 1 structural keyword + exactly 2 words (e.g. "unused exports") → structural
  if (kwCount === 1 && wordCount === 2) {
    return 'structural';
  }

  // Rule 5: fulltext
  return 'fulltext';
}

// ─── Strategy Implementations ────────────────────────────────────

/**
 * Tokenize a camelCase / PascalCase / snake_case name into lowercase parts.
 */
function tokenizeName(name: string): string[] {
  // Split on underscores, dots, then camelCase boundaries
  const parts = name
    .replace(/[_.]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return parts;
}

/**
 * Build a FindResult from a Node plus its graph relationships.
 */
function buildResult(node: Node, graph: KnowledgeGraph): FindResult {
  const callers = graph.getIncoming(node.id, RelationshipType.CALLS).length
    + graph.getIncoming(node.id, RelationshipType.CALLS_API).length
    + graph.getIncoming(node.id, RelationshipType.USES_COMPONENT).length;

  const callees = graph.getOutgoing(node.id, RelationshipType.CALLS).length
    + graph.getOutgoing(node.id, RelationshipType.CALLS_API).length
    + graph.getOutgoing(node.id, RelationshipType.USES_COMPONENT).length;

  return {
    id: node.id,
    name: node.name,
    type: node.type,
    file: node.file,
    line: node.startLine,
    package: node.package,
    exported: node.exported,
    callers,
    callees,
    method: node.type === NodeType.Method,
  };
}

/**
 * Apply type filter and limit to a result set.
 */
function applyOptions(
  results: FindResult[],
  options: FindOptions | undefined,
): FindResult[] {
  if (options?.type !== undefined) {
    results = results.filter(r => r.type === options.type);
  }
  if (options?.limit !== undefined && options.limit > 0) {
    results = results.slice(0, options.limit);
  }
  return results;
}

// ─── Exact Search ────────────────────────────────────────────────

function searchExact(
  graph: KnowledgeGraph,
  query: string,
  options?: FindOptions,
): FindResult[] {
  const nodes = graph.findByName(query); // already case-insensitive
  const results = nodes.map(n => buildResult(n, graph));
  return applyOptions(results, options);
}

// ─── Pattern Search ──────────────────────────────────────────────

/**
 * Convert a glob-style wildcard pattern to a RegExp (case-insensitive).
 */
function wildcardToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function searchPattern(
  graph: KnowledgeGraph,
  query: string,
  options?: FindOptions,
): FindResult[] {
  const regex = wildcardToRegex(query);
  const results: FindResult[] = [];

  for (const node of graph.nodes.values()) {
    if (regex.test(node.name)) {
      results.push(buildResult(node, graph));
    }
  }

  return applyOptions(results, options);
}

// ─── Structural Search ───────────────────────────────────────────

function searchStructural(
  graph: KnowledgeGraph,
  query: string,
  options?: FindOptions,
): FindResult[] {
  const lower = query.toLowerCase();

  const wantsExported = lower.includes('exported') && !lower.includes('unexported');
  const wantsUnexported = lower.includes('unexported');
  const wantsNoCallers = lower.includes('no callers');
  const wantsNoCallees = lower.includes('no callees');
  const wantsUnused = lower.includes('unused');
  const wantsTest = lower.includes('test');
  const wantsOrphan = lower.includes('orphan');
  const wantsDead = lower.includes('dead');
  const wantsImplements = lower.includes('implements');
  const wantsExtends = lower.includes('extends');
  const wantsEntryPoint = lower.includes('entry point');

  const results: FindResult[] = [];

  for (const node of graph.nodes.values()) {
    // Skip file/package nodes for structural queries (usually not what the user wants)
    if (node.type === NodeType.File || node.type === NodeType.Package) continue;

    const result = buildResult(node, graph);

    // Apply filters
    if (wantsExported && !node.exported) continue;
    if (wantsUnexported && node.exported) continue;
    if (wantsNoCallers && result.callers > 0) continue;
    if (wantsNoCallees && result.callees > 0) continue;
    if (wantsUnused && result.callers > 0) continue;  // "unused" = no callers
    if (wantsTest && !node.isTest) continue;
    if (wantsOrphan && result.callers > 0) continue;  // "orphan" = no callers
    if (wantsDead && result.callers > 0) continue;    // "dead" = no callers
    if (wantsEntryPoint && result.callers > 0) continue; // entry point = no callers
    if (wantsImplements) {
      // Filter to nodes that have an IMPLEMENTS relationship
      const hasImpl =
        graph.getOutgoing(node.id, RelationshipType.IMPLEMENTS).length > 0 ||
        graph.getIncoming(node.id, RelationshipType.IMPLEMENTS).length > 0;
      if (!hasImpl) continue;
    }
    if (wantsExtends) {
      const hasExt =
        graph.getOutgoing(node.id, RelationshipType.EXTENDS).length > 0 ||
        graph.getIncoming(node.id, RelationshipType.EXTENDS).length > 0;
      if (!hasExt) continue;
    }

    results.push(result);
  }

  return applyOptions(results, options);
}

// ─── Fulltext Search ─────────────────────────────────────────────

function searchFulltext(
  graph: KnowledgeGraph,
  query: string,
  options?: FindOptions,
): FindResult[] {
  // Tokenize the query into terms
  const queryTokens = tokenizeName(query.replace(/[^\w\s]/g, ' '));

  if (queryTokens.length === 0) {
    return [];
  }

  const scored: Array<{ result: FindResult; score: number }> = [];

  for (const node of graph.nodes.values()) {
    const nameTokens = tokenizeName(node.name);
    const fileTokens = node.file ? tokenizeName(node.file.replace(/[/\\.]/g, ' ')) : [];
    const allTokens = [...nameTokens, ...fileTokens];

    let score = 0;
    for (const qt of queryTokens) {
      for (const nt of allTokens) {
        if (nt === qt) {
          score += 2;  // exact token match
        } else if (nt.includes(qt) || qt.includes(nt)) {
          score += 1;  // partial match
        }
      }
    }

    if (score > 0) {
      scored.push({ result: buildResult(node, graph), score });
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  const results = scored.map(s => s.result);
  return applyOptions(results, options);
}

// ─── Main Dispatcher ─────────────────────────────────────────────

/**
 * Execute a find operation using the appropriate strategy.
 */
export function executeFind(
  graph: KnowledgeGraph,
  query: string,
  options?: FindOptions,
): FindResult[] {
  const strategy = classifyQuery(query);

  switch (strategy) {
    case 'exact':
      return searchExact(graph, query, options);
    case 'pattern':
      return searchPattern(graph, query, options);
    case 'structural':
      return searchStructural(graph, query, options);
    case 'fulltext':
      return searchFulltext(graph, query, options);
  }
}

// ─── Formatting ──────────────────────────────────────────────────

/**
 * Format FindResult[] as a markdown string for MCP tool responses.
 */
export function formatFindResults(results: FindResult[]): string {
  if (results.length === 0) {
    return 'No results found.';
  }

  const lines: string[] = [
    `**Found ${results.length} result${results.length === 1 ? '' : 's'}**`,
    '',
  ];

  for (const r of results) {
    const exportTag = r.exported ? 'exported' : 'unexported';
    const callerInfo = `${r.callers} caller${r.callers === 1 ? '' : 's'}`;
    const calleeInfo = `${r.callees} callee${r.callees === 1 ? '' : 's'}`;

    lines.push(`- **${r.name}** (${r.type}) [${exportTag}]`);
    lines.push(`  \`${r.file}:${r.line}\` — ${r.package}`);
    lines.push(`  ${callerInfo}, ${calleeInfo}`);
  }

  return lines.join('\n');
}
