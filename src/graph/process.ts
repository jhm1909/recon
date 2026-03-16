/**
 * Process/Flow Detection
 *
 * Traces execution flows by walking CALLS/CALLS_API edges from entry points.
 * Entry points are exported functions, HTTP handler methods, and main-like symbols.
 * Each flow is a chain of symbols from entry to leaf, ranked by complexity.
 */

import type { KnowledgeGraph } from './graph.js';
import { NodeType, RelationshipType } from './types.js';
import type { Node } from './types.js';

// ─── Types ──────────────────────────────────────────────────────

export interface ProcessStep {
  name: string;
  type: string;
  file: string;
  line: number;
  depth: number;
}

export interface Process {
  name: string;
  entryPoint: {
    name: string;
    type: string;
    file: string;
    line: number;
    language: string;
    package: string;
  };
  steps: ProcessStep[];
  complexity: number; // chain length × max fan-out
  depth: number;      // max depth reached
}

// ─── Entry Point Detection ──────────────────────────────────────

/**
 * Identify entry point nodes in the graph.
 * Entry points are:
 * - Exported functions/methods (potential API handlers)
 * - Functions with no incoming CALLS edges (roots of call chains)
 * - HTTP handler methods (in handler/api packages)
 */
function findEntryPoints(graph: KnowledgeGraph): Node[] {
  const entryPoints: Node[] = [];

  for (const node of graph.nodes.values()) {
    // Skip structural nodes
    if (node.type === NodeType.Package || node.type === NodeType.File) continue;
    // Skip non-callable types
    if (node.type === NodeType.Enum || node.type === NodeType.Trait) continue;

    // Check if this node has outgoing CALLS/CALLS_API edges (it calls something)
    const outgoing = graph.getOutgoing(node.id).filter(
      r => r.type === RelationshipType.CALLS || r.type === RelationshipType.CALLS_API,
    );
    if (outgoing.length === 0) continue; // Leaf node — not an interesting entry point

    // Check if this is an entry point
    const incoming = graph.getIncoming(node.id).filter(
      r => r.type === RelationshipType.CALLS || r.type === RelationshipType.CALLS_API,
    );

    const isRoot = incoming.length === 0;
    const isHandler = node.file.includes('handler') || node.file.includes('api/');
    const isExportedFunc = node.exported && (
      node.type === NodeType.Function ||
      node.type === NodeType.Method
    );

    if (isRoot || isHandler || isExportedFunc) {
      entryPoints.push(node);
    }
  }

  return entryPoints;
}

// ─── Process Tracing ────────────────────────────────────────────

/**
 * Trace a single execution flow from an entry point.
 * BFS walk of CALLS/CALLS_API edges. Avoids cycles.
 */
function traceProcess(
  graph: KnowledgeGraph,
  entryPoint: Node,
  maxDepth: number = 10,
): Process {
  const steps: ProcessStep[] = [];
  const visited = new Set<string>([entryPoint.id]);
  let frontier = [entryPoint.id];
  let maxFanOut = 0;
  let currentDepth = 0;

  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const nextFrontier: string[] = [];
    let fanOut = 0;

    for (const nodeId of frontier) {
      const outgoing = graph.getOutgoing(nodeId).filter(
        r => r.type === RelationshipType.CALLS || r.type === RelationshipType.CALLS_API,
      );

      for (const edge of outgoing) {
        const targetId = edge.targetId;
        if (visited.has(targetId)) continue;

        const target = graph.getNode(targetId);
        if (!target) continue;
        // Skip structural nodes
        if (target.type === NodeType.Package || target.type === NodeType.File) continue;

        visited.add(targetId);
        nextFrontier.push(targetId);
        fanOut++;

        steps.push({
          name: target.name,
          type: target.type,
          file: target.file,
          line: target.startLine,
          depth,
        });
      }
    }

    if (fanOut > maxFanOut) maxFanOut = fanOut;
    if (nextFrontier.length > 0) currentDepth = depth;
    frontier = nextFrontier;
  }

  // Complexity = total steps × (1 + max fan-out / 10) to weight breadth
  const complexity = steps.length * (1 + maxFanOut / 10);

  return {
    name: buildProcessName(entryPoint),
    entryPoint: {
      name: entryPoint.name,
      type: entryPoint.type,
      file: entryPoint.file,
      line: entryPoint.startLine,
      language: entryPoint.language,
      package: entryPoint.package,
    },
    steps,
    complexity: Math.round(complexity * 10) / 10,
    depth: currentDepth,
  };
}

/**
 * Build a readable process name from the entry point.
 */
function buildProcessName(node: Node): string {
  if (node.receiver) {
    return `${node.receiver}.${node.name}`;
  }
  return node.name;
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Detect all execution flows in the graph.
 * Returns processes sorted by complexity (highest first).
 */
export function detectProcesses(
  graph: KnowledgeGraph,
  options?: { limit?: number; filter?: string },
): Process[] {
  const limit = options?.limit ?? 20;
  const filter = options?.filter?.toLowerCase();

  const entryPoints = findEntryPoints(graph);

  let processes: Process[] = [];
  for (const entry of entryPoints) {
    const process = traceProcess(graph, entry);
    // Only include processes with at least one step
    if (process.steps.length === 0) continue;
    processes.push(process);
  }

  // Apply name filter
  if (filter) {
    processes = processes.filter(
      p => p.name.toLowerCase().includes(filter),
    );
  }

  // Sort by complexity descending
  processes.sort((a, b) => b.complexity - a.complexity);

  return processes.slice(0, limit);
}

/**
 * Get a single process by name.
 */
export function getProcess(
  graph: KnowledgeGraph,
  name: string,
): Process | null {
  // Find exact match first
  const entryPoints = findEntryPoints(graph);

  for (const entry of entryPoints) {
    const processName = buildProcessName(entry);
    if (processName === name || processName.toLowerCase() === name.toLowerCase()) {
      const process = traceProcess(graph, entry);
      if (process.steps.length > 0) return process;
    }
  }

  // Fuzzy match
  for (const entry of entryPoints) {
    const processName = buildProcessName(entry);
    if (processName.toLowerCase().includes(name.toLowerCase())) {
      const process = traceProcess(graph, entry);
      if (process.steps.length > 0) return process;
    }
  }

  return null;
}
