/**
 * Process/Flow Detection
 *
 * Traces execution flows by walking CALLS/CALLS_API edges from scored entry points.
 * Inspired by GitNexus's process-processor.ts but adapted for Recon's architecture.
 *
 * Pipeline:
 *  1. Score entry points (call ratio × export × name patterns × penalty)
 *  2. BFS with path tracking → distinct paths per entry
 *  3. Deduplicate: subset removal + endpoint dedup
 *  4. Tag cross-community flows
 *  5. Rank by complexity
 */

import type { KnowledgeGraph } from './graph.js';
import { NodeType, RelationshipType } from './types.js';
import type { Node } from './types.js';
import { getEntryPointMultiplier } from '../analyzers/framework-detection.js';

// ─── Config ─────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  maxTraceDepth: 10,
  maxBranching: 4,
  maxProcesses: 75,
  minSteps: 2,             // 2+ = genuine flow (entry + callee)
  minTraceConfidence: 0.5, // Filter low-confidence CALLS edges
};

type ProcessConfig = typeof DEFAULT_CONFIG;

// ─── Types ──────────────────────────────────────────────────────

export interface ProcessStep {
  name: string;
  type: string;
  file: string;
  line: number;
  depth: number;
  community?: string;
}

export interface Process {
  name: string;
  label: string;           // "Entry → Terminal" format
  entryPoint: {
    name: string;
    type: string;
    file: string;
    line: number;
    language: string;
    package: string;
  };
  steps: ProcessStep[];
  trace: string[];          // Ordered node IDs
  complexity: number;
  depth: number;
  processType: 'intra_community' | 'cross_community';
  communities: string[];
}

// ─── Entry Point Scoring ────────────────────────────────────────

/**
 * Name patterns that boost entry point score (per-language).
 * Universal patterns apply to all languages.
 */
const ENTRY_PATTERNS: Record<string, RegExp[]> = {
  '*': [
    /^(main|init|bootstrap|start|run|setup|configure|app)$/i,
    /^handle[A-Z]/,           // handleLogin, handleSubmit
    /^on[A-Z]/,               // onClick, onSubmit
    /^(get|post|put|delete|patch)(Handler)?$/i,
    /^(create|register|subscribe|dispatch|emit)$/i,
    /Controller$/,
    /Handler$/,
    /Middleware$/,
    /Command$/,
    /Router$/,
  ],
  typescript: [
    /^use[A-Z]/,              // React hooks
    /^render[A-Z]/,
    /^app\./,
    /Server$/,
    /Route$/,
    /Plugin$/,
  ],
  python: [
    /^(cli|main|app|run)$/i,
    /_handler$/,
    /_view$/,
    /_command$/,
    /^test_/,  // test entry points (low weight)
  ],
  go: [
    /^(main|Run|Start|Serve|Listen)$/,
    /Handler$/,
    /^New[A-Z]/,
    /Server$/,
  ],
  java: [
    /^do(Get|Post|Put|Delete)$/,
    /^create[A-Z]/,
    /^build[A-Z]/,
    /Service$/,
    /Controller$/,
  ],
  rust: [
    /^(main|run|start|new)$/,
    /^handle_/,
    /_handler$/,
  ],
};

/**
 * Utility/helper patterns that REDUCE entry point score.
 */
const UTILITY_PATTERNS: RegExp[] = [
  /^(get|set|is|has|can|should|will|did)[A-Z]/,  // Accessors
  /^_/,              // Private by convention
  /^(to|from|as|into)[A-Z]/,  // Conversion
  /^(parse|format|validate|sanitize|normalize|encode|decode)/i,
  /Helper$/,
  /Util(s)?$/,
  /^(map|filter|reduce|find|some|every|forEach)$/,
  /^(log|debug|warn|error|trace|info)$/i,
];

/**
 * Test file detection.
 */
function isTestFile(file: string): boolean {
  return /\.(test|spec|_test)\.[^.]+$/.test(file) ||
    /[\\/](test|tests|__tests__|__test__|spec|specs)[\\/]/.test(file) ||
    /[\\/]fixtures?[\\/]/.test(file);
}

interface EntryPointCandidate {
  node: Node;
  score: number;
}

/**
 * Score and rank entry point candidates.
 *
 * Score = baseScore × exportMultiplier × nameMultiplier × penaltyMultiplier
 *   baseScore = callees / (callers + 1)  — functions that call many but are called by few
 *   exportMultiplier: exported = 1.5, non-exported = 0.8
 *   nameMultiplier: if matches ENTRY_PATTERNS = 2.0, else = 1.0
 *   penaltyMultiplier: if matches UTILITY_PATTERNS = 0.3, else = 1.0
 */
function scoreEntryPoints(
  graph: KnowledgeGraph,
  callsAdj: Map<string, string[]>,
  reverseAdj: Map<string, string[]>,
): EntryPointCandidate[] {
  const candidates: EntryPointCandidate[] = [];

  for (const node of graph.nodes.values()) {
    // Skip structural + non-callable
    if (node.type === NodeType.Package || node.type === NodeType.File) continue;
    if (node.type === NodeType.Enum || node.type === NodeType.Trait) continue;
    if (node.type === NodeType.Type || node.type === NodeType.Interface) continue;

    // Skip test files
    if (isTestFile(node.file)) continue;

    const callees = callsAdj.get(node.id) || [];
    if (callees.length === 0) continue; // Leaf — no outgoing calls

    const callers = reverseAdj.get(node.id) || [];

    // Base score: call ratio
    const baseScore = callees.length / (callers.length + 1);

    // Export multiplier
    const exportMult = node.exported ? 1.5 : 0.8;

    // Name pattern multiplier
    const lang = node.language || '*';
    const universalPatterns = ENTRY_PATTERNS['*'] || [];
    const langPatterns = ENTRY_PATTERNS[lang] || [];
    const allPatterns = [...universalPatterns, ...langPatterns];
    const matchesEntry = allPatterns.some(p => p.test(node.name));
    const nameMult = matchesEntry ? 2.0 : 1.0;

    // Utility penalty
    const matchesUtility = UTILITY_PATTERNS.some(p => p.test(node.name));
    const penaltyMult = matchesUtility ? 0.3 : 1.0;

    // Root bonus: no callers at all → strong entry point
    const rootBonus = callers.length === 0 ? 1.5 : 1.0;

    // Framework detection multiplier
    const framework = getEntryPointMultiplier(node.file, node.name);
    const frameworkMult = framework.multiplier;

    const score = baseScore * exportMult * nameMult * penaltyMult * rootBonus * frameworkMult;

    if (score > 0.1) { // Minimum threshold
      candidates.push({ node, score });
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  return candidates.slice(0, 200); // Limit to prevent explosion
}

// ─── Adjacency Building ─────────────────────────────────────────

function buildCallsAdjacency(
  graph: KnowledgeGraph,
  minConfidence: number,
): { forward: Map<string, string[]>; reverse: Map<string, string[]> } {
  const forward = new Map<string, string[]>();
  const reverse = new Map<string, string[]>();

  for (const rel of graph.allRelationships()) {
    if (rel.type !== RelationshipType.CALLS && rel.type !== RelationshipType.CALLS_API) continue;
    if (rel.confidence < minConfidence) continue;

    // Forward
    const fwd = forward.get(rel.sourceId);
    if (fwd) fwd.push(rel.targetId);
    else forward.set(rel.sourceId, [rel.targetId]);

    // Reverse
    const rev = reverse.get(rel.targetId);
    if (rev) rev.push(rel.sourceId);
    else reverse.set(rel.targetId, [rel.sourceId]);
  }

  return { forward, reverse };
}

// ─── Path Tracing ───────────────────────────────────────────────

/**
 * Trace distinct execution paths from an entry point using BFS.
 * Returns multiple paths (not a single flat list).
 */
function traceDistinctPaths(
  entryId: string,
  callsAdj: Map<string, string[]>,
  cfg: ProcessConfig,
): string[][] {
  const paths: string[][] = [];

  // BFS queue: [currentNode, pathSoFar]
  const queue: [string, string[]][] = [[entryId, [entryId]]];

  while (queue.length > 0 && paths.length < cfg.maxBranching * 3) {
    const [currentId, path] = queue.shift()!;
    const callees = callsAdj.get(currentId) || [];

    if (callees.length === 0 || path.length >= cfg.maxTraceDepth) {
      // Terminal or max depth — save path if long enough
      if (path.length >= cfg.minSteps) {
        paths.push(path);
      }
    } else {
      // Continue tracing — limit branching
      const limited = callees.slice(0, cfg.maxBranching);
      let addedBranch = false;

      for (const calleeId of limited) {
        if (!path.includes(calleeId)) { // Cycle detection
          queue.push([calleeId, [...path, calleeId]]);
          addedBranch = true;
        }
      }

      // All branches were cycles — save current path
      if (!addedBranch && path.length >= cfg.minSteps) {
        paths.push(path);
      }
    }
  }

  return paths;
}

// ─── Deduplication ──────────────────────────────────────────────

/**
 * Remove traces that are subsets of longer traces.
 */
function deduplicateSubsets(traces: string[][]): string[][] {
  if (traces.length === 0) return [];

  const sorted = [...traces].sort((a, b) => b.length - a.length);
  const unique: string[][] = [];

  for (const trace of sorted) {
    const key = trace.join('->');
    const isSubset = unique.some(existing => existing.join('->').includes(key));
    if (!isSubset) {
      unique.push(trace);
    }
  }

  return unique;
}

/**
 * Keep only the longest trace per unique entry→terminal pair.
 */
function deduplicateByEndpoints(traces: string[][]): string[][] {
  if (traces.length === 0) return [];

  const byEndpoint = new Map<string, string[]>();
  const sorted = [...traces].sort((a, b) => b.length - a.length);

  for (const trace of sorted) {
    const key = `${trace[0]}::${trace[trace.length - 1]}`;
    if (!byEndpoint.has(key)) {
      byEndpoint.set(key, trace);
    }
  }

  return Array.from(byEndpoint.values());
}

// ─── Process Building ───────────────────────────────────────────

function buildProcessName(entryNode: Node, terminalNode: Node | undefined): string {
  const entryName = capitalize(entryNode.name);
  const termName = terminalNode ? capitalize(terminalNode.name) : '';
  if (termName && termName !== entryName) {
    return `${entryName} → ${termName}`;
  }
  return entryName;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildProcess(
  trace: string[],
  graph: KnowledgeGraph,
): Process | null {
  const entryNode = graph.getNode(trace[0]);
  if (!entryNode) return null;

  const terminalNode = graph.getNode(trace[trace.length - 1]);

  // Build steps with depth info
  const steps: ProcessStep[] = [];
  const depthMap = new Map<string, number>();
  depthMap.set(trace[0], 0);

  for (let i = 1; i < trace.length; i++) {
    const nodeId = trace[i];
    const node = graph.getNode(nodeId);
    if (!node) continue;

    // Compute depth: parent depth + 1
    // Find the edge that led to this node
    let parentDepth = 0;
    for (let j = i - 1; j >= 0; j--) {
      const parentId = trace[j];
      const parentOutgoing = graph.getOutgoing(parentId, RelationshipType.CALLS);
      if (parentOutgoing.some(r => r.targetId === nodeId)) {
        parentDepth = (depthMap.get(parentId) || 0) + 1;
        break;
      }
    }
    depthMap.set(nodeId, parentDepth);

    steps.push({
      name: node.name,
      type: node.type,
      file: node.file,
      line: node.startLine,
      depth: parentDepth,
      community: node.community,
    });
  }

  if (steps.length === 0) return null;

  // Collect communities touched
  const communities = new Set<string>();
  if (entryNode.community) communities.add(entryNode.community);
  for (const step of steps) {
    if (step.community) communities.add(step.community);
  }

  const communityList = Array.from(communities);
  const processType: 'intra_community' | 'cross_community' =
    communityList.length > 1 ? 'cross_community' : 'intra_community';

  // Complexity = total steps × (1 + max_depth / 5) × cross_community_boost
  const maxDepth = Math.max(0, ...steps.map(s => s.depth));
  const crossBoost = processType === 'cross_community' ? 1.3 : 1.0;
  const complexity = Math.round(
    steps.length * (1 + maxDepth / 5) * crossBoost * 10,
  ) / 10;

  return {
    name: entryNode.receiver ? `${entryNode.receiver}.${entryNode.name}` : entryNode.name,
    label: buildProcessName(entryNode, terminalNode),
    entryPoint: {
      name: entryNode.name,
      type: entryNode.type,
      file: entryNode.file,
      line: entryNode.startLine,
      language: entryNode.language,
      package: entryNode.package,
    },
    steps,
    trace,
    complexity,
    depth: maxDepth,
    processType,
    communities: communityList,
  };
}

// ─── Fan-out Merge ──────────────────────────────────────────────

/**
 * Merge processes sharing the same entry point into one combined process.
 * Fan-out patterns (Init → Setup0, Init → Setup1, ...) become one process
 * with all steps. Multi-hop chains from different entries stay separate.
 */
function mergeByEntryPoint(processes: Process[]): Process[] {
  const groups = new Map<string, Process[]>();

  for (const proc of processes) {
    const key = proc.trace[0]; // entry point node ID
    const group = groups.get(key);
    if (group) group.push(proc);
    else groups.set(key, [proc]);
  }

  const merged: Process[] = [];

  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }

    // Merge: use the longest trace as base, add unique steps from others
    const base = group.sort((a, b) => b.steps.length - a.steps.length)[0];
    const seenSteps = new Set(base.steps.map(s => `${s.name}@${s.file}:${s.line}`));

    for (const other of group.slice(1)) {
      for (const step of other.steps) {
        const key = `${step.name}@${step.file}:${step.line}`;
        if (!seenSteps.has(key)) {
          seenSteps.add(key);
          base.steps.push(step);
        }
      }
      // Merge trace node IDs
      for (const nodeId of other.trace) {
        if (!base.trace.includes(nodeId)) {
          base.trace.push(nodeId);
        }
      }
      // Merge communities
      for (const comm of other.communities) {
        if (!base.communities.includes(comm)) {
          base.communities.push(comm);
        }
      }
    }

    // Recalculate type and complexity after merge
    base.processType = base.communities.length > 1 ? 'cross_community' : 'intra_community';
    const maxDepth = Math.max(0, ...base.steps.map(s => s.depth));
    const crossBoost = base.processType === 'cross_community' ? 1.3 : 1.0;
    base.complexity = Math.round(base.steps.length * (1 + maxDepth / 5) * crossBoost * 10) / 10;
    base.depth = maxDepth;

    // Update label to reflect fan-out
    if (group.length > 2) {
      const terminals = group.map(p => p.trace[p.trace.length - 1]);
      const uniqueTerminals = [...new Set(terminals)];
      if (uniqueTerminals.length > 1) {
        base.label = `${base.name} (${base.steps.length} branches)`;
      }
    }

    merged.push(base);
  }

  return merged;
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
  const limit = options?.limit ?? DEFAULT_CONFIG.maxProcesses;
  const filter = options?.filter?.toLowerCase();
  const cfg = { ...DEFAULT_CONFIG };

  // Step 1: Build adjacency lists with confidence filter
  const { forward, reverse } = buildCallsAdjacency(graph, cfg.minTraceConfidence);

  // Step 2: Score and rank entry points
  const candidates = scoreEntryPoints(graph, forward, reverse);

  // Step 3: Trace distinct paths from each entry point
  let allTraces: string[][] = [];

  for (const { node } of candidates) {
    if (allTraces.length >= cfg.maxProcesses * 2) break;
    const paths = traceDistinctPaths(node.id, forward, cfg);
    allTraces.push(...paths);
  }

  // Step 4: Deduplicate
  allTraces = deduplicateSubsets(allTraces);
  allTraces = deduplicateByEndpoints(allTraces);

  // Step 5: Build process objects
  let rawProcesses: Process[] = [];
  for (const trace of allTraces) {
    const proc = buildProcess(trace, graph);
    if (!proc) continue;
    rawProcesses.push(proc);
  }

  // Step 6: Merge processes sharing the same entry point (fan-out merge)
  let processes = mergeByEntryPoint(rawProcesses);

  // Apply name filter
  if (filter) {
    processes = processes.filter(
      p => p.name.toLowerCase().includes(filter) ||
        p.label.toLowerCase().includes(filter),
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
  const all = detectProcesses(graph, { limit: 100 });

  // Exact match
  for (const proc of all) {
    if (proc.name === name || proc.name.toLowerCase() === name.toLowerCase()) {
      return proc;
    }
  }

  // Fuzzy match
  for (const proc of all) {
    if (proc.name.toLowerCase().includes(name.toLowerCase())) {
      return proc;
    }
  }

  return null;
}
