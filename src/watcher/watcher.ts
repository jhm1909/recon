/**
 * File Watcher — Surgical Live Re-Index
 *
 * Watches source files with chokidar. On change:
 * 1. Remove old nodes for the file (graph.removeNodesByFile)
 * 2. Re-parse the single file with ts.createSourceFile or tree-sitter
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
import { saveIndex } from '../storage/store.js';
import type { IndexMeta } from '../storage/types.js';
import {
  analyzeTypeScriptFile,
  findEnclosingSymbol,
  findEnclosingExtracted,
  getPackageFromPath,
  resolveImportTarget,
} from './watcher-ts.js';

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
  if (path.includes('.test.') || path.includes('.spec.') || path.endsWith('.d.ts')) return false;
  return true;
}

// ─── Watcher Class ───────────────────────────────────────────────

export class ReconWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private indexLock = false;
  private pendingQueue: Array<{ absPath: string; repoName: string }> = [];
  private unsavedUpdates = 0;
  private saveTimer: NodeJS.Timeout | null = null;
  private readonly SAVE_EVERY_N = 5;
  private readonly SAVE_INTERVAL_MS = 30_000;
  private isSaving = false;

  constructor(
    private graph: KnowledgeGraph,
    private projectDirs: ProjectDir[],
    private debounceMs = 1500,
    private customIgnore: string[] = [],
    private projectRoot?: string,
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

    watcherStatus.active = true;
    watcherStatus.startedAt = new Date().toISOString();
    watcherStatus.watchDirs = this.projectDirs.map(p => p.repoName);

    const shutdown = async () => {
      await this.persistGraph();
      this.stop();
    };
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
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
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    watcherStatus.active = false;
  }

  // ─── Auto-Save ──────────────────────────────────────────────────

  private maybeAutoSave(): void {
    this.unsavedUpdates++;

    if (this.unsavedUpdates >= this.SAVE_EVERY_N) {
      void this.persistGraph();
      return;
    }

    if (!this.saveTimer) {
      this.saveTimer = setTimeout(() => void this.persistGraph(), this.SAVE_INTERVAL_MS);
    }
  }

  private async persistGraph(): Promise<void> {
    if (!this.projectRoot || this.unsavedUpdates === 0 || this.isSaving) return;

    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }

    const count = this.unsavedUpdates;
    this.unsavedUpdates = 0;
    this.isSaving = true;

    try {
      const meta: IndexMeta = {
        version: 1,
        indexedAt: new Date().toISOString(),
        gitCommit: 'watcher',
        gitBranch: 'live',
        stats: { tsModules: 0, tsSymbols: 0, relationships: 0, indexTimeMs: 0 },
        fileHashes: {},
      };
      await saveIndex(this.projectRoot, this.graph, meta);
      console.error(`[recon:watch] Auto-saved graph (${count} updates)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[recon:watch] Auto-save failed: ${msg}`);
    } finally {
      this.isSaving = false;
    }
  }

  /**
   * Handle a file system event with debouncing.
   */
  private handleFileEvent(filePath: string, event: string): void {
    const absPath = resolve(filePath);
    if (!isWatchableFile(absPath)) return;

    const project = this.projectDirs.find(p => absPath.startsWith(resolve(p.dir)));
    if (!project) return;

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
        const removed = this.graph.removeNodesByFile(relPath);
        if (removed > 0) {
          console.error(`[recon:watch] Removed ${removed} nodes (file deleted: ${relPath})`);
        }
        return;
      }

      if (TS_EXTENSIONS.has(ext)) {
        this.surgicalUpdateTS(absPath, relPath, repoName, project.dir);
      } else if (TREE_SITTER_EXTENSIONS.has(ext)) {
        this.surgicalUpdateTreeSitter(absPath, relPath, repoName);
      }

      const elapsed = Math.round(performance.now() - startTime);
      console.error(`[recon:watch] Updated ${relPath} (${elapsed}ms)`);

      watcherStatus.totalUpdates++;
      watcherStatus.lastUpdate = {
        file: relPath,
        timestamp: new Date().toISOString(),
        durationMs: elapsed,
      };

      this.maybeAutoSave();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[recon:watch] Error processing ${absPath}: ${msg}`);

      watcherStatus.errors.push({
        file: absPath,
        error: msg,
        timestamp: new Date().toISOString(),
      });
      if (watcherStatus.errors.length > 10) watcherStatus.errors.shift();
    } finally {
      this.indexLock = false;
      watcherStatus.pendingCount = this.pendingQueue.length;

      if (this.pendingQueue.length > 0) {
        const next = this.pendingQueue.shift()!;
        this.processFile(next.absPath, next.repoName, 'change');
      }
    }
  }

  // ─── Collect Incoming Callers ──────────────────────────────────

  private collectIncomingCallers(relPath: string): {
    oldNodeIds: Set<string>;
    incomingCallers: Array<{ sourceId: string; targetName: string; type: RelationshipType }>;
  } {
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

    return { oldNodeIds, incomingCallers };
  }

  /**
   * Re-link incoming callers from other files to new symbol IDs.
   */
  private relinkCallers(
    incomingCallers: Array<{ sourceId: string; targetName: string; type: RelationshipType }>,
    newSymbolMap: Map<string, string>,
    relCounter: { value: number },
  ): void {
    for (const caller of incomingCallers) {
      const newTargetId = newSymbolMap.get(caller.targetName);
      if (newTargetId && this.graph.getNode(caller.sourceId)) {
        this.graph.addRelationship({
          id: `rel:watch:${++relCounter.value}`,
          type: caller.type,
          sourceId: caller.sourceId,
          targetId: newTargetId,
          confidence: 0.7,
        });
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

    // 1. Collect incoming callers BEFORE removal
    const { incomingCallers } = this.collectIncomingCallers(relPath);

    // 2. Remove old nodes + relationships
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

    // 4. Analyze the file (delegated to watcher-ts.ts)
    const analysis = analyzeTypeScriptFile(sf);

    // 5. Derive package from path
    const pkg = getPackageFromPath(relPath);

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
    const relCounter = { value: Date.now() };
    const newSymbolMap = new Map<string, string>();

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

      this.graph.addRelationship({
        id: `rel:watch:${++relCounter.value}`,
        type: RelationshipType.DEFINES,
        sourceId: fileNodeId,
        targetId: nodeId,
        confidence: 1.0,
      });

      newSymbolMap.set(sym.name, nodeId);
    }

    // 8. IMPORT edges
    for (const imp of analysis.imports) {
      if (imp.isTypeOnly) continue;
      const targetFileId = resolveImportTarget(imp.specifier, absPath, projectDir);
      if (targetFileId && this.graph.getNode(targetFileId)) {
        this.graph.addRelationship({
          id: `rel:watch:${++relCounter.value}`,
          type: RelationshipType.IMPORTS,
          sourceId: fileNodeId,
          targetId: targetFileId,
          confidence: 1.0,
        });
      }
    }

    // 9. CALLS edges
    for (const call of analysis.calls) {
      const callerSym = findEnclosingSymbol(analysis.symbols, call.line);
      if (!callerSym) continue;

      const callerPrefix = callerSym.kind === 'component' ? 'ts:comp' : 'ts:func';
      const callerNodeId = `${callerPrefix}:${relPath}:${callerSym.name}`;

      const targets = this.graph.findByName(call.calleeName);
      const target = targets.find(n =>
        n.file !== relPath && n.exported &&
        (n.type === NodeType.Function || n.type === NodeType.Component),
      );

      if (target && target.id !== callerNodeId) {
        this.graph.addRelationship({
          id: `rel:watch:${++relCounter.value}`,
          type: RelationshipType.CALLS,
          sourceId: callerNodeId,
          targetId: target.id,
          confidence: 0.7,
        });
      }
    }

    // 10. USES_COMPONENT edges
    for (const jsxName of analysis.jsxComponents) {
      if (jsxName.includes('.')) continue;

      const targets = this.graph.findByName(jsxName);
      const target = targets.find(n => n.type === NodeType.Component && n.file !== relPath);

      if (target) {
        const sourceComp = analysis.symbols.find(s => s.kind === 'component' && s.isExported);
        const sourceId = sourceComp
          ? `ts:comp:${relPath}:${sourceComp.name}`
          : fileNodeId;

        if (target.id !== sourceId) {
          this.graph.addRelationship({
            id: `rel:watch:${++relCounter.value}`,
            type: RelationshipType.USES_COMPONENT,
            sourceId,
            targetId: target.id,
            confidence: 0.9,
          });
        }
      }
    }

    // 11. Re-link incoming callers
    this.relinkCallers(incomingCallers, newSymbolMap, relCounter);
  }

  // ─── Tree-sitter Surgical Update ───────────────────────────────

  private surgicalUpdateTreeSitter(
    absPath: string,
    relPath: string,
    repoName: string,
  ): void {
    const language = getLanguageForFile(absPath);
    if (!language || !isLanguageAvailable(language)) return;

    let content: string;
    try {
      content = readFileSync(absPath, 'utf-8');
    } catch {
      this.graph.removeNodesByFile(relPath);
      return;
    }

    // 1. Save incoming callers BEFORE removal
    const { incomingCallers } = this.collectIncomingCallers(relPath);

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
    const relCounter = { value: Date.now() };
    const newSymbolMap = new Map<string, string>();

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
        id: `rel:watch:${++relCounter.value}`,
        type: RelationshipType.DEFINES,
        sourceId: fileNodeId,
        targetId: sym.id,
        confidence: 1.0,
      });

      newSymbolMap.set(sym.name, sym.id);
    }

    // 6. Resolve CALLS edges
    for (const call of extraction.calls) {
      const caller = findEnclosingExtracted(extraction.symbols, call.line);
      if (!caller) continue;

      const targets = this.graph.findByName(call.calleeName);
      const target = targets.find(n =>
        n.file !== relPath && n.exported &&
        (n.type === NodeType.Function || n.type === NodeType.Method),
      );

      if (target && target.id !== caller.id) {
        this.graph.addRelationship({
          id: `rel:watch:${++relCounter.value}`,
          type: RelationshipType.CALLS,
          sourceId: caller.id,
          targetId: target.id,
          confidence: 0.7,
        });
      }
    }

    // 7. HAS_METHOD edges
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
          id: `rel:watch:${++relCounter.value}`,
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
        id: `rel:watch:${++relCounter.value}`,
        type: relType,
        sourceId: childId,
        targetId: parent.id,
        confidence: 0.9,
      });
    }

    // 9. Re-link incoming callers
    this.relinkCallers(incomingCallers, newSymbolMap, relCounter);
  }
}
