/**
 * Graph Exporter — Mermaid format output
 *
 * Converts Recon's KnowledgeGraph into Mermaid
 * for use in PRs, docs, README, and architecture diagrams.
 */

import type { Node, Relationship, RelationshipType as RelType } from '../graph/types.js';
import { NodeType, RelationshipType } from '../graph/types.js';
import type { KnowledgeGraph } from '../graph/graph.js';

// ─── Types ──────────────────────────────────────────────────────

export type ExportFormat = 'mermaid';

export interface ExportOptions {
  format: ExportFormat;
  package?: string;          // Filter by package name
  types?: NodeType[];         // Filter by node types
  symbol?: string;           // Ego graph around symbol
  depth?: number;            // Max hops from symbol (default: 2)
  edges?: RelType[];         // Filter by edge types
  limit?: number;            // Max nodes (default: 50)
  skipFiles?: boolean;       // Skip File nodes (default: true)
  direction?: 'TD' | 'LR';  // Graph direction (default: TD)
}

// ─── Node Colors ────────────────────────────────────────────────

const NODE_COLORS: Record<NodeType, string> = {
  [NodeType.Function]: '#4ade80',
  [NodeType.Method]: '#4ade80',
  [NodeType.Interface]: '#a78bfa',
  [NodeType.Class]: '#60a5fa',
  [NodeType.Component]: '#f472b6',
  [NodeType.Type]: '#fbbf24',
  [NodeType.Struct]: '#60a5fa',
  [NodeType.Enum]: '#fb923c',
  [NodeType.Trait]: '#a78bfa',
  [NodeType.Module]: '#94a3b8',
  [NodeType.Package]: '#94a3b8',
  [NodeType.File]: '#64748b',
};

const NODE_EMOJI: Record<NodeType, string> = {
  [NodeType.Function]: 'f',
  [NodeType.Method]: 'f',
  [NodeType.Interface]: '◆',
  [NodeType.Class]: '●',
  [NodeType.Component]: '◇',
  [NodeType.Type]: '▲',
  [NodeType.Struct]: '●',
  [NodeType.Enum]: '■',
  [NodeType.Trait]: '◆',
  [NodeType.Module]: '□',
  [NodeType.Package]: '□',
  [NodeType.File]: '📄',
};

// ─── Filter & Subgraph Extraction ───────────────────────────────

/**
 * Extract a filtered subgraph from the full knowledge graph.
 */
export function filterGraph(
  graph: KnowledgeGraph,
  options: ExportOptions,
): { nodes: Node[]; rels: Relationship[] } {
  const limit = options.limit ?? 50;
  const skipFiles = options.skipFiles ?? true;

  let candidateNodes: Node[] = [];
  let candidateRels: Relationship[] = [];

  // Ego graph mode: BFS from a specific symbol
  if (options.symbol) {
    const depth = options.depth ?? 2;
    const symbolLower = options.symbol.toLowerCase();
    const startNodes = Array.from(graph.nodes.values()).filter(
      n => n.name.toLowerCase().includes(symbolLower),
    );

    if (startNodes.length === 0) {
      return { nodes: [], rels: [] };
    }

    // BFS
    const visited = new Set<string>();
    let frontier = new Set<string>(startNodes.map(n => n.id));

    for (let d = 0; d <= depth; d++) {
      for (const nodeId of frontier) {
        visited.add(nodeId);
      }
      if (d === depth) break;

      const nextFrontier = new Set<string>();
      for (const nodeId of frontier) {
        for (const rel of graph.getOutgoing(nodeId)) {
          if (!visited.has(rel.targetId)) nextFrontier.add(rel.targetId);
        }
        for (const rel of graph.getIncoming(nodeId)) {
          if (!visited.has(rel.sourceId)) nextFrontier.add(rel.sourceId);
        }
      }
      frontier = nextFrontier;
    }

    candidateNodes = Array.from(visited)
      .map(id => graph.getNode(id))
      .filter((n): n is Node => !!n);
  } else {
    candidateNodes = Array.from(graph.nodes.values());
  }

  // Apply filters
  if (skipFiles) {
    candidateNodes = candidateNodes.filter(n => n.type !== NodeType.File);
  }

  if (options.package) {
    const pkg = options.package.toLowerCase();
    candidateNodes = candidateNodes.filter(n => n.package.toLowerCase().includes(pkg));
  }

  if (options.types && options.types.length > 0) {
    const typeSet = new Set(options.types);
    candidateNodes = candidateNodes.filter(n => typeSet.has(n.type));
  }

  // Skip Package nodes by default (structural)
  candidateNodes = candidateNodes.filter(n => n.type !== NodeType.Package);

  // Limit
  candidateNodes = candidateNodes.slice(0, limit);

  // Build node ID set for edge filtering
  const nodeIds = new Set(candidateNodes.map(n => n.id));

  // Collect edges between visible nodes
  for (const rel of graph.relationships.values()) {
    if (nodeIds.has(rel.sourceId) && nodeIds.has(rel.targetId)) {
      if (options.edges && options.edges.length > 0) {
        if (!options.edges.includes(rel.type)) continue;
      }
      // Skip structural edges unless requested
      if (rel.type === RelationshipType.CONTAINS || rel.type === RelationshipType.DEFINES) {
        if (!options.edges || !options.edges.includes(rel.type)) continue;
      }
      candidateRels.push(rel);
    }
  }

  return { nodes: candidateNodes, rels: candidateRels };
}

// ─── Mermaid Generator ──────────────────────────────────────────

/**
 * Sanitize node name for Mermaid IDs (no special chars).
 */
function mermaidId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Generate Mermaid flowchart from filtered graph.
 */
export function toMermaid(
  nodes: Node[],
  rels: Relationship[],
  direction: 'TD' | 'LR' = 'TD',
): string {
  if (nodes.length === 0) return '```mermaid\ngraph TD\n  empty["No nodes match filter"]\n```';

  const lines: string[] = [`graph ${direction}`];

  // Group nodes by package → subgraphs
  const packages = new Map<string, Node[]>();
  for (const node of nodes) {
    const pkg = node.package || 'root';
    if (!packages.has(pkg)) packages.set(pkg, []);
    packages.get(pkg)!.push(node);
  }

  // Class definitions for styling
  const typeClasses = new Map<NodeType, string[]>();

  for (const [pkg, pkgNodes] of packages) {
    lines.push(`    subgraph ${mermaidId(pkg)}["${pkg}"]`);
    for (const node of pkgNodes) {
      const emoji = NODE_EMOJI[node.type] || '';
      const mid = mermaidId(node.id);
      lines.push(`        ${mid}["${emoji} ${node.name}"]`);

      // Track for class styling
      if (!typeClasses.has(node.type)) typeClasses.set(node.type, []);
      typeClasses.get(node.type)!.push(mid);
    }
    lines.push('    end');
  }

  // Edges
  for (const rel of rels) {
    const src = mermaidId(rel.sourceId);
    const tgt = mermaidId(rel.targetId);

    switch (rel.type) {
      case RelationshipType.CALLS:
      case RelationshipType.CALLS_API:
        lines.push(`    ${src} -->|${rel.type}| ${tgt}`);
        break;
      case RelationshipType.EXTENDS:
      case RelationshipType.IMPLEMENTS:
        lines.push(`    ${src} -.->|${rel.type}| ${tgt}`);
        break;
      case RelationshipType.IMPORTS:
        lines.push(`    ${src} -->|imports| ${tgt}`);
        break;
      case RelationshipType.HAS_METHOD:
        lines.push(`    ${src} -->|has| ${tgt}`);
        break;
      default:
        lines.push(`    ${src} --> ${tgt}`);
    }
  }

  // classDef for node type colors
  for (const [type, color] of Object.entries(NODE_COLORS)) {
    const ids = typeClasses.get(type as NodeType);
    if (ids && ids.length > 0) {
      const safeName = (type as string).toLowerCase();
      lines.push(`    classDef ${safeName} fill:${color},color:#000,stroke:${color}`);
      lines.push(`    class ${ids.join(',')} ${safeName}`);
    }
  }

  return lines.join('\n');
}

// ─── Main Export Function ───────────────────────────────────────

/**
 * Export the knowledge graph in Mermaid format.
 */
export function exportGraph(graph: KnowledgeGraph, options: ExportOptions): string {
  const { nodes, rels } = filterGraph(graph, options);
  const direction = options.direction ?? 'TD';

  return toMermaid(nodes, rels, direction);
}
