/**
 * MCP Resources
 *
 * Provides structured on-demand data to AI agents via recon:// URIs.
 * Static resources have fixed URIs; dynamic resources use URI templates.
 */

import { KnowledgeGraph } from '../graph/graph.js';
import { NodeType, RelationshipType } from '../graph/types.js';
import type { Node } from '../graph/types.js';
import { getProcess } from '../graph/process.js';

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
      uri: 'recon://packages',
      name: 'Package Map',
      description: 'All packages (Go) and modules (TypeScript) with dependency counts.',
      mimeType: 'text/yaml',
    },
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
    {
      uriTemplate: 'recon://process/{name}',
      name: 'Process Trace',
      description: 'Step-by-step execution trace of a detected process/flow.',
      mimeType: 'text/yaml',
    },
  ];
}

// ─── URI Parsing ────────────────────────────────────────────────

interface ParsedUri {
  resourceType: 'packages' | 'stats' | 'symbol' | 'file' | 'process';
  param?: string;
}

export function parseUri(uri: string): ParsedUri {
  if (uri === 'recon://packages') return { resourceType: 'packages' };
  if (uri === 'recon://stats') return { resourceType: 'stats' };

  const symbolMatch = uri.match(/^recon:\/\/symbol\/(.+)$/);
  if (symbolMatch) {
    return { resourceType: 'symbol', param: decodeURIComponent(symbolMatch[1]) };
  }

  const fileMatch = uri.match(/^recon:\/\/file\/(.+)$/);
  if (fileMatch) {
    return { resourceType: 'file', param: decodeURIComponent(fileMatch[1]) };
  }

  const processMatch = uri.match(/^recon:\/\/process\/(.+)$/);
  if (processMatch) {
    return { resourceType: 'process', param: decodeURIComponent(processMatch[1]) };
  }

  throw new Error(`Unknown resource URI: ${uri}`);
}

// ─── Read Resource ──────────────────────────────────────────────

export function readResource(uri: string, graph: KnowledgeGraph): string {
  const parsed = parseUri(uri);

  switch (parsed.resourceType) {
    case 'packages':
      return getPackagesResource(graph);
    case 'stats':
      return getStatsResource(graph);
    case 'symbol':
      return getSymbolResource(graph, parsed.param!);
    case 'file':
      return getFileResource(graph, parsed.param!);
    case 'process':
      return getProcessResource(graph, parsed.param!);
  }
}

// ─── Resource Implementations ───────────────────────────────────

function getPackagesResource(graph: KnowledgeGraph): string {
  const packages: Node[] = [];
  for (const node of graph.nodes.values()) {
    if (node.type === NodeType.Package || node.type === NodeType.Module) {
      packages.push(node);
    }
  }

  if (packages.length === 0) {
    return 'packages: []\n# No packages indexed. Run: recon index';
  }

  packages.sort((a, b) => a.name.localeCompare(b.name));

  const lines: string[] = [`package_count: ${packages.length}`, '', 'packages:'];

  for (const pkg of packages) {
    const outgoing = graph.getOutgoing(pkg.id);
    const incoming = graph.getIncoming(pkg.id);
    const imports = outgoing.filter(r => r.type === RelationshipType.IMPORTS);
    const importedBy = incoming.filter(r => r.type === RelationshipType.IMPORTS);

    lines.push(`  - name: "${pkg.name}"`);
    lines.push(`    type: ${pkg.type}`);
    lines.push(`    language: ${pkg.language}`);
    if (pkg.importPath) {
      lines.push(`    import_path: "${pkg.importPath}"`);
    }
    lines.push(`    imports: ${imports.length}`);
    lines.push(`    imported_by: ${importedBy.length}`);
    if (pkg.files && pkg.files.length > 0) {
      lines.push(`    files: ${pkg.files.length}`);
    }
  }

  return lines.join('\n');
}

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

function getProcessResource(graph: KnowledgeGraph, name: string): string {
  const process = getProcess(graph, name);

  if (!process) {
    return `error: Process "${name}" not found`;
  }

  const lines: string[] = [
    `name: "${process.name}"`,
    `complexity: ${process.complexity}`,
    `depth: ${process.depth}`,
    `total_steps: ${process.steps.length}`,
    '',
    'entry_point:',
    `  name: "${process.entryPoint.name}"`,
    `  type: ${process.entryPoint.type}`,
    `  file: "${process.entryPoint.file}"`,
    `  line: ${process.entryPoint.line}`,
    `  language: ${process.entryPoint.language}`,
    `  package: "${process.entryPoint.package}"`,
  ];

  if (process.steps.length > 0) {
    lines.push('');
    lines.push('steps:');

    // Group steps by depth
    const byDepth = new Map<number, typeof process.steps>();
    for (const step of process.steps) {
      if (!byDepth.has(step.depth)) byDepth.set(step.depth, []);
      byDepth.get(step.depth)!.push(step);
    }

    for (const [depth, steps] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
      lines.push(`  # depth ${depth}`);
      for (const step of steps) {
        lines.push(`  - name: "${step.name}"`);
        lines.push(`    type: ${step.type}`);
        lines.push(`    file: "${step.file}"`);
        lines.push(`    line: ${step.line}`);
        lines.push(`    depth: ${step.depth}`);
      }
    }
  }

  return lines.join('\n');
}
