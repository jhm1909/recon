/**
 * Analyzer Types
 *
 * Shared interfaces for Go and TypeScript analyzers.
 */

import type { Node, Relationship } from '../graph/types.js';

// ─── Go Package (from `go list -json`) ──────────────────────────

export interface GoPackage {
  Dir: string;
  ImportPath: string;
  Name: string;
  GoFiles?: string[];
  Imports?: string[];
}

// ─── Go AST CLI output types ────────────────────────────────────

export interface GoASTResult {
  files: GoASTFile[];
}

export interface GoASTFile {
  path: string;
  functions: GoASTFunc[];
  methods: GoASTFunc[];
  structs: GoASTType[];
  interfaces: GoASTType[];
  calls: GoASTCall[];
}

export interface GoASTFunc {
  name: string;
  receiver?: string;
  params: string[];
  returns: string;
  startLine: number;
  endLine: number;
  exported: boolean;
}

export interface GoASTType {
  name: string;
  startLine: number;
  endLine: number;
  exported: boolean;
  fields?: string[];
  embeds?: string[];
  methods?: string[];
}

export interface GoASTCall {
  callerFunc: string;
  callerRecv?: string;
  callee: string;
  qualifier?: string;
  line: number;
}

// ─── Analyzer Result ────────────────────────────────────────────

export interface AnalyzerResult {
  nodes: Node[];
  relationships: Relationship[];
}
