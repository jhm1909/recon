/**
 * MCP Resources
 *
 * Provides structured on-demand data to AI agents via recon:// URIs.
 * Static resources have fixed URIs; dynamic resources use URI templates.
 */

import { KnowledgeGraph } from '../graph/graph.js';
import { NodeType } from '../graph/types.js';
import type { Node } from '../graph/types.js';

// ─── Types ──────────────────────────────────────────────────────

export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface ResourceTemplate {
  uriTemplate: string;
  name: string;
  description: string;
  mimeType: string;
}

// ─── Definitions ────────────────────────────────────────────────

export function getResourceDefinitions(): ResourceDefinition[] {
  return [
    {
      uri: 'recon://stats',
      name: 'Index Statistics',
      description: 'Knowledge graph statistics: node/relationship counts by type and language.',
      mimeType: 'text/yaml',
    },
  ];
}

export function getResourceTemplates(): ResourceTemplate[] {
  return [
    {
      uriTemplate: 'recon://symbol/{name}',
      name: 'Symbol Detail',
      description: 'Symbol definition, callers, callees, and relationships.',
      mimeType: 'text/yaml',
    },
    {
      uriTemplate: 'recon://file/{path}',
      name: 'File Symbols',
      description: 'All symbols defined in a file with their types and line ranges.',
      mimeType: 'text/yaml',
    },
  ];
}

// ─── URI Parsing ────────────────────────────────────────────────

interface ParsedUri {
  resourceType: 'stats' | 'symbol' | 'file';
  param?: string;
}

export function parseUri(uri: string): ParsedUri {
  if (uri === 'recon://stats') return { resourceType: 'stats' };

  const symbolMatch = uri.match(/^recon:\/\/symbol\/(.+)$/);
  if (symbolMatch) {
    return { resourceType: 'symbol', param: decodeURIComponent(symbolMatch[1]) };
  }

  const fileMatch = uri.match(/^recon:\/\/file\/(.+)$/);
  if (fileMatch) {
    return { resourceType: 'file', param: decodeURIComponent(fileMatch[1]) };
  }

  throw new Error(`Unknown resource URI: ${uri}`);
}

// ─── Read Resource ──────────────────────────────────────────────

export function readResource(uri: string, graph: KnowledgeGraph): string {
  const parsed = parseUri(uri);

  switch (parsed.resourceType) {
    case 'stats':
      return getStatsResource(graph);
    case 'symbol':
      return getSymbolResource(graph, parsed.param!);
    case 'file':
      return getFileResource(graph, parsed.param!);
  }
}

// ─── Resource Implementations ───────────────────────────────────

function getStatsResource(graph: KnowledgeGraph): string {
  // Count nodes by type
  const nodesByType = new Map<string, number>();
  const nodesByLang = new Map<string, number>();
  for (const node of graph.nodes.values()) {
    nodesByType.set(node.type, (nodesByType.get(node.type) || 0) + 1);
    nodesByLang.set(node.language, (nodesByLang.get(node.language) || 0) + 1);
  }

  // Count relationships by type
  const relsByType = new Map<string, number>();
  for (const rel of graph.relationships.values()) {
    relsByType.set(rel.type, (relsByType.get(rel.type) || 0) + 1);
  }

  const lines: string[] = [
    `total_nodes: ${graph.nodeCount}`,
    `total_relationships: ${graph.relationshipCount}`,
    '',
    'nodes_by_type:',
  ];

  for (const [type, count] of [...nodesByType.entries()].sort()) {
    lines.push(`  ${type}: ${count}`);
  }

  lines.push('');
  lines.push('nodes_by_language:');
  for (const [lang, count] of [...nodesByLang.entries()].sort()) {
    lines.push(`  ${lang}: ${count}`);
  }

  lines.push('');
  lines.push('relationships_by_type:');
  for (const [type, count] of [...relsByType.entries()].sort()) {
    lines.push(`  ${type}: ${count}`);
  }

  return lines.join('\n');
}

function getSymbolResource(graph: KnowledgeGraph, name: string): string {
  const matches = graph.findByName(name);

  if (matches.length === 0) {
    return `error: Symbol "${name}" not found`;
  }

  // If multiple matches, show all; if single, show detail
  if (matches.length > 1) {
    const lines: string[] = [
      `matches: ${matches.length}`,
      `query: "${name}"`,
      '',
      'symbols:',
    ];
    for (const m of matches) {
      lines.push(`  - name: "${m.name}"`);
      lines.push(`    type: ${m.type}`);
      lines.push(`    file: "${m.file}"`);
      lines.push(`    line: ${m.startLine}`);
      lines.push(`    package: "${m.package}"`);
      lines.push(`    exported: ${m.exported}`);
    }
    return lines.join('\n');
  }

  const node = matches[0];
  const incoming = graph.getIncoming(node.id);
  const outgoing = graph.getOutgoing(node.id);

  const lines: string[] = [
    `name: "${node.name}"`,
    `type: ${node.type}`,
    `file: "${node.file}"`,
    `lines: ${node.startLine}-${node.endLine}`,
    `language: ${node.language}`,
    `package: "${node.package}"`,
    `exported: ${node.exported}`,
  ];

  // Optional fields
  if (node.receiver) lines.push(`receiver: "${node.receiver}"`);
  if (node.returnType) lines.push(`return_type: "${node.returnType}"`);
  if (node.params && node.params.length > 0) {
    lines.push(`params: [${node.params.map(p => `"${p}"`).join(', ')}]`);
  }
  if (node.fields && node.fields.length > 0) {
    lines.push(`fields: [${node.fields.map(f => `"${f}"`).join(', ')}]`);
  }
  if (node.props && node.props.length > 0) {
    lines.push(`props: [${node.props.map(p => `"${p}"`).join(', ')}]`);
  }

  // Incoming relationships (callers, importers, etc.)
  if (incoming.length > 0) {
    lines.push('');
    lines.push('incoming:');
    for (const rel of incoming) {
      const source = graph.getNode(rel.sourceId);
      if (!source) continue;
      lines.push(`  - type: ${rel.type}`);
      lines.push(`    from: "${source.name}"`);
      lines.push(`    file: "${source.file}"`);
    }
  }

  // Outgoing relationships (callees, methods, etc.)
  if (outgoing.length > 0) {
    lines.push('');
    lines.push('outgoing:');
    for (const rel of outgoing) {
      const target = graph.getNode(rel.targetId);
      if (!target) continue;
      lines.push(`  - type: ${rel.type}`);
      lines.push(`    to: "${target.name}"`);
      lines.push(`    file: "${target.file}"`);
    }
  }

  return lines.join('\n');
}

function getFileResource(graph: KnowledgeGraph, path: string): string {
  // Find all nodes in the file (substring match like the tools do)
  const symbols: Node[] = [];
  for (const node of graph.nodes.values()) {
    if (node.type === NodeType.File || node.type === NodeType.Package) continue;
    if (node.file.includes(path)) {
      symbols.push(node);
    }
  }

  if (symbols.length === 0) {
    return `error: No symbols found in file matching "${path}"`;
  }

  // Sort by startLine
  symbols.sort((a, b) => a.file.localeCompare(b.file) || a.startLine - b.startLine);

  // Group by exact file path
  const byFile = new Map<string, Node[]>();
  for (const sym of symbols) {
    if (!byFile.has(sym.file)) {
      byFile.set(sym.file, []);
    }
    byFile.get(sym.file)!.push(sym);
  }

  const lines: string[] = [
    `query: "${path}"`,
    `total_symbols: ${symbols.length}`,
    `files_matched: ${byFile.size}`,
  ];

  for (const [file, fileSymbols] of byFile) {
    lines.push('');
    lines.push(`file: "${file}"`);
    lines.push('symbols:');

    for (const sym of fileSymbols) {
      lines.push(`  - name: "${sym.name}"`);
      lines.push(`    type: ${sym.type}`);
      lines.push(`    lines: ${sym.startLine}-${sym.endLine}`);
      lines.push(`    exported: ${sym.exported}`);
    }
  }

  return lines.join('\n');
}

