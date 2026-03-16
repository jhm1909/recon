/**
 * Simplified Cypher DSL Parser
 *
 * Parses a small subset of Cypher syntax against Recon's in-memory graph.
 *
 * Supported:
 *   MATCH (n:Type) WHERE n.prop = 'val' RETURN n LIMIT 10
 *   MATCH (a)-[:EDGE]->(b) WHERE a.name CONTAINS 'x' RETURN a.name, b.name
 *   MATCH (a:Struct)-[:HAS_METHOD]->(m:Method) RETURN a.name, m.name
 *   WHERE operators: =, CONTAINS, STARTS WITH, <>
 *   Multiple WHERE conditions joined with AND
 */

// ─── AST Types ──────────────────────────────────────────────────

export interface NodePattern {
  variable: string;
  label: string | null; // NodeType filter (e.g. "Function", "Class")
}

export interface RelPattern {
  source: string;     // variable name
  target: string;     // variable name
  type: string | null; // RelationshipType filter (e.g. "CALLS")
}

export interface Condition {
  variable: string;
  property: string;
  operator: '=' | '<>' | 'CONTAINS' | 'STARTS WITH';
  value: string;
}

export interface ReturnItem {
  variable: string;
  property: string | null; // null = return entire node
  alias: string | null;
}

export interface ParsedQuery {
  nodes: NodePattern[];
  relationships: RelPattern[];
  conditions: Condition[];
  returns: ReturnItem[];
  limit: number | null;
}

// ─── Parser ─────────────────────────────────────────────────────

export function parseCypher(input: string): ParsedQuery {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new CypherParseError('Empty query');
  }

  // Split into clauses: MATCH, WHERE, RETURN, LIMIT
  const matchSection = extractClause(trimmed, 'MATCH', ['WHERE', 'RETURN']);
  const whereSection = extractClause(trimmed, 'WHERE', ['RETURN']);
  const returnSection = extractClause(trimmed, 'RETURN', ['LIMIT']);
  const limitSection = extractClause(trimmed, 'LIMIT', []);

  if (!matchSection) {
    throw new CypherParseError('Missing MATCH clause');
  }
  if (!returnSection) {
    throw new CypherParseError('Missing RETURN clause');
  }

  const { nodes, relationships } = parseMatchPattern(matchSection);
  const conditions = whereSection ? parseWhereClause(whereSection) : [];
  const returns = parseReturnClause(returnSection);
  const limit = limitSection ? parseLimitClause(limitSection) : null;

  // Validate variable references
  const definedVars = new Set(nodes.map(n => n.variable));
  for (const cond of conditions) {
    if (!definedVars.has(cond.variable)) {
      throw new CypherParseError(`Unknown variable '${cond.variable}' in WHERE clause`);
    }
  }
  for (const ret of returns) {
    if (!definedVars.has(ret.variable)) {
      throw new CypherParseError(`Unknown variable '${ret.variable}' in RETURN clause`);
    }
  }

  return { nodes, relationships, conditions, returns, limit };
}

// ─── Clause Extraction ──────────────────────────────────────────

function extractClause(
  input: string,
  keyword: string,
  terminators: string[],
): string | null {
  // Case-insensitive search for keyword at word boundary
  const regex = new RegExp(`\\b${keyword}\\b`, 'i');
  const match = regex.exec(input);
  if (!match) return null;

  let start = match.index + match[0].length;
  let end = input.length;

  for (const term of terminators) {
    const termRegex = new RegExp(`\\b${term}\\b`, 'i');
    const termMatch = termRegex.exec(input.slice(start));
    if (termMatch) {
      const termPos = start + termMatch.index;
      if (termPos < end) end = termPos;
    }
  }

  const result = input.slice(start, end).trim();
  return result || null;
}

// ─── MATCH Parsing ──────────────────────────────────────────────

function parseMatchPattern(pattern: string): {
  nodes: NodePattern[];
  relationships: RelPattern[];
} {
  const nodes: NodePattern[] = [];
  const relationships: RelPattern[] = [];

  // Try to parse as relationship pattern: (a)-[:TYPE]->(b) or (a:Label)-[:TYPE]->(b:Label)
  // Pattern: (var[:Label]) -[:TYPE]-> (var[:Label])
  const relRegex = /\((\w+)(?::(\w+))?\)\s*-\[(?::(\w+))?\]\s*->\s*\((\w+)(?::(\w+))?\)/;
  const relMatch = relRegex.exec(pattern);

  if (relMatch) {
    const [, srcVar, srcLabel, relType, tgtVar, tgtLabel] = relMatch;

    nodes.push({ variable: srcVar, label: srcLabel || null });
    nodes.push({ variable: tgtVar, label: tgtLabel || null });
    relationships.push({
      source: srcVar,
      target: tgtVar,
      type: relType || null,
    });

    return { nodes, relationships };
  }

  // Try single node pattern: (var:Label) or (var)
  const nodeRegex = /\((\w+)(?::(\w+))?\)/g;
  let nodeMatch: RegExpExecArray | null;
  while ((nodeMatch = nodeRegex.exec(pattern)) !== null) {
    nodes.push({
      variable: nodeMatch[1],
      label: nodeMatch[2] || null,
    });
  }

  if (nodes.length === 0) {
    throw new CypherParseError(`Invalid MATCH pattern: ${pattern}`);
  }

  return { nodes, relationships };
}

// ─── WHERE Parsing ──────────────────────────────────────────────

function parseWhereClause(clause: string): Condition[] {
  // Split by AND (case-insensitive)
  const parts = clause.split(/\bAND\b/i).map(s => s.trim()).filter(Boolean);
  return parts.map(parseCondition);
}

function parseCondition(expr: string): Condition {
  // Try: var.prop STARTS WITH 'val'
  const startsWithMatch = expr.match(
    /^(\w+)\.(\w+)\s+STARTS\s+WITH\s+['"]([^'"]*)['"]\s*$/i,
  );
  if (startsWithMatch) {
    return {
      variable: startsWithMatch[1],
      property: startsWithMatch[2],
      operator: 'STARTS WITH',
      value: startsWithMatch[3],
    };
  }

  // Try: var.prop CONTAINS 'val'
  const containsMatch = expr.match(
    /^(\w+)\.(\w+)\s+CONTAINS\s+['"]([^'"]*)['"]\s*$/i,
  );
  if (containsMatch) {
    return {
      variable: containsMatch[1],
      property: containsMatch[2],
      operator: 'CONTAINS',
      value: containsMatch[3],
    };
  }

  // Try: var.prop <> 'val'
  const neqMatch = expr.match(
    /^(\w+)\.(\w+)\s*<>\s*['"]([^'"]*)['"]\s*$/,
  );
  if (neqMatch) {
    return {
      variable: neqMatch[1],
      property: neqMatch[2],
      operator: '<>',
      value: neqMatch[3],
    };
  }

  // Try: var.prop = 'val'
  const eqMatch = expr.match(
    /^(\w+)\.(\w+)\s*=\s*['"]([^'"]*)['"]\s*$/,
  );
  if (eqMatch) {
    return {
      variable: eqMatch[1],
      property: eqMatch[2],
      operator: '=',
      value: eqMatch[3],
    };
  }

  throw new CypherParseError(`Invalid WHERE condition: ${expr}`);
}

// ─── RETURN Parsing ─────────────────────────────────────────────

function parseReturnClause(clause: string): ReturnItem[] {
  const items = clause.split(',').map(s => s.trim()).filter(Boolean);
  return items.map(parseReturnItem);
}

function parseReturnItem(item: string): ReturnItem {
  // Check for AS alias: "var.prop AS alias" or "var AS alias"
  const asMatch = item.match(/^(.+?)\s+AS\s+(\w+)\s*$/i);
  const expr = asMatch ? asMatch[1].trim() : item;
  const alias = asMatch ? asMatch[2] : null;

  // "var.prop"
  const propMatch = expr.match(/^(\w+)\.(\w+)$/);
  if (propMatch) {
    return { variable: propMatch[1], property: propMatch[2], alias };
  }

  // "var"
  const varMatch = expr.match(/^(\w+)$/);
  if (varMatch) {
    return { variable: varMatch[1], property: null, alias };
  }

  throw new CypherParseError(`Invalid RETURN item: ${item}`);
}

// ─── LIMIT Parsing ──────────────────────────────────────────────

function parseLimitClause(clause: string): number {
  const n = parseInt(clause.trim(), 10);
  if (isNaN(n) || n <= 0) {
    throw new CypherParseError(`Invalid LIMIT: ${clause}`);
  }
  return n;
}

// ─── Error ──────────────────────────────────────────────────────

export class CypherParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CypherParseError';
  }
}
