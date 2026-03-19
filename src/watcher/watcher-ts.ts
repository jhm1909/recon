/**
 * Watcher — TypeScript File Analysis
 *
 * Extracted from watcher.ts for maintainability.
 * Provides single-file TypeScript analysis for the surgical update pipeline.
 */

import ts from 'typescript';
import { NodeType, RelationshipType, Language } from '../graph/types.js';
import type { KnowledgeGraph } from '../graph/graph.js';
import { readFileSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// ─── Types ──────────────────────────────────────────────────────

export interface WatcherSymbol {
  name: string;
  kind: 'component' | 'function' | 'type' | 'interface';
  isDefault: boolean;
  isExported: boolean;
  startLine: number;
  endLine: number;
}

export interface WatcherImport {
  specifier: string;
  names: string[];
  defaultName?: string;
  isTypeOnly: boolean;
}

export interface WatcherCall {
  calleeName: string;
  line: number;
}

export interface FileAnalysis {
  symbols: WatcherSymbol[];
  imports: WatcherImport[];
  jsxComponents: Set<string>;
  calls: WatcherCall[];
}

// ─── Skip Lists ─────────────────────────────────────────────────

const SKIP_CALLS = new Set([
  'require', 'import', 'console', 'log', 'warn', 'error', 'info', 'debug',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'Promise', 'resolve', 'reject', 'then', 'catch', 'finally',
  'JSON', 'parse', 'stringify', 'toString', 'valueOf',
  'Array', 'Object', 'Map', 'Set', 'String', 'Number', 'Boolean',
  'push', 'pop', 'shift', 'unshift', 'splice', 'slice', 'concat',
  'filter', 'map', 'reduce', 'forEach', 'find', 'findIndex', 'some', 'every',
  'includes', 'indexOf', 'join', 'split', 'replace', 'trim', 'match', 'test',
  'keys', 'values', 'entries', 'has', 'get', 'set', 'delete', 'add', 'clear',
  'from', 'of', 'isArray', 'assign', 'freeze', 'defineProperty',
  'addEventListener', 'removeEventListener', 'querySelector', 'getElementById',
  'createElement', 'appendChild', 'emit', 'on', 'off', 'once',
  'describe', 'it', 'test', 'expect', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll',
]);

// ─── AST Helpers ────────────────────────────────────────────────

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return mods?.some(m => m.kind === kind) ?? false;
}

function isFunctionLike(node: ts.Node): boolean {
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return true;
  if (ts.isCallExpression(node)) {
    const fn = node.expression;
    if (ts.isPropertyAccessExpression(fn)) {
      if (['forwardRef', 'memo', 'lazy'].includes(fn.name.text)) return true;
    }
    if (ts.isIdentifier(fn)) {
      if (['forwardRef', 'memo', 'lazy', 'createContext', 'cva'].includes(fn.text)) return true;
    }
  }
  return false;
}

function getTagName(expr: ts.JsxTagNameExpression): string | null {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
    return expr.expression.text + '.' + expr.name.text;
  }
  return null;
}

function walkJsx(node: ts.Node, components: Set<string>): void {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    const tag = getTagName(node.tagName);
    if (tag && /^[A-Z]/.test(tag) && tag !== 'Fragment') {
      components.add(tag);
    }
  }
  ts.forEachChild(node, child => walkJsx(child, components));
}

function extractCallName(expr: ts.Expression): string | null {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) {
    if (ts.isIdentifier(expr.expression) && SKIP_CALLS.has(expr.expression.text)) {
      return null;
    }
    return expr.name.text;
  }
  return null;
}

function walkCalls(node: ts.Node, calls: WatcherCall[]): void {
  if (ts.isCallExpression(node)) {
    const name = extractCallName(node.expression);
    if (name && !SKIP_CALLS.has(name)) {
      calls.push({
        calleeName: name,
        line: node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1,
      });
    }
  }
  ts.forEachChild(node, child => walkCalls(child, calls));
}

// ─── Single-File Analysis ───────────────────────────────────────

/**
 * Analyze a TypeScript source file, extracting symbols, imports, JSX, and calls.
 */
export function analyzeTypeScriptFile(sf: ts.SourceFile): FileAnalysis {
  const symbols: WatcherSymbol[] = [];
  const imports: WatcherImport[] = [];
  const jsxComponents = new Set<string>();
  const calls: WatcherCall[] = [];
  const localExportNames = new Set<string>();

  for (const stmt of sf.statements) {
    // Imports
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const spec = stmt.moduleSpecifier.text;
      const isTypeOnly = stmt.importClause?.isTypeOnly ?? false;
      const names: string[] = [];
      let defaultName: string | undefined;

      if (stmt.importClause) {
        if (stmt.importClause.name) defaultName = stmt.importClause.name.text;
        if (stmt.importClause.namedBindings && ts.isNamedImports(stmt.importClause.namedBindings)) {
          for (const el of stmt.importClause.namedBindings.elements) {
            names.push(el.name.text);
          }
        }
      }
      imports.push({ specifier: spec, names, defaultName, isTypeOnly });
    }

    // Export declarations (local re-exports)
    if (ts.isExportDeclaration(stmt) && !stmt.moduleSpecifier) {
      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          localExportNames.add(el.name.text);
        }
      }
    }

    // Functions
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      const name = stmt.name.text;
      const hasExport = hasModifier(stmt, ts.SyntaxKind.ExportKeyword);
      const hasDefault = hasModifier(stmt, ts.SyntaxKind.DefaultKeyword);
      symbols.push({
        name,
        kind: /^[A-Z]/.test(name) ? 'component' : 'function',
        isDefault: hasDefault,
        isExported: hasExport || hasDefault,
        startLine: sf.getLineAndCharacterOfPosition(stmt.getStart()).line + 1,
        endLine: sf.getLineAndCharacterOfPosition(stmt.getEnd()).line + 1,
      });
    }

    // Variable statements (const Foo = () => ...)
    if (ts.isVariableStatement(stmt)) {
      const hasExport = hasModifier(stmt, ts.SyntaxKind.ExportKeyword);
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        const name = decl.name.text;
        if (isFunctionLike(decl.initializer)) {
          symbols.push({
            name,
            kind: /^[A-Z]/.test(name) ? 'component' : 'function',
            isDefault: false,
            isExported: hasExport,
            startLine: sf.getLineAndCharacterOfPosition(stmt.getStart()).line + 1,
            endLine: sf.getLineAndCharacterOfPosition(stmt.getEnd()).line + 1,
          });
        }
      }
    }

    // Interfaces
    if (ts.isInterfaceDeclaration(stmt)) {
      symbols.push({
        name: stmt.name.text,
        kind: 'interface',
        isDefault: false,
        isExported: hasModifier(stmt, ts.SyntaxKind.ExportKeyword),
        startLine: sf.getLineAndCharacterOfPosition(stmt.getStart()).line + 1,
        endLine: sf.getLineAndCharacterOfPosition(stmt.getEnd()).line + 1,
      });
    }

    // Type aliases
    if (ts.isTypeAliasDeclaration(stmt)) {
      symbols.push({
        name: stmt.name.text,
        kind: 'type',
        isDefault: false,
        isExported: hasModifier(stmt, ts.SyntaxKind.ExportKeyword),
        startLine: sf.getLineAndCharacterOfPosition(stmt.getStart()).line + 1,
        endLine: sf.getLineAndCharacterOfPosition(stmt.getEnd()).line + 1,
      });
    }

    // Class declarations
    if (ts.isClassDeclaration(stmt) && stmt.name) {
      const name = stmt.name.text;
      const hasExport = hasModifier(stmt, ts.SyntaxKind.ExportKeyword);
      const hasDefault = hasModifier(stmt, ts.SyntaxKind.DefaultKeyword);
      symbols.push({
        name,
        kind: /^[A-Z]/.test(name) ? 'component' : 'function',
        isDefault: hasDefault,
        isExported: hasExport || hasDefault,
        startLine: sf.getLineAndCharacterOfPosition(stmt.getStart()).line + 1,
        endLine: sf.getLineAndCharacterOfPosition(stmt.getEnd()).line + 1,
      });
    }
  }

  // Apply local exports
  for (const sym of symbols) {
    if (localExportNames.has(sym.name)) sym.isExported = true;
  }

  // Walk JSX components
  walkJsx(sf, jsxComponents);

  // Walk function calls
  walkCalls(sf, calls);

  return { symbols, imports, jsxComponents, calls };
}

// ─── Utility Functions ──────────────────────────────────────────

/**
 * Find the narrowest enclosing function/component for a given line.
 */
export function findEnclosingSymbol(
  symbols: Array<{ name: string; kind: string; startLine: number; endLine: number }>,
  line: number,
): { name: string; kind: string } | null {
  let best: typeof symbols[0] | null = null;
  for (const sym of symbols) {
    if (sym.kind !== 'function' && sym.kind !== 'component') continue;
    if (sym.startLine <= line && sym.endLine >= line) {
      if (!best || (sym.endLine - sym.startLine) < (best.endLine - best.startLine)) {
        best = sym;
      }
    }
  }
  return best;
}

/**
 * Derive package name from a relative file path.
 */
export function getPackageFromPath(relPath: string): string {
  const parts = relPath.split('/');
  const srcIdx = parts.indexOf('src');
  if (srcIdx >= 0 && srcIdx < parts.length - 1) {
    const afterSrc = parts.slice(srcIdx + 1);
    afterSrc.pop();
    return afterSrc.length > 0 ? afterSrc.join('/') : 'root';
  }
  parts.pop();
  return parts.length > 0 ? parts.join('/') : 'root';
}

/**
 * Resolve an import specifier to a file node ID in the graph.
 */
export function resolveImportTarget(
  specifier: string,
  fromFileAbs: string,
  projectDir: string,
): string | null {
  if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return null;

  let basePath: string;
  if (specifier.startsWith('@/')) {
    basePath = join(projectDir, 'src', specifier.slice(2));
  } else {
    basePath = resolve(fromFileAbs, '..', specifier);
  }

  const candidates = [
    basePath,
    basePath + '.ts',
    basePath + '.tsx',
    join(basePath, 'index.ts'),
    join(basePath, 'index.tsx'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const relPath = relative(projectDir, candidate).replace(/\\/g, '/');
      return `ts:file:${relPath}`;
    }
  }

  return null;
}

/**
 * Find narrowest enclosing function/method for tree-sitter extracted symbols.
 */
export function findEnclosingExtracted(
  symbols: Array<{ id: string; name: string; type: NodeType; startLine: number; endLine: number }>,
  line: number,
): { id: string; name: string } | null {
  let best: typeof symbols[0] | null = null;
  for (const sym of symbols) {
    if (sym.type !== NodeType.Function && sym.type !== NodeType.Method) continue;
    if (sym.startLine <= line && sym.endLine >= line) {
      if (!best || (sym.endLine - sym.startLine) < (best.endLine - best.startLine)) {
        best = sym;
      }
    }
  }
  return best;
}
