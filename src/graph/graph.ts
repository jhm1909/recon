/**
 * KnowledgeGraph
 *
 * In-memory graph store using Maps + adjacency index.
 * Inspired by GitNexus's graph.ts but without Cypher — uses direct Map lookups.
 */

import type {
  Node,
  Relationship,
  RelationshipType,
  SerializedGraph,
} from './types.js';

export class KnowledgeGraph {
  // Primary storage
  readonly nodes = new Map<string, Node>();
  readonly relationships = new Map<string, Relationship>();

  // Adjacency index for O(1) neighbor lookups
  private _incoming = new Map<string, Relationship[]>();
  private _outgoing = new Map<string, Relationship[]>();

  // ─── Mutations ──────────────────────────────────────────────

  addNode(node: Node): void {
    this.nodes.set(node.id, node);
  }

  addRelationship(rel: Relationship): void {
    this.relationships.set(rel.id, rel);
    this._addToAdjacency(rel);
  }

  removeNodesByFile(file: string): number {
    const nodeIdsToRemove = new Set<string>();

    // Find all nodes in the file
    for (const [id, node] of this.nodes) {
      if (node.file === file) {
        nodeIdsToRemove.add(id);
      }
    }

    if (nodeIdsToRemove.size === 0) return 0;

    // Remove relationships connected to these nodes
    const relIdsToRemove: string[] = [];
    for (const [id, rel] of this.relationships) {
      if (nodeIdsToRemove.has(rel.sourceId) || nodeIdsToRemove.has(rel.targetId)) {
        relIdsToRemove.push(id);
      }
    }

    for (const id of relIdsToRemove) {
      this.relationships.delete(id);
    }

    // Remove nodes
    for (const id of nodeIdsToRemove) {
      this.nodes.delete(id);
    }

    // Rebuild adjacency index (simpler than partial updates for deletion)
    this.buildAdjacencyIndex();

    return nodeIdsToRemove.size;
  }

  // ─── Queries ────────────────────────────────────────────────

  getNode(id: string): Node | undefined {
    return this.nodes.get(id);
  }

  findByName(name: string): Node[] {
    const lower = name.toLowerCase();
    const results: Node[] = [];

    for (const node of this.nodes.values()) {
      if (node.name.toLowerCase() === lower) {
        results.push(node);
      }
    }

    return results;
  }

  getIncoming(nodeId: string, type?: RelationshipType): Relationship[] {
    const rels = this._incoming.get(nodeId) || [];
    if (!type) return rels;
    return rels.filter(r => r.type === type);
  }

  getOutgoing(nodeId: string, type?: RelationshipType): Relationship[] {
    const rels = this._outgoing.get(nodeId) || [];
    if (!type) return rels;
    return rels.filter(r => r.type === type);
  }

  getRelationship(id: string): Relationship | undefined {
    return this.relationships.get(id);
  }

  *allRelationships(): Iterable<Relationship> {
    yield* this.relationships.values();
  }

  // ─── Stats ──────────────────────────────────────────────────

  get nodeCount(): number {
    return this.nodes.size;
  }

  get relationshipCount(): number {
    return this.relationships.size;
  }

  // ─── Adjacency Index ───────────────────────────────────────

  buildAdjacencyIndex(): void {
    this._incoming = new Map();
    this._outgoing = new Map();

    for (const rel of this.relationships.values()) {
      this._addToAdjacency(rel);
    }
  }

  private _addToAdjacency(rel: Relationship): void {
    // Outgoing: sourceId → rel
    const out = this._outgoing.get(rel.sourceId);
    if (out) {
      out.push(rel);
    } else {
      this._outgoing.set(rel.sourceId, [rel]);
    }

    // Incoming: targetId → rel
    const inc = this._incoming.get(rel.targetId);
    if (inc) {
      inc.push(rel);
    } else {
      this._incoming.set(rel.targetId, [rel]);
    }
  }

  // ─── Serialization ─────────────────────────────────────────

  serialize(): SerializedGraph {
    return {
      nodes: Array.from(this.nodes.values()),
      relationships: Array.from(this.relationships.values()),
    };
  }

  static deserialize(data: SerializedGraph): KnowledgeGraph {
    const graph = new KnowledgeGraph();

    for (const node of data.nodes) {
      graph.nodes.set(node.id, node);
    }

    for (const rel of data.relationships) {
      graph.relationships.set(rel.id, rel);
    }

    graph.buildAdjacencyIndex();
    return graph;
  }
}
