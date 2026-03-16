/**
 * Graph Type System
 *
 * Core types for the Recon knowledge graph.
 * Node ID conventions use namespaced prefixes to avoid collisions:
 *   Go:     go:pkg:, go:file:, go:func:, go:method:, go:struct:, go:iface:
 *   TS:     ts:mod:, ts:file:, ts:comp:, ts:func:, ts:type:
 *   Python: py:file:, py:func:, py:class:, py:method:
 *   Rust:   rs:file:, rs:func:, rs:struct:, rs:trait:, rs:impl:, rs:enum:
 *   Java:   java:file:, java:func:, java:class:, java:iface:, java:enum:
 *   C:      c:file:, c:func:, c:struct:, c:enum:
 *   C++:    cpp:file:, cpp:func:, cpp:class:, cpp:struct:, cpp:enum:
 *   Ruby:   rb:file:, rb:func:, rb:class:, rb:method:
 *   PHP:    php:file:, php:func:, php:class:, php:iface:
 *   C#:     cs:file:, cs:func:, cs:class:, cs:iface:, cs:enum:
 *   Kotlin: kt:file:, kt:func:, kt:class:, kt:iface:, kt:enum:
 *   Swift:  swift:file:, swift:func:, swift:class:, swift:struct:, swift:enum:
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
  Class = 'Class',
  Enum = 'Enum',
  Trait = 'Trait',
}

export enum RelationshipType {
  CONTAINS = 'CONTAINS',       // Package/Module → File
  DEFINES = 'DEFINES',         // File → Symbol
  CALLS = 'CALLS',             // Function → Function
  IMPORTS = 'IMPORTS',         // Package → Package
  HAS_METHOD = 'HAS_METHOD',  // Struct/Class → Method
  IMPLEMENTS = 'IMPLEMENTS',   // Struct → Interface / Class → Trait
  USES_COMPONENT = 'USES_COMPONENT', // Component → Component
  CALLS_API = 'CALLS_API',    // TS Function → Go Function (cross-language)
  EXTENDS = 'EXTENDS',        // Class → Class (inheritance)
}

export enum Language {
  Go = 'go',
  TypeScript = 'typescript',
  Python = 'python',
  Rust = 'rust',
  Java = 'java',
  C = 'c',
  Cpp = 'cpp',
  Ruby = 'ruby',
  PHP = 'php',
  CSharp = 'csharp',
  Kotlin = 'kotlin',
  Swift = 'swift',
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
  repo?: string;            // Multi-repo: which repo this node belongs to

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
