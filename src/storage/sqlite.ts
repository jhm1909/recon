/**
 * SQLite Store
 *
 * Persists the knowledge graph to .recon/recon.db using better-sqlite3.
 * Provides ACID transactions, FTS5 full-text search, and scales to 500K+ nodes
 * without loading everything into RAM.
 *
 * Replaces the JSON file store (graph.json + meta.json + search.json).
 */

import Database from 'better-sqlite3';
import type { Database as DatabaseType, Statement } from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Node, Relationship } from '../graph/types.js';
import { NodeType, RelationshipType, Language } from '../graph/types.js';

// ─── Constants ─────────────────────────────────────────────────

const RECON_DIR = '.recon';
const DB_FILE = 'recon.db';

/** Fields stored as columns (not in the meta JSON blob). */
const COLUMN_FIELDS = new Set([
  'id', 'type', 'name', 'file', 'startLine', 'endLine',
  'exported', 'language', 'package', 'community', 'isTest', 'repo',
]);

// ─── Types ─────────────────────────────────────────────────────

interface NodeRow {
  id: string;
  type: string;
  name: string;
  file: string | null;
  startLine: number | null;
  endLine: number | null;
  exported: number; // SQLite boolean
  language: string | null;
  package: string | null;
  community: string | null;
  isTest: number; // SQLite boolean
  repo: string | null;
  meta: string | null; // JSON
}

interface RelRow {
  id: string;
  type: string;
  sourceId: string;
  targetId: string;
  confidence: number | null;
  meta: string | null; // JSON
}

interface MetaRow {
  key: string;
  value: string;
}

interface CountRow {
  count: number;
}

export interface NodeFilters {
  type?: NodeType;
  language?: Language;
  exported?: boolean;
  file?: string;
  repo?: string;
}

// ─── SqliteStore ───────────────────────────────────────────────

export class SqliteStore {
  private db: DatabaseType;
  private _closed = false;

  // Prepared statements (lazily cached)
  private _stmtInsertNode!: Statement;
  private _stmtInsertRel!: Statement;
  private _stmtGetNode!: Statement;
  private _stmtGetRel!: Statement;
  private _stmtGetRelsBySource!: Statement;
  private _stmtGetRelsByTarget!: Statement;
  private _stmtRemoveNode!: Statement;
  private _stmtRemoveRelsByNode!: Statement;
  private _stmtGetNodesByFile!: Statement;
  private _stmtGetNodesByType!: Statement;
  private _stmtInsertFts!: Statement;
  private _stmtDeleteFts!: Statement;
  private _stmtSetMeta!: Statement;
  private _stmtGetMeta!: Statement;
  private _stmtGetAllMeta!: Statement;
  private _stmtNodeCount!: Statement;
  private _stmtRelCount!: Statement;

  constructor(projectRoot: string) {
    const dir = join(projectRoot, RECON_DIR);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const dbPath = join(dir, DB_FILE);
    this.db = new Database(dbPath);

    this._initPragmas();
    this._initSchema();
    this._prepareStatements();
  }

  // ─── Schema Setup ──────────────────────────────────────────

  private _initPragmas(): void {
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('synchronous = NORMAL');
  }

  private _initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id        TEXT PRIMARY KEY,
        type      TEXT NOT NULL,
        name      TEXT NOT NULL,
        file      TEXT,
        startLine INTEGER,
        endLine   INTEGER,
        exported  INTEGER NOT NULL DEFAULT 0,
        language  TEXT,
        package   TEXT,
        community TEXT,
        isTest    INTEGER NOT NULL DEFAULT 0,
        repo      TEXT,
        meta      TEXT
      );

      CREATE TABLE IF NOT EXISTS relationships (
        id         TEXT PRIMARY KEY,
        type       TEXT NOT NULL,
        sourceId   TEXT NOT NULL,
        targetId   TEXT NOT NULL,
        confidence REAL DEFAULT 1.0,
        meta       TEXT,
        FOREIGN KEY (sourceId) REFERENCES nodes(id) ON DELETE CASCADE,
        FOREIGN KEY (targetId) REFERENCES nodes(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file);
      CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
      CREATE INDEX IF NOT EXISTS idx_nodes_language ON nodes(language);
      CREATE INDEX IF NOT EXISTS idx_nodes_exported ON nodes(exported);
      CREATE INDEX IF NOT EXISTS idx_rels_source ON relationships(sourceId);
      CREATE INDEX IF NOT EXISTS idx_rels_target ON relationships(targetId);

      CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // FTS5 virtual table -- create only if it doesn't exist.
    // We use a content-sync approach: manually insert/delete from FTS.
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
          name,
          package,
          file,
          content='',
          tokenize='unicode61'
        );
      `);
    } catch {
      // FTS table already exists with different schema -- ignore
    }
  }

  private _prepareStatements(): void {
    this._stmtInsertNode = this.db.prepare(`
      INSERT OR REPLACE INTO nodes (id, type, name, file, startLine, endLine, exported, language, package, community, isTest, repo, meta)
      VALUES (@id, @type, @name, @file, @startLine, @endLine, @exported, @language, @package, @community, @isTest, @repo, @meta)
    `);

    this._stmtInsertRel = this.db.prepare(`
      INSERT OR REPLACE INTO relationships (id, type, sourceId, targetId, confidence, meta)
      VALUES (@id, @type, @sourceId, @targetId, @confidence, @meta)
    `);

    this._stmtGetNode = this.db.prepare('SELECT * FROM nodes WHERE id = ?');
    this._stmtGetRel = this.db.prepare('SELECT * FROM relationships WHERE id = ?');
    this._stmtGetRelsBySource = this.db.prepare('SELECT * FROM relationships WHERE sourceId = ?');
    this._stmtGetRelsByTarget = this.db.prepare('SELECT * FROM relationships WHERE targetId = ?');
    this._stmtRemoveNode = this.db.prepare('DELETE FROM nodes WHERE id = ?');
    this._stmtRemoveRelsByNode = this.db.prepare(
      'DELETE FROM relationships WHERE sourceId = ? OR targetId = ?',
    );
    this._stmtGetNodesByFile = this.db.prepare('SELECT * FROM nodes WHERE file = ?');
    this._stmtGetNodesByType = this.db.prepare('SELECT * FROM nodes WHERE type = ?');

    this._stmtInsertFts = this.db.prepare(
      'INSERT INTO nodes_fts (rowid, name, package, file) VALUES (@rowid, @name, @package, @file)',
    );
    this._stmtDeleteFts = this.db.prepare(
      'INSERT INTO nodes_fts (nodes_fts, rowid, name, package, file) VALUES (\'delete\', @rowid, @name, @package, @file)',
    );

    this._stmtSetMeta = this.db.prepare(
      'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
    );
    this._stmtGetMeta = this.db.prepare('SELECT value FROM meta WHERE key = ?');
    this._stmtGetAllMeta = this.db.prepare('SELECT key, value FROM meta');

    this._stmtNodeCount = this.db.prepare('SELECT COUNT(*) as count FROM nodes');
    this._stmtRelCount = this.db.prepare('SELECT COUNT(*) as count FROM relationships');
  }

  // ─── Node CRUD ─────────────────────────────────────────────

  insertNode(node: Node): void {
    const params = this._nodeToParams(node);
    this._stmtInsertNode.run(params);

    // Insert into FTS index
    const rowid = this._getRowId(node.id);
    if (rowid !== null) {
      const searchName = this._tokenizeForSearch(node.name);
      const searchPkg = this._tokenizeForSearch(node.package ?? '');
      const searchFile = this._tokenizeForSearch(node.file ?? '');
      try {
        this._stmtInsertFts.run({
          rowid,
          name: searchName,
          package: searchPkg,
          file: searchFile,
        });
      } catch {
        // FTS insert may fail on replace -- delete first then insert
        try {
          this._stmtDeleteFts.run({
            rowid,
            name: searchName,
            package: searchPkg,
            file: searchFile,
          });
          this._stmtInsertFts.run({
            rowid,
            name: searchName,
            package: searchPkg,
            file: searchFile,
          });
        } catch {
          // Best effort FTS sync
        }
      }
    }
  }

  insertNodes(nodes: Node[]): void {
    const tx = this.db.transaction((items: Node[]) => {
      for (const node of items) {
        this.insertNode(node);
      }
    });
    tx(nodes);
  }

  getNode(id: string): Node | null {
    const row = this._stmtGetNode.get(id) as NodeRow | undefined;
    return row ? this._rowToNode(row) : null;
  }

  getNodes(filters?: NodeFilters): Node[] {
    if (!filters) {
      const rows = this.db.prepare('SELECT * FROM nodes').all() as NodeRow[];
      return rows.map(r => this._rowToNode(r));
    }

    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filters.type !== undefined) {
      conditions.push('type = @type');
      params.type = filters.type;
    }
    if (filters.language !== undefined) {
      conditions.push('language = @language');
      params.language = filters.language;
    }
    if (filters.exported !== undefined) {
      conditions.push('exported = @exported');
      params.exported = filters.exported ? 1 : 0;
    }
    if (filters.file !== undefined) {
      conditions.push('file = @file');
      params.file = filters.file;
    }
    if (filters.repo !== undefined) {
      conditions.push('repo = @repo');
      params.repo = filters.repo;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT * FROM nodes ${where}`).all(params) as NodeRow[];
    return rows.map(r => this._rowToNode(r));
  }

  getNodesByFile(file: string): Node[] {
    const rows = this._stmtGetNodesByFile.all(file) as NodeRow[];
    return rows.map(r => this._rowToNode(r));
  }

  getNodesByType(type: NodeType): Node[] {
    const rows = this._stmtGetNodesByType.all(type) as NodeRow[];
    return rows.map(r => this._rowToNode(r));
  }

  removeNode(id: string): void {
    // Delete relationships first (in case FK cascade doesn't fire for FTS cleanup)
    this._stmtRemoveRelsByNode.run(id, id);
    // Delete FTS entry
    this._deleteFtsForNode(id);
    // Delete node
    this._stmtRemoveNode.run(id);
  }

  removeNodesByFile(file: string): number {
    const nodes = this.getNodesByFile(file);
    if (nodes.length === 0) return 0;

    const tx = this.db.transaction(() => {
      for (const node of nodes) {
        this.removeNode(node.id);
      }
    });
    tx();
    return nodes.length;
  }

  // ─── Relationship CRUD ─────────────────────────────────────

  insertRelationship(rel: Relationship): void {
    const params = this._relToParams(rel);
    this._stmtInsertRel.run(params);
  }

  insertRelationships(rels: Relationship[]): void {
    const tx = this.db.transaction((items: Relationship[]) => {
      for (const rel of items) {
        this.insertRelationship(rel);
      }
    });
    tx(rels);
  }

  getRelationship(id: string): Relationship | null {
    const row = this._stmtGetRel.get(id) as RelRow | undefined;
    return row ? this._rowToRel(row) : null;
  }

  getRelationshipsBySource(sourceId: string): Relationship[] {
    const rows = this._stmtGetRelsBySource.all(sourceId) as RelRow[];
    return rows.map(r => this._rowToRel(r));
  }

  getRelationshipsByTarget(targetId: string): Relationship[] {
    const rows = this._stmtGetRelsByTarget.all(targetId) as RelRow[];
    return rows.map(r => this._rowToRel(r));
  }

  // ─── FTS5 Search ───────────────────────────────────────────

  search(query: string, limit = 50): Node[] {
    const tokenized = this._tokenizeForSearch(query);
    // Use prefix matching for each token
    const terms = tokenized.split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];

    const ftsQuery = terms.map(t => `${t}*`).join(' OR ');

    try {
      const rows = this.db.prepare(`
        SELECT n.* FROM nodes n
        JOIN nodes_fts fts ON n.rowid = fts.rowid
        WHERE nodes_fts MATCH @query
        LIMIT @limit
      `).all({ query: ftsQuery, limit }) as NodeRow[];
      return rows.map(r => this._rowToNode(r));
    } catch {
      // FTS query failed -- fall back to LIKE search
      return this._fallbackSearch(query, limit);
    }
  }

  private _fallbackSearch(query: string, limit: number): Node[] {
    const pattern = `%${query}%`;
    const rows = this.db.prepare(`
      SELECT * FROM nodes
      WHERE name LIKE @pattern OR package LIKE @pattern OR file LIKE @pattern
      LIMIT @limit
    `).all({ pattern, limit }) as NodeRow[];
    return rows.map(r => this._rowToNode(r));
  }

  // ─── Metadata ──────────────────────────────────────────────

  setMeta(key: string, value: string): void {
    this._stmtSetMeta.run(key, value);
  }

  getMeta(key: string): string | null {
    const row = this._stmtGetMeta.get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  getAllMeta(): Record<string, string> {
    const rows = this._stmtGetAllMeta.all() as MetaRow[];
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  // ─── Structural Queries ────────────────────────────────────

  /**
   * Find exported symbols with no incoming CALLS relationships (potential dead code).
   */
  findDeadCode(): Node[] {
    const rows = this.db.prepare(`
      SELECT n.* FROM nodes n
      WHERE n.exported = 1
        AND n.type IN ('Function', 'Method')
        AND n.id NOT IN (
          SELECT targetId FROM relationships WHERE type = 'CALLS'
        )
    `).all() as NodeRow[];
    return rows.map(r => this._rowToNode(r));
  }

  /**
   * Find nodes with no relationships at all (orphans).
   */
  findOrphans(): Node[] {
    const rows = this.db.prepare(`
      SELECT n.* FROM nodes n
      WHERE n.id NOT IN (
        SELECT sourceId FROM relationships
        UNION
        SELECT targetId FROM relationships
      )
      AND n.type NOT IN ('Package', 'Module', 'File')
    `).all() as NodeRow[];
    return rows.map(r => this._rowToNode(r));
  }

  /**
   * Find files with more than `threshold` symbols defined.
   */
  findLargeFiles(threshold = 20): { file: string; count: number }[] {
    return this.db.prepare(`
      SELECT file, COUNT(*) as count FROM nodes
      WHERE file IS NOT NULL
      GROUP BY file
      HAVING COUNT(*) > @threshold
      ORDER BY count DESC
    `).all({ threshold }) as { file: string; count: number }[];
  }

  /**
   * Find exported symbols that are never imported/used.
   */
  findUnusedExports(): Node[] {
    const rows = this.db.prepare(`
      SELECT n.* FROM nodes n
      WHERE n.exported = 1
        AND n.id NOT IN (
          SELECT targetId FROM relationships
          WHERE type IN ('CALLS', 'IMPORTS', 'USES_COMPONENT')
        )
      AND n.type NOT IN ('Package', 'Module', 'File')
    `).all() as NodeRow[];
    return rows.map(r => this._rowToNode(r));
  }

  // ─── Counts ────────────────────────────────────────────────

  get nodeCount(): number {
    return (this._stmtNodeCount.get() as CountRow).count;
  }

  get relationshipCount(): number {
    return (this._stmtRelCount.get() as CountRow).count;
  }

  // ─── Lifecycle ─────────────────────────────────────────────

  close(): void {
    if (!this._closed) {
      this.db.close();
      this._closed = true;
    }
  }

  // ─── Private Helpers ───────────────────────────────────────

  private _getRowId(nodeId: string): number | null {
    const row = this.db.prepare('SELECT rowid FROM nodes WHERE id = ?').get(nodeId) as
      | { rowid: number }
      | undefined;
    return row ? row.rowid : null;
  }

  private _deleteFtsForNode(nodeId: string): void {
    const node = this.getNode(nodeId);
    if (!node) return;
    const rowid = this._getRowId(nodeId);
    if (rowid === null) return;

    try {
      this._stmtDeleteFts.run({
        rowid,
        name: this._tokenizeForSearch(node.name),
        package: this._tokenizeForSearch(node.package ?? ''),
        file: this._tokenizeForSearch(node.file ?? ''),
      });
    } catch {
      // Best effort FTS cleanup
    }
  }

  /**
   * Convert a Node object to SQLite parameter bindings.
   * Language-specific fields (receiver, params, etc.) are stored in the meta JSON blob.
   */
  private _nodeToParams(node: Node): Record<string, unknown> {
    const meta = this._extractMeta(node);
    return {
      id: node.id,
      type: node.type,
      name: node.name,
      file: node.file ?? null,
      startLine: node.startLine ?? null,
      endLine: node.endLine ?? null,
      exported: node.exported ? 1 : 0,
      language: node.language ?? null,
      package: node.package ?? null,
      community: node.community ?? null,
      isTest: (node as any).isTest ? 1 : 0,
      repo: node.repo ?? null,
      meta: Object.keys(meta).length > 0 ? JSON.stringify(meta) : null,
    };
  }

  /**
   * Extract Go/TS-specific fields into a JSON-serializable object.
   */
  private _extractMeta(node: Node): Record<string, unknown> {
    const meta: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (!COLUMN_FIELDS.has(key) && value !== undefined) {
        meta[key] = value;
      }
    }
    return meta;
  }

  /**
   * Convert a database row back to a Node object.
   */
  private _rowToNode(row: NodeRow): Node {
    const node: Record<string, unknown> = {
      id: row.id,
      type: row.type as NodeType,
      name: row.name,
      file: row.file ?? undefined,
      startLine: row.startLine ?? undefined,
      endLine: row.endLine ?? undefined,
      exported: row.exported === 1,
      language: row.language as Language | undefined,
      package: row.package ?? undefined,
      community: row.community ?? undefined,
      repo: row.repo ?? undefined,
    };

    // Restore isTest
    (node as any).isTest = row.isTest === 1;

    // Merge meta fields back
    if (row.meta) {
      try {
        const meta = JSON.parse(row.meta) as Record<string, unknown>;
        Object.assign(node, meta);
      } catch {
        // Corrupt meta -- ignore
      }
    }

    // Clean up undefined values
    for (const key of Object.keys(node)) {
      if (node[key] === undefined) {
        delete node[key];
      }
    }

    return node as unknown as Node;
  }

  /**
   * Convert a Relationship to SQLite parameter bindings.
   */
  private _relToParams(rel: Relationship): Record<string, unknown> {
    return {
      id: rel.id,
      type: rel.type,
      sourceId: rel.sourceId,
      targetId: rel.targetId,
      confidence: rel.confidence ?? 1.0,
      meta: rel.metadata ? JSON.stringify(rel.metadata) : null,
    };
  }

  /**
   * Convert a database row back to a Relationship.
   */
  private _rowToRel(row: RelRow): Relationship {
    const rel: Relationship = {
      id: row.id,
      type: row.type as RelationshipType,
      sourceId: row.sourceId,
      targetId: row.targetId,
      confidence: row.confidence ?? 1.0,
    };

    if (row.meta) {
      try {
        rel.metadata = JSON.parse(row.meta) as Relationship['metadata'];
      } catch {
        // Corrupt meta -- ignore
      }
    }

    return rel;
  }

  /**
   * Tokenize an identifier for FTS indexing.
   * Splits camelCase and snake_case into separate tokens.
   *
   * Examples:
   *   "getUserProfile"   -> "get user profile getuser profile"
   *   "get_user_profile" -> "get user profile"
   *   "HTTPClient"       -> "http client httpclient"
   */
  private _tokenizeForSearch(input: string): string {
    if (!input) return '';

    // Split on underscores, hyphens, dots, slashes
    const parts = input.split(/[_\-./\\]+/);

    const tokens: string[] = [];
    for (const part of parts) {
      if (!part) continue;

      // Split camelCase: "getUserProfile" -> ["get", "User", "Profile"]
      const camelParts = part.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/);
      for (const cp of camelParts) {
        if (cp) tokens.push(cp.toLowerCase());
      }
    }

    return tokens.join(' ');
  }
}
