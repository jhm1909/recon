/**
 * File Watcher — Surgical Live Re-Index
 *
 * Watches source files with chokidar. On change:
 * 1. Remove old nodes for the file (graph.removeNodesByFile)
 * 2. Re-parse the single file with ts.createSourceFile
 * 3. Insert new nodes + edges in-place
 *
 * The graph is mutated directly so MCP handlers see updates immediately.
 */

import chokidar from 'chokidar';
import type { FSWatcher } from 'chokidar';
import ts from 'typescript';
import { readFileSync, existsSync } from 'node:fs';
import { join, relative, resolve, basename } from 'node:path';
import { KnowledgeGraph } from '../graph/graph.js';
import { NodeType, RelationshipType, Language } from '../graph/types.js';
import { extractFromFile } from '../analyzers/tree-sitter/extractor.js';
import { getLanguageForFile, isLanguageAvailable } from '../analyzers/tree-sitter/parser.js';

// ─── Types ───────────────────────────────────────────────────────

export interface ProjectDir {
  dir: string;       // Absolute path to project directory
  repoName: string;  // Name stamped on nodes
}

export interface WatcherStatus {
  active: boolean;
  startedAt: string | null;
  watchDirs: string[];
  totalUpdates: number;
  lastUpdate: {
    file: string;
    timestamp: string;
    durationMs: number;
  } | null;
  pendingCount: number;
  errors: Array<{
    file: string;
    error: string;
    timestamp: string;
  }>;
}

/** Shared singleton — imported by MCP handler */
export const watcherStatus: WatcherStatus = {
  active: false,
  startedAt: null,
  watchDirs: [],
  totalUpdates: 0,
  lastUpdate: null,
  pendingCount: 0,
  errors: [],
};

// ─── Supported Extensions ────────────────────────────────────────

const TS_EXTENSIONS = new Set(['.ts', '.tsx']);
const TREE_SITTER_EXTENSIONS = new Set([
  '.go', '.py', '.rs', '.java', '.c', '.cpp', '.rb', '.php', '.kt', '.swift', '.cs',
]);
const ALL_EXTENSIONS = new Set([...TS_EXTENSIONS, ...TREE_SITTER_EXTENSIONS]);

function getExtension(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot >= 0 ? path.slice(dot) : '';
}

function isWatchableFile(path: string): boolean {
  const ext = getExtension(path);
  if (!ALL_EXTENSIONS.has(ext)) return false;
  // Skip test/spec files
  if (path.includes('.test.') || path.includes('.spec.') || path.endsWith('.d.ts')) return false;
  return true;
}

// ─── Watcher Class ───────────────────────────────────────────────

export class ReconWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private indexLock = false;
  private pendingQueue: Array<{ absPath: string; repoName: string }> = [];

  constructor(
    private graph: KnowledgeGraph,
    private projectDirs: ProjectDir[],
    private debounceMs = 1500,
    private customIgnore: string[] = [],
  ) {}

  /**
   * Start watching all project directories for file changes.
   */
  start(): void {
    const watchPaths = this.projectDirs.map(p => p.dir);

    const extraIgnore = this.customIgnore.map(p => new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    this.watcher = chokidar.watch(watchPaths, {
      ignored: [
        /node_modules/,
        /\.git/,
        /\.recon/,
        /dist\//,
        /\.next/,
        /build\//,
        /coverage\//,
        ...extraIgnore,
      ],
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 50 },
      atomic: true,
    });

    this.watcher
      .on('change', (filePath) => this.handleFileEvent(filePath, 'change'))
      .on('add', (filePath) => this.handleFileEvent(filePath, 'add'))
      .on('unlink', (filePath) => this.handleFileEvent(filePath, 'unlink'))
      .on('error', (error) => console.error(`[recon:watch] Error: ${error}`));

    const dirNames = this.projectDirs.map(p => p.repoName).join(', ');
    console.error(`[recon:watch] Watching: ${dirNames}`);

    // Update singleton status
    watcherStatus.active = true;
    watcherStatus.startedAt = new Date().toISOString();
    watcherStatus.watchDirs = this.projectDirs.map(p => p.repoName);

    // Clean shutdown
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
  }

  /**
   * Stop watching.
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    watcherStatus.active = false;
  }

  /**
   * Handle a file system event with debouncing.
   */
  private handleFileEvent(filePath: string, event: string): void {
    const absPath = resolve(filePath);
    if (!isWatchableFile(absPath)) return;

    // Find which project this file belongs to
    const project = this.projectDirs.find(p => absPath.startsWith(resolve(p.dir)));
    if (!project) return;

    // Debounce: if the same file changes rapidly, only process once
    const existing = this.debounceTimers.get(absPath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.debounceTimers.delete(absPath);
      this.enqueue(absPath, project.repoName, event);
    }, this.debounceMs);

    this.debounceTimers.set(absPath, timer);
  }

  /**
   * Enqueue a file for processing, respecting the lock.
   */
  private enqueue(absPath: string, repoName: string, event: string): void {
    if (this.indexLock) {
      // Already processing — queue for later
      this.pendingQueue.push({ absPath, repoName });
      return;
    }

    this.processFile(absPath, repoName, event);
  }

  /**
   * Process a single file change — the core surgical update.
   */
  private async processFile(absPath: string, repoName: string, event: string): Promise<void> {
    this.indexLock = true;

    try {
      const project = this.projectDirs.find(p => absPath.startsWith(resolve(p.dir)));
      if (!project) return;

      const relPath = relative(project.dir, absPath).replace(/\\/g, '/');
      const ext = getExtension(absPath);
      const startTime = performance.now();

      if (event === 'unlink') {
        // File deleted — just remove nodes
        const removed = this.graph.removeNodesByFile(relPath);
        if (removed > 0) {
          console.error(`[recon:watch] Removed ${removed} nodes (file deleted: ${relPath})`);
        }
        return;
      }

      // File added or changed — surgical update
      if (TS_EXTENSIONS.has(ext)) {
        this.surgicalUpdateTS(absPath, relPath, repoName, project.dir);
      } else if (TREE_SITTER_EXTENSIONS.has(ext)) {
        this.surgicalUpdateTreeSitter(absPath, relPath, repoName);
      }

      const elapsed = Math.round(performance.now() - startTime);
      console.error(`[recon:watch] Updated ${relPath} (${elapsed}ms)`);

      // Update status singleton
      watcherStatus.totalUpdates++;
      watcherStatus.lastUpdate = {
        file: relPath,
        timestamp: new Date().toISOString(),
        durationMs: elapsed,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[recon:watch] Error processing ${absPath}: ${msg}`);

      // Track error
      watcherStatus.errors.push({
        file: absPath,
        error: msg,
        timestamp: new Date().toISOString(),
      });
      if (watcherStatus.errors.length > 10) watcherStatus.errors.shift();
    } finally {
      this.indexLock = false;
      watcherStatus.pendingCount = this.pendingQueue.length;

      // Process pending queue
      if (this.pendingQueue.length > 0) {
        const next = this.pendingQueue.shift()!;
        this.processFile(next.absPath, next.repoName, 'change');
      }
    }
  }

  // ─── TypeScript Surgical Update ────────────────────────────────

  private surgicalUpdateTS(
    absPath: string,
    relPath: string,
    repoName: string,
    projectDir: string,
  ): void {
    if (!existsSync(absPath)) return;

    // 1. Collect IDs of incoming edges BEFORE removal (so we can re-link callers)
    const oldNodeIds = new Set<string>();
    const oldSymbolNames = new Map<string, string>(); // nodeId → name
    for (const [id, node] of this.graph.nodes) {
      if (node.file === relPath) {
        oldNodeIds.add(id);
        if (node.type !== NodeType.File) {
          oldSymbolNames.set(id, node.name);
        }
      }
    }

    // Collect incoming edges from OTHER files (callers of this file's symbols)
    const incomingCallers: Array<{ sourceId: string; targetName: string; type: RelationshipType }> = [];
    for (const nodeId of oldNodeIds) {
      const incoming = this.graph.getIncoming(nodeId);
      for (const rel of incoming) {
        if (!oldNodeIds.has(rel.sourceId)) {
          const targetName = oldSymbolNames.get(nodeId);
          if (targetName) {
            incomingCallers.push({
              sourceId: rel.sourceId,
              targetName,
              type: rel.type,
            });
          }
        }
      }
    }

    // 2. Remove old nodes + relationships for this file
    this.graph.removeNodesByFile(relPath);

    // 3. Re-parse the single file
    let source: string;
    try {
      source = readFileSync(absPath, 'utf-8');
    } catch {
      return;
    }

    const sf = ts.createSourceFile(
      relPath,
      source,
      ts.ScriptTarget.ES2022,
      true,
      absPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    // 4. Analyze the file — extract symbols, imports, jsx, calls
    const analysis = this.analyzeFile(sf);

    // 5. Derive package from path
    const pkg = this.getPackage(relPath);

    // 6. Create File node
    const fileNodeId = `ts:file:${relPath}`;
    this.graph.addNode({
      id: fileNodeId,
      type: NodeType.File,
      name: relPath.split('/').pop() || relPath,
      file: relPath,
      startLine: 0,
      endLine: 0,
      language: Language.TypeScript,
      package: pkg,
      exported: true,
      repo: repoName,
    });

    // 7. Create symbol nodes
    let relCounter = Date.now(); // unique ID generation
    const newSymbolMap = new Map<string, string>(); // name → nodeId

    for (const sym of analysis.symbols) {
      let nodeType: NodeType;
      let idPrefix: string;

      switch (sym.kind) {
        case 'component':
          nodeType = NodeType.Component;
          idPrefix = 'ts:comp';
          break;
        case 'function':
          nodeType = NodeType.Function;
          idPrefix = 'ts:func';
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

      const nodeId = `${idPrefix}:${relPath}:${sym.name}`;

      this.graph.addNode({
        id: nodeId,
        type: nodeType,
        name: sym.name,
        file: relPath,
        startLine: sym.startLine,
        endLine: sym.endLine,
        language: Language.TypeScript,
        package: pkg,
        exported: sym.isExported,
        isDefault: sym.isDefault,
        repo: repoName,
      });

      // DEFINES edge: File → Symbol
      this.graph.addRelationship({
        id: `rel:watch:${++relCounter}`,
        type: RelationshipType.DEFINES,
        sourceId: fileNodeId,
        targetId: nodeId,
        confidence: 1.0,
      });

      newSymbolMap.set(sym.name, nodeId);
    }

    // 8. Reconstruct IMPORT edges from this file
    for (const imp of analysis.imports) {
      if (imp.isTypeOnly) continue;
      // Resolve import to a file node in the graph
      const targetFileId = this.resolveImportTarget(imp.specifier, absPath, projectDir);
      if (targetFileId && this.graph.getNode(targetFileId)) {
        this.graph.addRelationship({
          id: `rel:watch:${++relCounter}`,
          type: RelationshipType.IMPORTS,
          sourceId: fileNodeId,
          targetId: targetFileId,
          confidence: 1.0,
        });
      }
    }

    // 9. Reconstruct CALLS edges from this file
    for (const call of analysis.calls) {
      // Find the enclosing symbol for this call
      const callerSym = this.findEnclosing(analysis.symbols, call.line);
      if (!callerSym) continue;

      const callerPrefix = callerSym.kind === 'component' ? 'ts:comp' : 'ts:func';
      const callerNodeId = `${callerPrefix}:${relPath}:${callerSym.name}`;

      // Find target in global graph by name
      const targets = this.graph.findByName(call.calleeName);
      const target = targets.find(n =>
        n.file !== relPath && n.exported &&
        (n.type === NodeType.Function || n.type === NodeType.Component),
      );

      if (target && target.id !== callerNodeId) {
        this.graph.addRelationship({
          id: `rel:watch:${++relCounter}`,
          type: RelationshipType.CALLS,
          sourceId: callerNodeId,
          targetId: target.id,
          confidence: 0.7,
        });
      }
    }

    // 10. Reconstruct USES_COMPONENT edges from this file
    for (const jsxName of analysis.jsxComponents) {
      if (jsxName.includes('.')) continue;

      const targets = this.graph.findByName(jsxName);
      const target = targets.find(n => n.type === NodeType.Component && n.file !== relPath);

      if (target) {
        // Find source component in this file
        const sourceComp = analysis.symbols.find(s => s.kind === 'component' && s.isExported);
        const sourceId = sourceComp
          ? `ts:comp:${relPath}:${sourceComp.name}`
          : fileNodeId;

        if (target.id !== sourceId) {
          this.graph.addRelationship({
            id: `rel:watch:${++relCounter}`,
            type: RelationshipType.USES_COMPONENT,
            sourceId,
            targetId: target.id,
            confidence: 0.9,
          });
        }
      }
    }

    // 11. Re-link incoming callers (edges FROM other files TO this file's symbols)
    for (const caller of incomingCallers) {
      const newTargetId = newSymbolMap.get(caller.targetName);
      if (newTargetId && this.graph.getNode(caller.sourceId)) {
        this.graph.addRelationship({
          id: `rel:watch:${++relCounter}`,
          type: caller.type,
          sourceId: caller.sourceId,
          targetId: newTargetId,
          confidence: 0.7,
        });
      }
    }
  }

  // ─── Tree-sitter Surgical Update ───────────────────────────────

  private surgicalUpdateTreeSitter(
    absPath: string,
    relPath: string,
    repoName: string,
  ): void {
    // Detect language from file extension
    const language = getLanguageForFile(absPath);
    if (!language || !isLanguageAvailable(language)) {
      // Unsupported or grammar not installed — skip silently.
      // Don't remove existing nodes — they're still valid from the initial index.
      return;
    }

    // Read file
    let content: string;
    try {
      content = readFileSync(absPath, 'utf-8');
    } catch {
      this.graph.removeNodesByFile(relPath);
      return;
    }

    // 1. Save incoming callers BEFORE removal
    const oldNodeIds = new Set<string>();
    const oldSymbolNames = new Map<string, string>();
    for (const [id, node] of this.graph.nodes) {
      if (node.file === relPath) {
        oldNodeIds.add(id);
        if (node.type !== NodeType.File) {
          oldSymbolNames.set(id, node.name);
        }
      }
    }

    const incomingCallers: Array<{ sourceId: string; targetName: string; type: RelationshipType }> = [];
    for (const nodeId of oldNodeIds) {
      const incoming = this.graph.getIncoming(nodeId);
      for (const rel of incoming) {
        if (!oldNodeIds.has(rel.sourceId)) {
          const targetName = oldSymbolNames.get(nodeId);
          if (targetName) {
            incomingCallers.push({ sourceId: rel.sourceId, targetName, type: rel.type });
          }
        }
      }
    }

    // 2. Remove old nodes
    this.graph.removeNodesByFile(relPath);

    // 3. Extract symbols, calls, imports, heritage
    const extraction = extractFromFile(relPath, content, language);
    if (extraction.symbols.length === 0) return;

    // 4. Add File node
    const fileNodeId = `${language}:file:${relPath}`;
    this.graph.addNode({
      id: fileNodeId,
      type: NodeType.File,
      name: relPath.split('/').pop() || relPath,
      file: relPath,
      startLine: 0,
      endLine: 0,
      language,
      package: extraction.symbols[0]?.package || '',
      exported: true,
      repo: repoName,
    });

    // 5. Add symbol nodes + DEFINES edges
    let relCounter = Date.now();
    const newSymbolMap = new Map<string, string>(); // name → nodeId

    for (const sym of extraction.symbols) {
      this.graph.addNode({
        id: sym.id,
        type: sym.type,
        name: sym.name,
        file: sym.file,
        startLine: sym.startLine,
        endLine: sym.endLine,
        language: sym.language,
        package: sym.package,
        exported: sym.exported,
        repo: repoName,
      });

      this.graph.addRelationship({
        id: `rel:watch:${++relCounter}`,
        type: RelationshipType.DEFINES,
        sourceId: fileNodeId,
        targetId: sym.id,
        confidence: 1.0,
      });

      newSymbolMap.set(sym.name, sym.id);
    }

    // 6. Resolve CALLS edges
    for (const call of extraction.calls) {
      // Find enclosing symbol for each call
      const caller = this.findEnclosingExtracted(extraction.symbols, call.line);
      if (!caller) continue;

      // Find target in global graph by name
      const targets = this.graph.findByName(call.calleeName);
      const target = targets.find(n =>
        n.file !== relPath && n.exported &&
        (n.type === NodeType.Function || n.type === NodeType.Method),
      );

      if (target && target.id !== caller.id) {
        this.graph.addRelationship({
          id: `rel:watch:${++relCounter}`,
          type: RelationshipType.CALLS,
          sourceId: caller.id,
          targetId: target.id,
          confidence: 0.7,
        });
      }
    }

    // 7. HAS_METHOD edges (Class/Struct → Method)
    const methods = extraction.symbols.filter(s => s.type === NodeType.Method);
    const classes = extraction.symbols.filter(s =>
      s.type === NodeType.Class || s.type === NodeType.Struct || s.type === NodeType.Trait,
    );
    for (const method of methods) {
      const enclosing = classes.find(
        c => c.startLine <= method.startLine && c.endLine >= method.endLine,
      );
      if (enclosing) {
        this.graph.addRelationship({
          id: `rel:watch:${++relCounter}`,
          type: RelationshipType.HAS_METHOD,
          sourceId: enclosing.id,
          targetId: method.id,
          confidence: 1.0,
        });
      }
    }

    // 8. EXTENDS / IMPLEMENTS edges
    for (const h of extraction.heritage) {
      const childId = newSymbolMap.get(h.childName);
      if (!childId) continue;

      const parents = this.graph.findByName(h.parentName);
      const parent = parents.find(n => n.file !== relPath) || parents[0];
      if (!parent) continue;

      const relType = h.kind === 'extends' ? RelationshipType.EXTENDS : RelationshipType.IMPLEMENTS;
      this.graph.addRelationship({
        id: `rel:watch:${++relCounter}`,
        type: relType,
        sourceId: childId,
        targetId: parent.id,
        confidence: 0.9,
      });
    }

    // 9. Re-link incoming callers
    for (const caller of incomingCallers) {
      const newTargetId = newSymbolMap.get(caller.targetName);
      if (newTargetId && this.graph.getNode(caller.sourceId)) {
        this.graph.addRelationship({
          id: `rel:watch:${++relCounter}`,
          type: caller.type,
          sourceId: caller.sourceId,
          targetId: newTargetId,
          confidence: 0.7,
        });
      }
    }
  }

  // ─── Single-File TypeScript Analysis ───────────────────────────

  private analyzeFile(sf: ts.SourceFile): {
    symbols: Array<{
      name: string;
      kind: 'component' | 'function' | 'type' | 'interface';
      isDefault: boolean;
      isExported: boolean;
      startLine: number;
      endLine: number;
    }>;
    imports: Array<{ specifier: string; names: string[]; defaultName?: string; isTypeOnly: boolean }>;
    jsxComponents: Set<string>;
    calls: Array<{ calleeName: string; line: number }>;
  } {
    const symbols: Array<{
      name: string;
      kind: 'component' | 'function' | 'type' | 'interface';
      isDefault: boolean;
      isExported: boolean;
      startLine: number;
      endLine: number;
    }> = [];
    const imports: Array<{ specifier: string; names: string[]; defaultName?: string; isTypeOnly: boolean }> = [];
    const jsxComponents = new Set<string>();
    const calls: Array<{ calleeName: string; line: number }> = [];
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
        const hasExport = this.hasModifier(stmt, ts.SyntaxKind.ExportKeyword);
        const hasDefault = this.hasModifier(stmt, ts.SyntaxKind.DefaultKeyword);
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
        const hasExport = this.hasModifier(stmt, ts.SyntaxKind.ExportKeyword);
        for (const decl of stmt.declarationList.declarations) {
          if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
          const name = decl.name.text;
          if (this.isFunctionLike(decl.initializer)) {
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
          isExported: this.hasModifier(stmt, ts.SyntaxKind.ExportKeyword),
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
          isExported: this.hasModifier(stmt, ts.SyntaxKind.ExportKeyword),
          startLine: sf.getLineAndCharacterOfPosition(stmt.getStart()).line + 1,
          endLine: sf.getLineAndCharacterOfPosition(stmt.getEnd()).line + 1,
        });
      }

      // Class declarations
      if (ts.isClassDeclaration(stmt) && stmt.name) {
        const name = stmt.name.text;
        const hasExport = this.hasModifier(stmt, ts.SyntaxKind.ExportKeyword);
        const hasDefault = this.hasModifier(stmt, ts.SyntaxKind.DefaultKeyword);
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
    this.walkJsx(sf, jsxComponents);

    // Walk function calls
    this.walkCalls(sf, calls);

    return { symbols, imports, jsxComponents, calls };
  }

  // ─── AST Helpers ───────────────────────────────────────────────

  private static SKIP_CALLS = new Set([
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

  private hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
    const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return mods?.some(m => m.kind === kind) ?? false;
  }

  private isFunctionLike(node: ts.Node): boolean {
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

  private walkJsx(node: ts.Node, components: Set<string>): void {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = this.getTagName(node.tagName);
      if (tag && /^[A-Z]/.test(tag) && tag !== 'Fragment') {
        components.add(tag);
      }
    }
    ts.forEachChild(node, child => this.walkJsx(child, components));
  }

  private walkCalls(node: ts.Node, calls: Array<{ calleeName: string; line: number }>): void {
    if (ts.isCallExpression(node)) {
      const name = this.extractCallName(node.expression);
      if (name && !ReconWatcher.SKIP_CALLS.has(name)) {
        calls.push({
          calleeName: name,
          line: node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1,
        });
      }
    }
    ts.forEachChild(node, child => this.walkCalls(child, calls));
  }

  private extractCallName(expr: ts.Expression): string | null {
    if (ts.isIdentifier(expr)) return expr.text;
    if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) {
      if (ts.isIdentifier(expr.expression) && ReconWatcher.SKIP_CALLS.has(expr.expression.text)) {
        return null;
      }
      return expr.name.text;
    }
    return null;
  }

  private getTagName(expr: ts.JsxTagNameExpression): string | null {
    if (ts.isIdentifier(expr)) return expr.text;
    if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
      return expr.expression.text + '.' + expr.name.text;
    }
    return null;
  }

  // ─── Utility ───────────────────────────────────────────────────

  private findEnclosing(
    symbols: Array<{ name: string; kind: string; startLine: number; endLine: number }>,
    line: number,
  ): { name: string; kind: string } | null {
    let best: { name: string; kind: string; startLine: number; endLine: number } | null = null;
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
   * Find the narrowest enclosing function/method for a tree-sitter ExtractedSymbol.
   */
  private findEnclosingExtracted(
    symbols: Array<{ id: string; name: string; type: NodeType; startLine: number; endLine: number }>,
    line: number,
  ): { id: string; name: string } | null {
    let best: { id: string; name: string; type: NodeType; startLine: number; endLine: number } | null = null;
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

  private getPackage(relPath: string): string {
    const parts = relPath.split('/');
    const srcIdx = parts.indexOf('src');
    if (srcIdx >= 0 && srcIdx < parts.length - 1) {
      const afterSrc = parts.slice(srcIdx + 1);
      afterSrc.pop(); // remove filename
      return afterSrc.length > 0 ? afterSrc.join('/') : 'root';
    }
    parts.pop();
    return parts.length > 0 ? parts.join('/') : 'root';
  }

  private resolveImportTarget(
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
}
