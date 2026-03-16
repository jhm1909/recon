/**
 * Cypher Query Executor
 *
 * Executes parsed Cypher queries against Recon's in-memory KnowledgeGraph.
 * Returns results as markdown tables.
 */

import { KnowledgeGraph } from '../graph/graph.js';
import type { Node, Relationship } from '../graph/types.js';
import type { ParsedQuery, Condition, ReturnItem } from './parser.js';
import { parseCypher, CypherParseError } from './parser.js';

// ─── Types ──────────────────────────────────────────────────────

export interface QueryResult {
  columns: string[];
  rows: Record<string, string>[];
  rowCount: number;
  truncated: boolean;
}

// ─── Node property accessor ─────────────────────────────────────

const NODE_PROPERTIES = new Set([
  'id', 'type', 'name', 'file', 'startLine', 'endLine',
  'language', 'package', 'exported', 'receiver', 'returnType',
  'importPath',
]);

function getNodeProperty(node: Node, prop: string): string {
  switch (prop) {
    case 'id': return node.id;
    case 'type': return node.type;
    case 'name': return node.name;
    case 'file': return node.file;
    case 'startLine': return String(node.startLine);
    case 'endLine': return String(node.endLine);
    case 'language': return node.language;
    case 'package': return node.package;
    case 'exported': return String(node.exported);
    case 'receiver': return node.receiver || '';
    case 'returnType': return node.returnType || '';
    case 'importPath': return node.importPath || '';
    default: return '';
  }
}

// ─── Executor ───────────────────────────────────────────────────

export function executeQuery(
  queryStr: string,
  graph: KnowledgeGraph,
  defaultLimit: number = 50,
): QueryResult {
  const parsed = parseCypher(queryStr);
  return executeParsed(parsed, graph, defaultLimit);
}

export function executeParsed(
  query: ParsedQuery,
  graph: KnowledgeGraph,
  defaultLimit: number = 50,
): QueryResult {
  const limit = query.limit ?? defaultLimit;

  if (query.relationships.length === 0) {
    // Simple node query
    return executeNodeQuery(query, graph, limit);
  } else {
    // Relationship traversal query
    return executeRelQuery(query, graph, limit);
  }
}

// ─── Simple Node Query ──────────────────────────────────────────

function executeNodeQuery(
  query: ParsedQuery,
  graph: KnowledgeGraph,
  limit: number,
): QueryResult {
  // The first (and usually only) node pattern
  const pattern = query.nodes[0];
  const variable = pattern.variable;

  // Collect matching nodes
  const matches: Node[] = [];

  for (const node of graph.nodes.values()) {
    // Type filter from label
    if (pattern.label && node.type !== pattern.label) continue;

    // WHERE conditions
    if (!evaluateConditions(query.conditions, { [variable]: node })) continue;

    matches.push(node);
    if (matches.length >= limit) break;
  }

  return buildResult(query.returns, matches.map(n => ({ [variable]: n })), limit);
}

// ─── Relationship Query ─────────────────────────────────────────

function executeRelQuery(
  query: ParsedQuery,
  graph: KnowledgeGraph,
  limit: number,
): QueryResult {
  const rel = query.relationships[0];
  const srcPattern = query.nodes.find(n => n.variable === rel.source)!;
  const tgtPattern = query.nodes.find(n => n.variable === rel.target)!;

  const bindings: Array<Record<string, Node>> = [];

  // Strategy: iterate edges or iterate source nodes
  if (hasConditionFor(query.conditions, rel.source)) {
    // Start from source nodes matching conditions
    for (const srcNode of graph.nodes.values()) {
      if (srcPattern.label && srcNode.type !== srcPattern.label) continue;
      if (!evaluateConditions(
        query.conditions.filter(c => c.variable === rel.source),
        { [rel.source]: srcNode },
      )) continue;

      // Traverse outgoing edges
      const outgoing = graph.getOutgoing(srcNode.id);
      for (const edge of outgoing) {
        if (rel.type && edge.type !== rel.type) continue;

        const tgtNode = graph.getNode(edge.targetId);
        if (!tgtNode) continue;
        if (tgtPattern.label && tgtNode.type !== tgtPattern.label) continue;

        const binding = { [rel.source]: srcNode, [rel.target]: tgtNode };
        if (!evaluateConditions(
          query.conditions.filter(c => c.variable === rel.target),
          binding,
        )) continue;

        bindings.push(binding);
        if (bindings.length >= limit) break;
      }

      if (bindings.length >= limit) break;
    }
  } else if (hasConditionFor(query.conditions, rel.target)) {
    // Start from target nodes matching conditions
    for (const tgtNode of graph.nodes.values()) {
      if (tgtPattern.label && tgtNode.type !== tgtPattern.label) continue;
      if (!evaluateConditions(
        query.conditions.filter(c => c.variable === rel.target),
        { [rel.target]: tgtNode },
      )) continue;

      // Traverse incoming edges
      const incoming = graph.getIncoming(tgtNode.id);
      for (const edge of incoming) {
        if (rel.type && edge.type !== rel.type) continue;

        const srcNode = graph.getNode(edge.sourceId);
        if (!srcNode) continue;
        if (srcPattern.label && srcNode.type !== srcPattern.label) continue;

        const binding = { [rel.source]: srcNode, [rel.target]: tgtNode };
        if (!evaluateConditions(
          query.conditions.filter(c => c.variable === rel.source),
          binding,
        )) continue;

        bindings.push(binding);
        if (bindings.length >= limit) break;
      }

      if (bindings.length >= limit) break;
    }
  } else {
    // No conditions on either side — iterate all edges
    for (const edge of graph.allRelationships()) {
      if (rel.type && edge.type !== rel.type) continue;

      const srcNode = graph.getNode(edge.sourceId);
      const tgtNode = graph.getNode(edge.targetId);
      if (!srcNode || !tgtNode) continue;

      if (srcPattern.label && srcNode.type !== srcPattern.label) continue;
      if (tgtPattern.label && tgtNode.type !== tgtPattern.label) continue;

      const binding = { [rel.source]: srcNode, [rel.target]: tgtNode };
      if (!evaluateConditions(query.conditions, binding)) continue;

      bindings.push(binding);
      if (bindings.length >= limit) break;
    }
  }

  return buildResult(query.returns, bindings, limit);
}

// ─── Condition Evaluation ───────────────────────────────────────

function evaluateConditions(
  conditions: Condition[],
  bindings: Record<string, Node>,
): boolean {
  for (const cond of conditions) {
    const node = bindings[cond.variable];
    if (!node) return false;

    const actual = getNodeProperty(node, cond.property);

    switch (cond.operator) {
      case '=':
        if (actual.toLowerCase() !== cond.value.toLowerCase()) return false;
        break;
      case '<>':
        if (actual.toLowerCase() === cond.value.toLowerCase()) return false;
        break;
      case 'CONTAINS':
        if (!actual.toLowerCase().includes(cond.value.toLowerCase())) return false;
        break;
      case 'STARTS WITH':
        if (!actual.toLowerCase().startsWith(cond.value.toLowerCase())) return false;
        break;
    }
  }
  return true;
}

function hasConditionFor(conditions: Condition[], variable: string): boolean {
  return conditions.some(c => c.variable === variable);
}

// ─── Result Building ────────────────────────────────────────────

function buildResult(
  returns: ReturnItem[],
  bindings: Array<Record<string, Node>>,
  limit: number,
): QueryResult {
  const truncated = bindings.length >= limit;
  const rows: Record<string, string>[] = [];

  // Determine columns
  const columns = returns.map(r => {
    if (r.alias) return r.alias;
    if (r.property) return `${r.variable}.${r.property}`;
    return r.variable;
  });

  for (const binding of bindings) {
    const row: Record<string, string> = {};

    for (let i = 0; i < returns.length; i++) {
      const ret = returns[i];
      const colName = columns[i];
      const node = binding[ret.variable];

      if (!node) {
        row[colName] = '';
        continue;
      }

      if (ret.property) {
        row[colName] = getNodeProperty(node, ret.property);
      } else {
        // Return summary: "name (type) @ file:line"
        row[colName] = `${node.name} (${node.type}) @ ${node.file}:${node.startLine}`;
      }
    }

    rows.push(row);
  }

  return { columns, rows, rowCount: rows.length, truncated };
}

// ─── Markdown Formatting ────────────────────────────────────────

export function formatResultAsMarkdown(result: QueryResult): string {
  if (result.rowCount === 0) {
    return '_No results._';
  }

  const lines: string[] = [];

  // Header row
  lines.push('| ' + result.columns.join(' | ') + ' |');
  lines.push('| ' + result.columns.map(() => '---').join(' | ') + ' |');

  // Data rows
  for (const row of result.rows) {
    const cells = result.columns.map(col => escapeMarkdownCell(row[col] || ''));
    lines.push('| ' + cells.join(' | ') + ' |');
  }

  if (result.truncated) {
    lines.push('');
    lines.push(`_Results truncated at ${result.rowCount} rows._`);
  }

  return lines.join('\n');
}

function escapeMarkdownCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
