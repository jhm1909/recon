/**
 * TypeScript/React Analyzer
 *
 * Analyzes TypeScript and React source files using ts.createSourceFile()
 * (parser-only, no full Program). Extracts components, functions, hooks,
 * types, interfaces, imports, and JSX component usage.
 *
 * Supports incremental indexing via SHA-256 file hashes.
 */

import ts from 'typescript';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { NodeType, RelationshipType, Language } from '../graph/types.js';
import type { Node, Relationship } from '../graph/types.js';
import type { AnalyzerResult, AnalyzerWarning } from './types.js';
import { hashFiles } from '../utils/hash.js';

// ─── Test File Detection ─────────────────────────────────────

const TEST_FILE_PATTERNS = [
  /\.test\.[tj]sx?$/,
  /\.spec\.[tj]sx?$/,
  /_test\.[tj]sx?$/,
  /[\\/]__tests__[\\/]/,
  /[\\/]test[\\/]/,
];

function isTestFile(filePath: string): boolean {
  return TEST_FILE_PATTERNS.some(p => p.test(filePath));
}

// ─── Internal Types ──────────────────────────────────────────

interface FileSymbol {
  name: string;
  kind: 'component' | 'function' | 'type' | 'interface';
  isDefault: boolean;
  isExported: boolean;
  startLine: number;
  endLine: number;
  extends?: string[];      // class/interface extends
  implements?: string[];   // class implements
}

interface FileImport {
  specifier: string;
  names: string[];
  defaultName?: string;
  isTypeOnly: boolean;
}

interface FileReExport {
  names: string[];
  from: string;
}

interface FileCall {
  calleeName: string;
  line: number;
}

interface FileAnalysis {
  symbols: FileSymbol[];
  imports: FileImport[];
  reExports: FileReExport[];
  jsxComponents: Set<string>;
  calls: FileCall[];
}

// ─── File Discovery ──────────────────────────────────────────

function discoverTSFiles(srcRoot: string): string[] {
  const files: string[] = [];

  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (
        entry.name === 'node_modules' ||
        entry.name === '.next' ||
        entry.name === 'dist' ||
        entry.name === '.reference' ||
        entry.name === '.recon' ||
        entry.name === 'messages' // i18n JSON files
      ) continue;

      const full = join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
      } else if (
        /\.(ts|tsx)$/.test(entry.name) &&
        !entry.name.endsWith('.d.ts')
      ) {
        files.push(full);
      }
    }
  };

  walk(srcRoot);
  return files;
}

// ─── Path Alias Resolution ───────────────────────────────────

function loadPathAliases(
  webAppRoot: string,
): Map<string, string> {
  const aliases = new Map<string, string>();

  try {
    const raw = readFileSync(join(webAppRoot, 'tsconfig.json'), 'utf-8');
    const config = JSON.parse(raw);
    const paths = config?.compilerOptions?.paths;

    if (paths) {
      for (const [pattern, targets] of Object.entries(paths)) {
        if (Array.isArray(targets) && targets.length > 0) {
          const target = (targets as string[])[0];
          // Strip trailing * from pattern and target
          const aliasKey = pattern.replace('*', '');
          const aliasValue = join(webAppRoot, target.replace('*', ''));
          aliases.set(aliasKey, aliasValue);
        }
      }
    }
  } catch {
    // Fallback
    aliases.set('@/', join(webAppRoot, 'src/'));
  }

  return aliases;
}

function resolveImportPath(
  specifier: string,
  fromFileAbs: string,
  projectRoot: string,
  aliases: Map<string, string>,
): string | null {
  // Skip external packages
  if (
    !specifier.startsWith('.') &&
    !specifier.startsWith('@/')
  ) return null;

  // Skip fumadocs special imports
  if (specifier.startsWith('fumadocs-mdx:')) return null;

  let basePath: string;

  // Check path aliases
  for (const [prefix, target] of aliases) {
    if (specifier.startsWith(prefix)) {
      basePath = join(target, specifier.slice(prefix.length));
      return tryResolveFile(basePath, projectRoot);
    }
  }

  // Relative import
  basePath = resolve(dirname(fromFileAbs), specifier);
  return tryResolveFile(basePath, projectRoot);
}

function tryResolveFile(basePath: string, projectRoot: string): string | null {
  const candidates = [
    basePath,
    basePath + '.ts',
    basePath + '.tsx',
    join(basePath, 'index.ts'),
    join(basePath, 'index.tsx'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return relative(projectRoot, candidate).replace(/\\/g, '/');
    }
  }

  return null;
}

// ─── AST Analysis ────────────────────────────────────────────

function analyzeSourceFile(sf: ts.SourceFile): FileAnalysis {
  const symbols: FileSymbol[] = [];
  const imports: FileImport[] = [];
  const reExports: FileReExport[] = [];
  const jsxComponents = new Set<string>();
  const localExportNames = new Set<string>(); // for `export { X }` without `from`

  for (const stmt of sf.statements) {
    // ─── Import declarations ─────────────────
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const spec = stmt.moduleSpecifier.text;
      const isTypeOnly = stmt.importClause?.isTypeOnly ?? false;
      const names: string[] = [];
      let defaultName: string | undefined;

      if (stmt.importClause) {
        if (stmt.importClause.name) {
          defaultName = stmt.importClause.name.text;
        }
        if (stmt.importClause.namedBindings) {
          if (ts.isNamedImports(stmt.importClause.namedBindings)) {
            for (const el of stmt.importClause.namedBindings.elements) {
              names.push(el.name.text);
            }
          }
        }
      }

      imports.push({ specifier: spec, names, defaultName, isTypeOnly });
    }

    // ─── Export declarations ─────────────────
    if (ts.isExportDeclaration(stmt)) {
      if (stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const from = stmt.moduleSpecifier.text;
        const names: string[] = [];

        if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
          for (const el of stmt.exportClause.elements) {
            names.push(el.name.text);
          }
        } else if (!stmt.exportClause) {
          names.push('*');
        }

        reExports.push({ names, from });
      } else if (!stmt.moduleSpecifier && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        // Local export: `export { Button, buttonVariants }`
        for (const el of stmt.exportClause.elements) {
          localExportNames.add(el.name.text);
        }
      }
    }

    // ─── Function declarations ────────────────
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      const name = stmt.name.text;
      const hasExport = hasModifier(stmt, ts.SyntaxKind.ExportKeyword);
      const hasDefault = hasModifier(stmt, ts.SyntaxKind.DefaultKeyword);
      const kind: 'component' | 'function' = isPascalCase(name) ? 'component' : 'function';

      symbols.push({
        name,
        kind,
        isDefault: hasDefault,
        isExported: hasExport || hasDefault,
        startLine: sf.getLineAndCharacterOfPosition(stmt.getStart()).line + 1,
        endLine: sf.getLineAndCharacterOfPosition(stmt.getEnd()).line + 1,
      });
    }

    // ─── Variable statements (const Foo = ...) ─
    if (ts.isVariableStatement(stmt)) {
      const hasExport = hasModifier(stmt, ts.SyntaxKind.ExportKeyword);

      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        const name = decl.name.text;

        if (isFunctionLike(decl.initializer)) {
          const kind: 'component' | 'function' = isPascalCase(name) ? 'component' : 'function';
          symbols.push({
            name,
            kind,
            isDefault: false,
            isExported: hasExport,
            startLine: sf.getLineAndCharacterOfPosition(stmt.getStart()).line + 1,
            endLine: sf.getLineAndCharacterOfPosition(stmt.getEnd()).line + 1,
          });
        }
      }
    }

    // ─── Interface declarations ───────────────
    if (ts.isInterfaceDeclaration(stmt)) {
      // Extract extends clause
      const extendsNames: string[] = [];
      if (stmt.heritageClauses) {
        for (const clause of stmt.heritageClauses) {
          if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
            for (const type of clause.types) {
              if (ts.isIdentifier(type.expression)) {
                extendsNames.push(type.expression.text);
              }
            }
          }
        }
      }

      symbols.push({
        name: stmt.name.text,
        kind: 'interface',
        isDefault: false,
        isExported: hasModifier(stmt, ts.SyntaxKind.ExportKeyword),
        startLine: sf.getLineAndCharacterOfPosition(stmt.getStart()).line + 1,
        endLine: sf.getLineAndCharacterOfPosition(stmt.getEnd()).line + 1,
        ...(extendsNames.length > 0 ? { extends: extendsNames } : {}),
      });
    }

    // ─── Type alias declarations ──────────────
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

    // ─── Class declarations ───────────────────
    if (ts.isClassDeclaration(stmt) && stmt.name) {
      const name = stmt.name.text;
      const hasExport = hasModifier(stmt, ts.SyntaxKind.ExportKeyword);
      const hasDefault = hasModifier(stmt, ts.SyntaxKind.DefaultKeyword);
      const kind: 'component' | 'function' = isPascalCase(name) ? 'component' : 'function';

      // Extract heritage clauses
      const extendsNames: string[] = [];
      const implementsNames: string[] = [];
      if (stmt.heritageClauses) {
        for (const clause of stmt.heritageClauses) {
          for (const type of clause.types) {
            if (!ts.isIdentifier(type.expression)) continue;
            const typeName = type.expression.text;
            if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
              extendsNames.push(typeName);
            } else if (clause.token === ts.SyntaxKind.ImplementsKeyword) {
              implementsNames.push(typeName);
            }
          }
        }
      }

      symbols.push({
        name,
        kind,
        isDefault: hasDefault,
        isExported: hasExport || hasDefault,
        startLine: sf.getLineAndCharacterOfPosition(stmt.getStart()).line + 1,
        endLine: sf.getLineAndCharacterOfPosition(stmt.getEnd()).line + 1,
        ...(extendsNames.length > 0 ? { extends: extendsNames } : {}),
        ...(implementsNames.length > 0 ? { implements: implementsNames } : {}),
      });
    }
  }

  // Walk entire tree for JSX component usages
  walkJsx(sf, jsxComponents);

  // Walk entire tree for function call expressions
  const calls: FileCall[] = [];
  walkCalls(sf, calls);

  // Post-pass: apply `export { X }` to mark symbols as exported
  if (localExportNames.size > 0) {
    for (const sym of symbols) {
      if (localExportNames.has(sym.name)) {
        sym.isExported = true;
      }
    }
  }

  return { symbols, imports, reExports, jsxComponents, calls };
}

// ─── AST Helpers ─────────────────────────────────────────────

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return mods?.some((m) => m.kind === kind) ?? false;
}

function isPascalCase(name: string): boolean {
  return /^[A-Z]/.test(name);
}

function isFunctionLike(node: ts.Node): boolean {
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return true;

  // React.forwardRef(...), React.memo(...), React.lazy(...)
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

function walkJsx(node: ts.Node, components: Set<string>): void {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    const tag = getTagName(node.tagName);
    if (tag && isPascalCase(tag) && tag !== 'Fragment') {
      components.add(tag);
    }
  }
  ts.forEachChild(node, (child) => walkJsx(child, components));
}

// ─── Call Expression Extraction ─────────────────────────────────

/** Built-in / noise function names to skip */
const SKIP_CALL_NAMES = new Set([
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

function walkCalls(node: ts.Node, calls: FileCall[]): void {
  if (ts.isCallExpression(node)) {
    const name = extractCallName(node.expression);
    if (name && !SKIP_CALL_NAMES.has(name)) {
      const sf = node.getSourceFile();
      calls.push({
        calleeName: name,
        line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      });
    }
  }
  ts.forEachChild(node, (child) => walkCalls(child, calls));
}

function extractCallName(expr: ts.Expression): string | null {
  // Direct call: foo()
  if (ts.isIdentifier(expr)) {
    return expr.text;
  }
  // Method call: obj.method() → return "method" (we resolve by name)
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) {
    // Skip console.log, JSON.parse, etc.
    if (ts.isIdentifier(expr.expression) && SKIP_CALL_NAMES.has(expr.expression.text)) {
      return null;
    }
    return expr.name.text;
  }
  return null;
}

function getTagName(expr: ts.JsxTagNameExpression): string | null {
  if (ts.isIdentifier(expr)) return expr.text;
  // motion.div, AnimatePresence, etc. — PropertyAccess means namespaced component
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
    return expr.expression.text + '.' + expr.name.text;
  }
  return null;
}

// ─── Graph Building ──────────────────────────────────────────

function buildGraph(
  projectRoot: string,
  webAppRelPath: string,
  srcRoot: string,
  fileAnalyses: Map<string, FileAnalysis>,
  aliases: Map<string, string>,
): {
  nodes: Node[];
  relationships: Relationship[];
  componentCount: number;
  functionCount: number;
} {
  const nodes: Node[] = [];
  const relationships: Relationship[] = [];
  let relCounter = 0;
  let componentCount = 0;
  let functionCount = 0;

  // Global name → nodeId map for component resolution
  const componentMap = new Map<string, string>(); // name → nodeId
  const functionMap = new Map<string, string>();   // name → nodeId

  // Track all analyzed file paths for import edge creation
  const analyzedFiles = new Set(fileAnalyses.keys());

  for (const [fileRelPath, analysis] of fileAnalyses) {
    const filePkg = getPackage(fileRelPath, webAppRelPath);
    const fileNodeId = `ts:file:${fileRelPath}`;

    // Create File node
    const fileIsTest = isTestFile(fileRelPath);

    nodes.push({
      id: fileNodeId,
      type: NodeType.File,
      name: fileRelPath.split('/').pop() || fileRelPath,
      file: fileRelPath,
      startLine: 0,
      endLine: 0,
      language: Language.TypeScript,
      package: filePkg,
      exported: true,
      ...(fileIsTest ? { isTest: true } : {}),
    });

    // Create symbol nodes
    for (const sym of analysis.symbols) {
      let nodeType: NodeType;
      let idPrefix: string;

      switch (sym.kind) {
        case 'component':
          nodeType = NodeType.Component;
          idPrefix = 'ts:comp';
          componentCount++;
          break;
        case 'function':
          nodeType = NodeType.Function;
          idPrefix = 'ts:func';
          functionCount++;
          break;
        case 'type':
          nodeType = NodeType.Type;
          idPrefix = 'ts:type';
          break;
        case 'interface':
          nodeType = NodeType.Interface;
          idPrefix = 'ts:iface';
          break;
      }

      const nodeId = `${idPrefix}:${fileRelPath}:${sym.name}`;

      nodes.push({
        id: nodeId,
        type: nodeType,
        name: sym.name,
        file: fileRelPath,
        startLine: sym.startLine,
        endLine: sym.endLine,
        language: Language.TypeScript,
        package: filePkg,
        exported: sym.isExported,
        isDefault: sym.isDefault,
        ...(fileIsTest ? { isTest: true } : {}),
      });

      // DEFINES edge: File → Symbol
      relationships.push({
        id: `rel:ts:${++relCounter}`,
        type: RelationshipType.DEFINES,
        sourceId: fileNodeId,
        targetId: nodeId,
        confidence: 1.0,
      });

      // Register in global maps (exported symbols take priority)
      if (sym.kind === 'component') {
        if (sym.isExported || !componentMap.has(sym.name)) {
          componentMap.set(sym.name, nodeId);
        }
      } else if (sym.kind === 'function') {
        if (sym.isExported || !functionMap.has(sym.name)) {
          functionMap.set(sym.name, nodeId);
        }
      }
    }

    // Create import edges (file → file)
    const fileAbsPath = join(projectRoot, fileRelPath);
    for (const imp of analysis.imports) {
      if (imp.isTypeOnly) continue; // Skip type-only imports for runtime graph

      const resolvedPath = resolveImportPath(
        imp.specifier,
        fileAbsPath,
        projectRoot,
        aliases,
      );

      if (resolvedPath && analyzedFiles.has(resolvedPath)) {
        const targetFileId = `ts:file:${resolvedPath}`;
        relationships.push({
          id: `rel:ts:${++relCounter}`,
          type: RelationshipType.IMPORTS,
          sourceId: fileNodeId,
          targetId: targetFileId,
          confidence: 1.0,
        });
      }
    }

    // Create import edges for re-exports too
    for (const reExp of analysis.reExports) {
      const resolvedPath = resolveImportPath(
        reExp.from,
        fileAbsPath,
        projectRoot,
        aliases,
      );

      if (resolvedPath && analyzedFiles.has(resolvedPath)) {
        const targetFileId = `ts:file:${resolvedPath}`;
        relationships.push({
          id: `rel:ts:${++relCounter}`,
          type: RelationshipType.IMPORTS,
          sourceId: fileNodeId,
          targetId: targetFileId,
          confidence: 1.0,
        });
      }
    }
  }

  // Post-pass: create USES_COMPONENT edges based on JSX usage
  for (const [fileRelPath, analysis] of fileAnalyses) {
    if (analysis.jsxComponents.size === 0) continue;

    // Find the primary component in this file (for edge source)
    const fileComponents = analysis.symbols.filter(
      (s) => s.kind === 'component' && s.isExported,
    );
    const sourceNodeId = fileComponents.length === 1
      ? `ts:comp:${fileRelPath}:${fileComponents[0].name}`
      : `ts:file:${fileRelPath}`;

    for (const jsxName of analysis.jsxComponents) {
      // Skip namespaced components (motion.div)
      if (jsxName.includes('.')) continue;

      const targetNodeId = componentMap.get(jsxName);
      if (targetNodeId && targetNodeId !== sourceNodeId) {
        relationships.push({
          id: `rel:ts:${++relCounter}`,
          type: RelationshipType.USES_COMPONENT,
          sourceId: sourceNodeId,
          targetId: targetNodeId,
          confidence: 0.9,
        });
      }
    }
  }

  // Post-pass: create CALLS edges based on function call expressions
  const seenCallEdges = new Set<string>();
  for (const [fileRelPath, analysis] of fileAnalyses) {
    if (analysis.calls.length === 0) continue;

    // Build set of imported names in this file for confidence scoring
    const importedNames = new Set<string>();
    for (const imp of analysis.imports) {
      for (const name of imp.names) importedNames.add(name);
      if (imp.defaultName) importedNames.add(imp.defaultName);
    }

    // Build set of local symbol names for same-file detection
    const localSymbols = new Set(analysis.symbols.map(s => s.name));

    for (const call of analysis.calls) {
      // Find the enclosing function/component for the call site
      const callerSym = findEnclosingSymbol(analysis.symbols, call.line);
      if (!callerSym) continue;

      // Build caller node ID
      const callerPrefix = callerSym.kind === 'component' ? 'ts:comp' : 'ts:func';
      const callerNodeId = `${callerPrefix}:${fileRelPath}:${callerSym.name}`;

      // Find target: prefer exported functions/components from other files
      const targetNodeId = functionMap.get(call.calleeName) || componentMap.get(call.calleeName);
      if (!targetNodeId || targetNodeId === callerNodeId) continue;

      // Deduplicate edges (same caller → same callee)
      const edgeKey = `${callerNodeId}→${targetNodeId}`;
      if (seenCallEdges.has(edgeKey)) continue;
      seenCallEdges.add(edgeKey);

      // Contextual confidence scoring based on import evidence:
      //  1.0 — import exists between source and target file + direct call
      //  0.7 — same file, no import chain needed
      //  0.4 — different file, no import relationship
      let confidence: number;
      if (localSymbols.has(call.calleeName)) {
        confidence = 0.7; // Same file, no import chain needed
      } else if (importedNames.has(call.calleeName)) {
        confidence = 1.0; // Import exists + direct call → highest certainty
      } else {
        confidence = 0.4; // Cross-file, no import relationship
      }

      relationships.push({
        id: `rel:ts:${++relCounter}`,
        type: RelationshipType.CALLS,
        sourceId: callerNodeId,
        targetId: targetNodeId,
        confidence,
      });
    }
  }

  // Post-pass: create EXTENDS / IMPLEMENTS edges from heritage clauses
  // Build a type map: name → nodeId for classes, interfaces, components
  const typeMap = new Map<string, string>();
  for (const [fileRelPath, analysis] of fileAnalyses) {
    for (const sym of analysis.symbols) {
      if (sym.kind === 'interface') {
        const nodeId = `ts:iface:${fileRelPath}:${sym.name}`;
        if (sym.isExported || !typeMap.has(sym.name)) {
          typeMap.set(sym.name, nodeId);
        }
      } else if (sym.kind === 'component') {
        const nodeId = `ts:comp:${fileRelPath}:${sym.name}`;
        if (sym.isExported || !typeMap.has(sym.name)) {
          typeMap.set(sym.name, nodeId);
        }
      } else if (sym.kind === 'type') {
        const nodeId = `ts:type:${fileRelPath}:${sym.name}`;
        if (sym.isExported || !typeMap.has(sym.name)) {
          typeMap.set(sym.name, nodeId);
        }
      }
    }
  }

  for (const [fileRelPath, analysis] of fileAnalyses) {
    for (const sym of analysis.symbols) {
      const sourcePrefix = sym.kind === 'component' ? 'ts:comp'
        : sym.kind === 'interface' ? 'ts:iface'
          : sym.kind === 'type' ? 'ts:type'
            : 'ts:func';
      const sourceId = `${sourcePrefix}:${fileRelPath}:${sym.name}`;

      // EXTENDS edges
      if (sym.extends) {
        for (const parentName of sym.extends) {
          const targetId = typeMap.get(parentName) || componentMap.get(parentName);
          if (targetId && targetId !== sourceId) {
            relationships.push({
              id: `rel:ts:${++relCounter}`,
              type: RelationshipType.EXTENDS,
              sourceId,
              targetId,
              confidence: 0.9,
            });
          }
        }
      }

      // IMPLEMENTS edges
      if (sym.implements) {
        for (const ifaceName of sym.implements) {
          const targetId = typeMap.get(ifaceName);
          if (targetId && targetId !== sourceId) {
            relationships.push({
              id: `rel:ts:${++relCounter}`,
              type: RelationshipType.IMPLEMENTS,
              sourceId,
              targetId,
              confidence: 0.9,
            });
          }
        }
      }
    }
  }

  return { nodes, relationships, componentCount, functionCount };
}

/**
 * Find the narrowest function/component symbol that contains the given line.
 */
function findEnclosingSymbol(symbols: FileSymbol[], line: number): FileSymbol | null {
  let best: FileSymbol | null = null;
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
 * Extract logical package from file path.
 * e.g., "apps/web/src/components/ui/button.tsx" → "components/ui"
 */
function getPackage(fileRelPath: string, webAppRelPath: string): string {
  // Normalize: when webAppRelPath is '.', srcPrefix should be 'src/'
  const srcPrefix = webAppRelPath === '.'
    ? 'src/'
    : `${webAppRelPath}/src/`;
  if (!fileRelPath.startsWith(srcPrefix)) return webAppRelPath === '.' ? 'root' : webAppRelPath;

  const afterSrc = fileRelPath.slice(srcPrefix.length);
  const parts = afterSrc.split('/');
  // Remove filename, keep directory path
  parts.pop();
  return parts.length > 0 ? parts.join('/') : 'root';
}

// ─── Main Entry ──────────────────────────────────────────────

/**
 * Analyze TypeScript/React source files in the web app.
 */
export async function analyzeTypeScript(
  projectRoot: string,
  webAppRelPath: string = 'apps/web',
  previousHashes?: Record<string, string>,
): Promise<{
  result: AnalyzerResult;
  fileHashes: Record<string, string>;
  stats: { files: number; skipped: number; components: number; functions: number };
  warnings: AnalyzerWarning[];
}> {
  const webAppRoot = join(projectRoot, webAppRelPath);
  const srcRoot = join(webAppRoot, 'src');

  if (!existsSync(srcRoot)) {
    console.error(`[recon] Warning: ${srcRoot} not found — skipping TS analysis`);
    return {
      result: { nodes: [], relationships: [] },
      fileHashes: {},
      stats: { files: 0, skipped: 0, components: 0, functions: 0 },
      warnings: [],
    };
  }

  // 1. Discover files
  const files = discoverTSFiles(srcRoot);
  console.log(`[recon] Found ${files.length} TypeScript files`);

  // 2. Hash for incremental indexing
  const absoluteHashes = await hashFiles(files);
  const fileHashes: Record<string, string> = {};
  for (const [absPath, hash] of Object.entries(absoluteHashes)) {
    fileHashes[relative(projectRoot, absPath).replace(/\\/g, '/')] = hash;
  }

  // 3. Load path aliases
  const aliases = loadPathAliases(webAppRoot);

  // 4. Parse and analyze each file
  const fileAnalyses = new Map<string, FileAnalysis>();
  let skippedCount = 0;
  const warnings: AnalyzerWarning[] = [];

  for (const absPath of files) {
    const relPath = relative(projectRoot, absPath).replace(/\\/g, '/');

    // Incremental: skip unchanged files
    if (previousHashes && fileHashes[relPath] === previousHashes[relPath]) {
      skippedCount++;
      continue;
    }

    try {
      const source = readFileSync(absPath, 'utf-8');
      const sf = ts.createSourceFile(
        relPath,
        source,
        ts.ScriptTarget.ES2022,
        true,
        absPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );

      const analysis = analyzeSourceFile(sf);
      fileAnalyses.set(relPath, analysis);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push({ file: relPath, reason: message.split('\n')[0] });
    }
  }

  // 5. Build graph
  const { nodes, relationships, componentCount, functionCount } = buildGraph(
    projectRoot,
    webAppRelPath,
    srcRoot,
    fileAnalyses,
    aliases,
  );

  return {
    result: { nodes, relationships },
    fileHashes,
    stats: {
      files: fileAnalyses.size,
      skipped: skippedCount,
      components: componentCount,
      functions: functionCount,
    },
    warnings,
  };
}
