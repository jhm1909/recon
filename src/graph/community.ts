/**
 * Community Detection — Label Propagation
 *
 * Groups densely connected symbols into communities/modules using
 * the Label Propagation Algorithm (LPA). Each node is initialized
 * with a unique label, then iteratively adopts the most frequent
 * label among its neighbors. Converges in ~5-10 iterations.
 */

import type { KnowledgeGraph } from './graph.js';
import { NodeType } from './types.js';

export interface CommunityStats {
  communityCount: number;
  iterations: number;
  largestCommunity: { label: string; size: number };
}

/**
 * Run label propagation on the graph. Assigns a `community` label
 * to every non-Package/File node. Returns summary stats.
 *
 * Algorithm:
 *  1. Assign each eligible node a unique label (its own id).
 *  2. In each iteration, visit nodes in random order.
 *     Each node adopts the most frequent label among its neighbors
 *     (both incoming and outgoing edges). Ties broken by keeping
 *     the current label for stability.
 *  3. Stop when no labels change or maxIterations reached.
 */
export function detectCommunities(
  graph: KnowledgeGraph,
  maxIterations = 10,
): CommunityStats {
  // Collect eligible node ids (skip Package and File nodes — they're structural)
  const nodeIds: string[] = [];
  for (const node of graph.nodes.values()) {
    if (node.type === NodeType.Package || node.type === NodeType.File) continue;
    nodeIds.push(node.id);
  }

  if (nodeIds.length === 0) {
    return { communityCount: 0, iterations: 0, largestCommunity: { label: '', size: 0 } };
  }

  // Step 1: Initialize each node with its own id as label
  const labels = new Map<string, string>();
  for (const id of nodeIds) {
    labels.set(id, id);
  }

  // Step 2: Iterate
  let iterations = 0;
  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;

    // Shuffle node visit order for better convergence
    const shuffled = shuffleArray(nodeIds);

    for (const nodeId of shuffled) {
      // Collect neighbor labels (undirected: both incoming and outgoing)
      const incoming = graph.getIncoming(nodeId);
      const outgoing = graph.getOutgoing(nodeId);

      const neighborLabels: string[] = [];
      for (const rel of incoming) {
        const label = labels.get(rel.sourceId);
        if (label !== undefined) {
          neighborLabels.push(label);
        }
      }
      for (const rel of outgoing) {
        const label = labels.get(rel.targetId);
        if (label !== undefined) {
          neighborLabels.push(label);
        }
      }

      if (neighborLabels.length === 0) continue;

      // Find most frequent label
      const bestLabel = mostFrequentLabel(neighborLabels, labels.get(nodeId)!);

      if (bestLabel !== labels.get(nodeId)) {
        labels.set(nodeId, bestLabel);
        changed = true;
      }
    }

    iterations++;
    if (!changed) break;
  }

  // Step 3: Assign community labels to nodes, using readable names
  const labelToName = buildCommunityNames(labels, graph);

  for (const [nodeId, label] of labels) {
    const node = graph.getNode(nodeId);
    if (node) {
      node.community = labelToName.get(label) || label;
    }
  }

  // Compute stats
  const communitySizes = new Map<string, number>();
  for (const label of labels.values()) {
    const name = labelToName.get(label) || label;
    communitySizes.set(name, (communitySizes.get(name) || 0) + 1);
  }

  let largestLabel = '';
  let largestSize = 0;
  for (const [label, size] of communitySizes) {
    if (size > largestSize) {
      largestSize = size;
      largestLabel = label;
    }
  }

  return {
    communityCount: communitySizes.size,
    iterations,
    largestCommunity: { label: largestLabel, size: largestSize },
  };
}

/**
 * Find the most frequent label in a list. If there's a tie with
 * the current label, keep the current one for stability.
 */
function mostFrequentLabel(labels: string[], currentLabel: string): string {
  const counts = new Map<string, number>();
  for (const l of labels) {
    counts.set(l, (counts.get(l) || 0) + 1);
  }

  let bestLabel = currentLabel;
  let bestCount = 0;

  for (const [label, count] of counts) {
    if (count > bestCount || (count === bestCount && label === currentLabel)) {
      bestCount = count;
      bestLabel = label;
    }
  }

  return bestLabel;
}

/**
 * Build readable community names from the label map.
 * Uses the most common package among nodes in each community as the name.
 */
function buildCommunityNames(
  labels: Map<string, string>,
  graph: KnowledgeGraph,
): Map<string, string> {
  // Group node ids by label
  const labelGroups = new Map<string, string[]>();
  for (const [nodeId, label] of labels) {
    const group = labelGroups.get(label);
    if (group) {
      group.push(nodeId);
    } else {
      labelGroups.set(label, [nodeId]);
    }
  }

  const labelToName = new Map<string, string>();
  const usedNames = new Set<string>();

  for (const [label, nodeIds] of labelGroups) {
    // Find most common package in this community
    const pkgCounts = new Map<string, number>();
    for (const id of nodeIds) {
      const node = graph.getNode(id);
      if (node) {
        const pkg = node.package || 'unknown';
        pkgCounts.set(pkg, (pkgCounts.get(pkg) || 0) + 1);
      }
    }

    let bestPkg = 'unknown';
    let bestCount = 0;
    for (const [pkg, count] of pkgCounts) {
      if (count > bestCount) {
        bestCount = count;
        bestPkg = pkg;
      }
    }

    // Deduplicate names with a suffix
    let name = bestPkg;
    if (usedNames.has(name)) {
      let i = 2;
      while (usedNames.has(`${name}#${i}`)) i++;
      name = `${name}#${i}`;
    }
    usedNames.add(name);
    labelToName.set(label, name);
  }

  return labelToName;
}

/**
 * Fisher-Yates shuffle (returns new array).
 */
function shuffleArray<T>(arr: T[]): T[] {
  const result = arr.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
