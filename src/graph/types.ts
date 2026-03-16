/**
 * Graph Type System
 *
 * Core types for the Recon knowledge graph.
 * Node ID conventions use namespaced prefixes to avoid collisions:
 *   Go:  go:pkg:, go:file:, go:func:, go:method:, go:struct:, go:iface:
 *   TS:  ts:mod:, ts:file:, ts:comp:, ts:func:, ts:type:
 */

// ─── Enums ──────────────────────────────────────────────────────

export enum NodeType {
  Package = 'Package',
  File = 'File',
  Function = 'Function',
  Method = 'Method',
  Struct = 'Struct',
  Interface = 'Interface',
  Module = 'Module',
  Component = 'Component',
  Type = 'Type',
}

export enum RelationshipType {
  CONTAINS = 'CONTAINS',       // Package/Module → File
  DEFINES = 'DEFINES',         // File → Symbol
  CALLS = 'CALLS',             // Function → Function
  IMPORTS = 'IMPORTS',         // Package → Package
  HAS_METHOD = 'HAS_METHOD',  // Struct → Method
  IMPLEMENTS = 'IMPLEMENTS',   // Struct → Interface
  USES_COMPONENT = 'USES_COMPONENT', // Component → Component
  CALLS_API = 'CALLS_API',    // TS Function → Go Function (cross-language)
}

export enum Language {
  Go = 'go',
  TypeScript = 'typescript',
}

// ─── Node ───────────────────────────────────────────────────────

export interface Node {
  id: string;
  type: NodeType;
  name: string;
  file: string;
  startLine: number;
  endLine: number;
  language: Language;
  package: string;
  exported: boolean;

  // Go-specific (optional)
  receiver?: string;       // Method receiver type
  params?: string[];       // Function/method parameters
  returnType?: string;     // Return type
  fields?: string[];       // Struct fields
  embeds?: string[];       // Struct embedded types
  methodSignatures?: string[]; // Interface method signatures

  // TS-specific (optional)
  isDefault?: boolean;     // Default export
  props?: string[];        // Component props

  // Package-specific (optional)
  importPath?: string;     // Go import path
  files?: string[];        // Files in package/module
  imports?: string[];      // Direct import paths
}

// ─── Relationship ───────────────────────────────────────────────

export interface Relationship {
  id: string;
  type: RelationshipType;
  sourceId: string;
  targetId: string;
  confidence: number; // 0.0 - 1.0 (1.0 = compiler-verified)
  metadata?: {
    httpMethod?: string;   // For CALLS_API
    urlPattern?: string;   // For CALLS_API
  };
}

// ─── Serialization ──────────────────────────────────────────────

export interface SerializedGraph {
  nodes: Node[];
  relationships: Relationship[];
}
