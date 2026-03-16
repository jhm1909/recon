/**
 * Text Generator for Embeddings
 *
 * Converts graph nodes into structured text suitable for embedding.
 * Each node produces a document like:
 *
 *   Function: getUserById
 *   Package: internal/auth
 *   File: auth/users.go
 *   Exported: true
 *
 * This structured format helps embedding models distinguish between
 * symbol names, packages, and file locations.
 */

import type { Node } from '../graph/types.js';
import { NodeType } from '../graph/types.js';

/**
 * Node types eligible for embedding.
 * Skips Package and File nodes (structural, not meaningful for search).
 */
const EMBEDDABLE_TYPES = new Set<NodeType>([
  NodeType.Function,
  NodeType.Method,
  NodeType.Struct,
  NodeType.Interface,
  NodeType.Component,
  NodeType.Type,
  NodeType.Class,
  NodeType.Enum,
  NodeType.Trait,
  NodeType.Module,
]);

/**
 * Check if a node should be embedded.
 */
export function isEmbeddable(node: Node): boolean {
  return EMBEDDABLE_TYPES.has(node.type);
}

/**
 * Generate structured text from a node for embedding.
 */
export function generateEmbeddingText(node: Node): string {
  const parts: string[] = [];

  // Type and name
  parts.push(`${node.type}: ${node.name}`);

  // Package/module
  if (node.package) {
    parts.push(`Package: ${node.package}`);
  }

  // File location
  if (node.file) {
    parts.push(`File: ${node.file}`);
  }

  // Language
  parts.push(`Language: ${node.language}`);

  // Exported status
  if (node.exported) {
    parts.push('Exported: true');
  }

  // Go-specific metadata
  if (node.receiver) {
    parts.push(`Receiver: ${node.receiver}`);
  }
  if (node.params && node.params.length > 0) {
    parts.push(`Params: ${node.params.join(', ')}`);
  }
  if (node.returnType) {
    parts.push(`Returns: ${node.returnType}`);
  }
  if (node.fields && node.fields.length > 0) {
    parts.push(`Fields: ${node.fields.join(', ')}`);
  }
  if (node.methodSignatures && node.methodSignatures.length > 0) {
    parts.push(`Methods: ${node.methodSignatures.join(', ')}`);
  }

  // TS-specific
  if (node.props && node.props.length > 0) {
    parts.push(`Props: ${node.props.join(', ')}`);
  }

  return parts.join('\n');
}
