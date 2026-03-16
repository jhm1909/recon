/**
 * Query Module
 *
 * Simplified Cypher DSL for querying Recon's knowledge graph.
 */

export { parseCypher, CypherParseError } from './parser.js';
export type { ParsedQuery, NodePattern, RelPattern, Condition, ReturnItem } from './parser.js';

export { executeQuery, executeParsed, formatResultAsMarkdown } from './executor.js';
export type { QueryResult } from './executor.js';
