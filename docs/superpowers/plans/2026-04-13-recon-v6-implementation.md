# Recon v6.0.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Recon from JSON-based storage with 14 tools to SQLite+FTS5 storage with 8 smarter tools, adding test impact analysis, dead code detection, and natural language search.

**Architecture:** SQLite replaces 4 JSON files as the persistence layer. KnowledgeGraph remains in-memory for fast graph traversal (impact analysis, context lookup), loaded from SQLite on startup. FTS5 replaces custom BM25 for search. Tool surface drops from 14 to 8, each tool doing more with less agent effort.

**Tech Stack:** TypeScript, better-sqlite3, FTS5, tree-sitter, @modelcontextprotocol/sdk, Vitest

**Spec:** `docs/superpowers/specs/2026-04-13-recon-v6-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|---|---|
| `src/storage/sqlite.ts` | SQLite connection, schema, CRUD, FTS5 queries |
| `src/storage/migrate.ts` | v5 JSON → v6 SQLite auto-migration |
| `src/mcp/errors.ts` | Structured error types + suggestion builder |
| `src/mcp/rules.ts` | Dead code, circular deps, unused exports, orphans, large files |
| `test/unit/sqlite.test.ts` | SQLite storage tests |
| `test/unit/find.test.ts` | recon_find natural language routing tests |
| `test/unit/rules.test.ts` | recon_rules detection tests |
| `test/unit/errors.test.ts` | Structured error tests |
| `test/unit/migrate.test.ts` | v5→v6 migration tests |

### Modified Files
| File | Changes |
|---|---|
| `package.json` | Add better-sqlite3, bump to 6.0.0 |
| `src/graph/types.ts` | Add `isTest` to Node, add new structural keywords |
| `src/graph/graph.ts` | Add `removeNode(id)`, `getNodesByFile(file)` |
| `src/storage/store.ts` | Rewrite: delegate to sqlite.ts, keep API surface |
| `src/mcp/tools.ts` | Replace 14 tool defs with 8 new ones |
| `src/mcp/handlers.ts` | Rewrite handler dispatch for 8 tools |
| `src/mcp/server.ts` | Wire new tools, resources, prompts |
| `src/mcp/instructions.ts` | Reduce from 27KB to ~500 bytes |
| `src/mcp/resources.ts` | Reduce from 5 to 3 resources |
| `src/mcp/prompts.ts` | Update 3 prompts for new tool names |
| `src/mcp/rename.ts` | Fix disambiguation bug (structured error) |
| `src/config/config.ts` | Add crossLanguage, testPatterns, rules config |
| `src/export/exporter.ts` | Remove DOT format, keep Mermaid only |
| `src/analyzers/cross-language.ts` | Remove hardcoded paths, add auto-discovery |
| `src/analyzers/ts-analyzer.ts` | Index test files with isTest flag |
| `src/analyzers/tree-sitter/extractor.ts` | Add test file detection |
| `src/cli/index.ts` | Remove init, review commands |
| `src/cli/commands.ts` | Update for SQLite, new config fields |
| `src/watcher/watcher.ts` | Write to SQLite instead of in-memory only |
| `src/server/http.ts` | Bind localhost, restrict CORS |

### Removed Files
| File | Reason |
|---|---|
| `src/mcp/hints.ts` | Hints moved into tool descriptions |
| `src/mcp/augmentation.ts` | Merged into recon_explain handler |
| `src/mcp/staleness.ts` | Merged into recon_map handler |

---

## Phase 1: Storage Foundation

### Task 1: SQLite Storage Module

**Files:**
- Create: `src/storage/sqlite.ts`
- Modify: `package.json`
- Test: `test/unit/sqlite.test.ts`

- [ ] **Step 1: Install better-sqlite3**

```bash
npm install better-sqlite3
npm install -D @types/better-sqlite3
```

Verify: `node -e "require('better-sqlite3')"` should print no errors.

- [ ] **Step 2: Write failing tests for SqliteStore**

Create `test/unit/sqlite.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStore } from '../../src/storage/sqlite.js';
import { NodeType, RelationshipType, Language } from '../../src/graph/types.js';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

function makeNode(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: NodeType.Function,
    name,
    file: 'src/main.ts',
    startLine: 1,
    endLine: 10,
    language: Language.TypeScript,
    package: 'main',
    exported: true,
    ...overrides,
  };
}

function makeRel(source: string, target: string, type = RelationshipType.CALLS) {
  return {
    id: `${source}->${target}`,
    type,
    sourceId: source,
    targetId: target,
    confidence: 1.0,
  };
}

describe('SqliteStore', () => {
  let tmpDir: string;
  let store: SqliteStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'recon-test-'));
    store = new SqliteStore(tmpDir);
  });

  afterEach(async () => {
    store.close();
    await rm(tmpDir, { recursive: true });
  });

  it('creates .recon/recon.db on initialization', () => {
    expect(store.isOpen).toBe(true);
  });

  it('inserts and retrieves a node', () => {
    const node = makeNode('ts:func:main', 'main');
    store.insertNode(node);
    const result = store.getNode('ts:func:main');
    expect(result).toBeDefined();
    expect(result!.name).toBe('main');
    expect(result!.type).toBe(NodeType.Function);
  });

  it('inserts and retrieves a relationship', () => {
    const n1 = makeNode('ts:func:a', 'funcA');
    const n2 = makeNode('ts:func:b', 'funcB');
    store.insertNode(n1);
    store.insertNode(n2);

    const rel = makeRel('ts:func:a', 'ts:func:b');
    store.insertRelationship(rel);

    const result = store.getRelationship(rel.id);
    expect(result).toBeDefined();
    expect(result!.sourceId).toBe('ts:func:a');
  });

  it('removes nodes by file', () => {
    store.insertNode(makeNode('ts:func:a', 'a', { file: 'src/a.ts' }));
    store.insertNode(makeNode('ts:func:b', 'b', { file: 'src/a.ts' }));
    store.insertNode(makeNode('ts:func:c', 'c', { file: 'src/b.ts' }));

    const removed = store.removeNodesByFile('src/a.ts');
    expect(removed).toBe(2);
    expect(store.getNode('ts:func:c')).toBeDefined();
    expect(store.getNode('ts:func:a')).toBeUndefined();
  });

  it('cascades relationship deletion when node is removed', () => {
    store.insertNode(makeNode('ts:func:a', 'a'));
    store.insertNode(makeNode('ts:func:b', 'b'));
    store.insertRelationship(makeRel('ts:func:a', 'ts:func:b'));

    store.removeNode('ts:func:a');
    const rels = store.getRelationshipsBySource('ts:func:a');
    expect(rels).toHaveLength(0);
  });

  it('searches nodes via FTS5', () => {
    store.insertNode(makeNode('ts:func:getUserById', 'getUserById'));
    store.insertNode(makeNode('ts:func:deleteUser', 'deleteUser'));
    store.insertNode(makeNode('ts:func:createOrder', 'createOrder'));

    const results = store.search('user');
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.map(r => r.name)).toContain('getUserById');
    expect(results.map(r => r.name)).toContain('deleteUser');
  });

  it('returns node count', () => {
    store.insertNode(makeNode('ts:func:a', 'a'));
    store.insertNode(makeNode('ts:func:b', 'b'));
    expect(store.nodeCount).toBe(2);
  });

  it('returns relationship count', () => {
    store.insertNode(makeNode('ts:func:a', 'a'));
    store.insertNode(makeNode('ts:func:b', 'b'));
    store.insertRelationship(makeRel('ts:func:a', 'ts:func:b'));
    expect(store.relationshipCount).toBe(1);
  });

  it('filters nodes by type', () => {
    store.insertNode(makeNode('ts:func:a', 'a', { type: NodeType.Function }));
    store.insertNode(makeNode('ts:class:b', 'B', { type: NodeType.Class }));
    const funcs = store.getNodesByType(NodeType.Function);
    expect(funcs).toHaveLength(1);
    expect(funcs[0].name).toBe('a');
  });

  it('handles isTest flag', () => {
    store.insertNode(makeNode('ts:func:a', 'a', { isTest: false }));
    store.insertNode(makeNode('ts:func:aTest', 'a.test', { isTest: true }));
    const nonTest = store.getNodes({ isTest: false });
    expect(nonTest).toHaveLength(1);
    expect(nonTest[0].name).toBe('a');
  });

  it('saves and loads metadata', () => {
    store.setMeta('gitCommit', 'abc123');
    store.setMeta('schemaVersion', '6');
    expect(store.getMeta('gitCommit')).toBe('abc123');
    expect(store.getMeta('schemaVersion')).toBe('6');
  });

  it('uses transactions for batch inserts', () => {
    const nodes = Array.from({ length: 100 }, (_, i) =>
      makeNode(`ts:func:f${i}`, `func${i}`)
    );
    store.insertNodes(nodes);
    expect(store.nodeCount).toBe(100);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run test/unit/sqlite.test.ts
```

Expected: FAIL — `Cannot find module '../../src/storage/sqlite.js'`

- [ ] **Step 4: Implement SqliteStore**

Create `src/storage/sqlite.ts`:

```typescript
import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import type { Node, Relationship } from '../graph/types.js';
import { NodeType, RelationshipType, Language } from '../graph/types.js';

const RECON_DIR = '.recon';
const DB_FILE = 'recon.db';
const SCHEMA_VERSION = '6';

interface NodeFilter {
  type?: NodeType;
  language?: Language;
  package?: string;
  file?: string;
  isTest?: boolean;
  exported?: boolean;
}

interface SearchResult {
  id: string;
  name: string;
  type: NodeType;
  file: string;
  startLine: number;
  package: string;
  exported: boolean;
  rank: number;
}

export class SqliteStore {
  private db: Database.Database;
  private _isOpen = false;

  constructor(projectRoot: string) {
    const reconDir = join(projectRoot, RECON_DIR);
    if (!existsSync(reconDir)) {
      mkdirSync(reconDir, { recursive: true });
    }

    this.db = new Database(join(reconDir, DB_FILE));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this._initSchema();
    this._isOpen = true;
  }

  get isOpen(): boolean {
    return this._isOpen;
  }

  private _initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        file TEXT,
        startLine INTEGER,
        endLine INTEGER,
        exported INTEGER DEFAULT 0,
        language TEXT,
        package TEXT,
        community TEXT,
        isTest INTEGER DEFAULT 0,
        repo TEXT,
        meta TEXT
      );

      CREATE TABLE IF NOT EXISTS relationships (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        sourceId TEXT NOT NULL,
        targetId TEXT NOT NULL,
        confidence REAL DEFAULT 1.0,
        meta TEXT,
        FOREIGN KEY (sourceId) REFERENCES nodes(id) ON DELETE CASCADE,
        FOREIGN KEY (targetId) REFERENCES nodes(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file);
      CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
      CREATE INDEX IF NOT EXISTS idx_nodes_package ON nodes(package);
      CREATE INDEX IF NOT EXISTS idx_nodes_language ON nodes(language);
      CREATE INDEX IF NOT EXISTS idx_nodes_test ON nodes(isTest);
      CREATE INDEX IF NOT EXISTS idx_rels_source ON relationships(sourceId);
      CREATE INDEX IF NOT EXISTS idx_rels_target ON relationships(targetId);
      CREATE INDEX IF NOT EXISTS idx_rels_type ON relationships(type);
    `);

    // FTS5 virtual table for full-text search
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
        name, package, file, id UNINDEXED,
        tokenize='unicode61 remove_diacritics 2 tokenchars _'
      );
    `);

    // Set schema version if not exists
    const existing = this.getMeta('schemaVersion');
    if (!existing) {
      this.setMeta('schemaVersion', SCHEMA_VERSION);
    }
  }

  // ── Node Operations ──

  insertNode(node: Node): void {
    const meta = this._extractMeta(node);
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO nodes (id, type, name, file, startLine, endLine,
        exported, language, package, community, isTest, repo, meta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      node.id, node.type, node.name, node.file ?? null,
      node.startLine ?? null, node.endLine ?? null,
      node.exported ? 1 : 0, node.language ?? null,
      node.package ?? null, node.community ?? null,
      (node as any).isTest ? 1 : 0, node.repo ?? null,
      meta ? JSON.stringify(meta) : null
    );

    // Update FTS index
    this.db.prepare(`
      INSERT OR REPLACE INTO nodes_fts (rowid, name, package, file, id)
      VALUES (
        (SELECT rowid FROM nodes WHERE id = ?),
        ?, ?, ?, ?
      )
    `).run(node.id, node.name, node.package ?? '', node.file ?? '', node.id);
  }

  insertNodes(nodes: Node[]): void {
    const transaction = this.db.transaction((ns: Node[]) => {
      for (const node of ns) {
        this.insertNode(node);
      }
    });
    transaction(nodes);
  }

  getNode(id: string): Node | undefined {
    const row = this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as any;
    return row ? this._rowToNode(row) : undefined;
  }

  getNodes(filter: NodeFilter = {}): Node[] {
    let sql = 'SELECT * FROM nodes WHERE 1=1';
    const params: unknown[] = [];

    if (filter.type !== undefined) {
      sql += ' AND type = ?';
      params.push(filter.type);
    }
    if (filter.language !== undefined) {
      sql += ' AND language = ?';
      params.push(filter.language);
    }
    if (filter.package !== undefined) {
      sql += ' AND package = ?';
      params.push(filter.package);
    }
    if (filter.file !== undefined) {
      sql += ' AND file = ?';
      params.push(filter.file);
    }
    if (filter.isTest !== undefined) {
      sql += ' AND isTest = ?';
      params.push(filter.isTest ? 1 : 0);
    }
    if (filter.exported !== undefined) {
      sql += ' AND exported = ?';
      params.push(filter.exported ? 1 : 0);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(r => this._rowToNode(r));
  }

  getNodesByFile(file: string): Node[] {
    return this.getNodes({ file });
  }

  getNodesByType(type: NodeType): Node[] {
    return this.getNodes({ type });
  }

  removeNode(id: string): boolean {
    // FTS cleanup
    this.db.prepare(`
      DELETE FROM nodes_fts WHERE rowid = (SELECT rowid FROM nodes WHERE id = ?)
    `).run(id);
    const result = this.db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
    return result.changes > 0;
  }

  removeNodesByFile(file: string): number {
    // Get node IDs first for FTS cleanup
    const nodeIds = this.db.prepare('SELECT id FROM nodes WHERE file = ?')
      .all(file) as { id: string }[];

    if (nodeIds.length === 0) return 0;

    const transaction = this.db.transaction(() => {
      for (const { id } of nodeIds) {
        this.db.prepare(
          'DELETE FROM nodes_fts WHERE rowid = (SELECT rowid FROM nodes WHERE id = ?)'
        ).run(id);
      }
      this.db.prepare('DELETE FROM nodes WHERE file = ?').run(file);
    });
    transaction();

    return nodeIds.length;
  }

  get nodeCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM nodes').get() as any;
    return row.count;
  }

  // ── Relationship Operations ──

  insertRelationship(rel: Relationship): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO relationships (id, type, sourceId, targetId, confidence, meta)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      rel.id, rel.type, rel.sourceId, rel.targetId,
      rel.confidence ?? 1.0,
      rel.metadata ? JSON.stringify(rel.metadata) : null
    );
  }

  insertRelationships(rels: Relationship[]): void {
    const transaction = this.db.transaction((rs: Relationship[]) => {
      for (const rel of rs) {
        this.insertRelationship(rel);
      }
    });
    transaction(rels);
  }

  getRelationship(id: string): Relationship | undefined {
    const row = this.db.prepare('SELECT * FROM relationships WHERE id = ?').get(id) as any;
    return row ? this._rowToRel(row) : undefined;
  }

  getRelationshipsBySource(sourceId: string, type?: RelationshipType): Relationship[] {
    let sql = 'SELECT * FROM relationships WHERE sourceId = ?';
    const params: unknown[] = [sourceId];
    if (type) {
      sql += ' AND type = ?';
      params.push(type);
    }
    return (this.db.prepare(sql).all(...params) as any[]).map(r => this._rowToRel(r));
  }

  getRelationshipsByTarget(targetId: string, type?: RelationshipType): Relationship[] {
    let sql = 'SELECT * FROM relationships WHERE targetId = ?';
    const params: unknown[] = [targetId];
    if (type) {
      sql += ' AND type = ?';
      params.push(type);
    }
    return (this.db.prepare(sql).all(...params) as any[]).map(r => this._rowToRel(r));
  }

  get relationshipCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM relationships').get() as any;
    return row.count;
  }

  // ── FTS5 Search ──

  search(query: string, limit = 20): SearchResult[] {
    // Tokenize camelCase/snake_case for FTS5
    const tokens = this._tokenizeForSearch(query);
    const ftsQuery = tokens.join(' OR ');

    const rows = this.db.prepare(`
      SELECT n.id, n.name, n.type, n.file, n.startLine, n.package, n.exported,
             rank
      FROM nodes_fts fts
      JOIN nodes n ON n.id = fts.id
      WHERE nodes_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, limit) as any[];

    return rows.map(r => ({
      id: r.id,
      name: r.name,
      type: r.type as NodeType,
      file: r.file,
      startLine: r.startLine,
      package: r.package,
      exported: !!r.exported,
      rank: r.rank,
    }));
  }

  // ── Metadata ──

  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
  }

  getMeta(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as any;
    return row?.value;
  }

  getAllMeta(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM meta').all() as any[];
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  // ── Structural Queries (for recon_rules) ──

  findDeadCode(): Node[] {
    const rows = this.db.prepare(`
      SELECT n.* FROM nodes n
      WHERE n.exported = 1
        AND n.type NOT IN ('Package', 'File', 'Module')
        AND n.isTest = 0
        AND n.id NOT IN (
          SELECT r.targetId FROM relationships r
          WHERE r.type IN ('CALLS', 'IMPORTS', 'USES_COMPONENT')
            AND r.sourceId != n.id
        )
    `).all() as any[];
    return rows.map(r => this._rowToNode(r));
  }

  findOrphans(): Node[] {
    const rows = this.db.prepare(`
      SELECT n.* FROM nodes n
      WHERE n.type = 'File'
        AND n.isTest = 0
        AND n.id NOT IN (SELECT sourceId FROM relationships)
        AND n.id NOT IN (SELECT targetId FROM relationships)
    `).all() as any[];
    return rows.map(r => this._rowToNode(r));
  }

  findLargeFiles(threshold = 30): { file: string; count: number }[] {
    const rows = this.db.prepare(`
      SELECT file, COUNT(*) as count FROM nodes
      WHERE file IS NOT NULL AND type NOT IN ('File', 'Package', 'Module')
      GROUP BY file
      HAVING count > ?
      ORDER BY count DESC
    `).all(threshold) as any[];
    return rows;
  }

  findUnusedExports(): Node[] {
    const rows = this.db.prepare(`
      SELECT n.* FROM nodes n
      WHERE n.exported = 1
        AND n.type NOT IN ('Package', 'File', 'Module')
        AND n.isTest = 0
        AND n.id NOT IN (
          SELECT r.targetId FROM relationships r
          WHERE r.type IN ('CALLS', 'IMPORTS', 'USES_COMPONENT')
            AND r.sourceId IN (
              SELECT n2.id FROM nodes n2 WHERE n2.file != n.file
            )
        )
    `).all() as any[];
    return rows.map(r => this._rowToNode(r));
  }

  // ── Lifecycle ──

  close(): void {
    if (this._isOpen) {
      this.db.close();
      this._isOpen = false;
    }
  }

  // ── Private ──

  private _extractMeta(node: Node): Record<string, unknown> | null {
    const meta: Record<string, unknown> = {};
    const metaFields = [
      'receiver', 'params', 'returnType', 'fields', 'embeds',
      'methodSignatures', 'isDefault', 'props', 'importPath', 'files', 'imports'
    ];
    for (const field of metaFields) {
      if ((node as any)[field] !== undefined) {
        meta[field] = (node as any)[field];
      }
    }
    return Object.keys(meta).length > 0 ? meta : null;
  }

  private _rowToNode(row: any): Node {
    const node: Node = {
      id: row.id,
      type: row.type as NodeType,
      name: row.name,
      file: row.file,
      startLine: row.startLine,
      endLine: row.endLine,
      language: row.language as Language,
      package: row.package,
      exported: !!row.exported,
    };
    if (row.community) node.community = row.community;
    if (row.repo) node.repo = row.repo;
    if (row.isTest) (node as any).isTest = true;
    if (row.meta) {
      const meta = JSON.parse(row.meta);
      Object.assign(node, meta);
    }
    return node;
  }

  private _rowToRel(row: any): Relationship {
    const rel: Relationship = {
      id: row.id,
      type: row.type as RelationshipType,
      sourceId: row.sourceId,
      targetId: row.targetId,
      confidence: row.confidence,
    };
    if (row.meta) {
      rel.metadata = JSON.parse(row.meta);
    }
    return rel;
  }

  private _tokenizeForSearch(text: string): string[] {
    return text
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/[_.\-/\\]/g, ' ')
      .toLowerCase()
      .split(/\s+/)
      .filter(t => t.length > 1);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run test/unit/sqlite.test.ts
```

Expected: All 12 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/storage/sqlite.ts test/unit/sqlite.test.ts package.json package-lock.json
git commit -m "feat: add SQLite storage module with FTS5 search"
```

---

### Task 2: v5 → v6 Migration

**Files:**
- Create: `src/storage/migrate.ts`
- Test: `test/unit/migrate.test.ts`

- [ ] **Step 1: Write failing tests for migration**

Create `test/unit/migrate.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { migrateV5ToV6, detectV5Index } from '../../src/storage/migrate.js';
import { SqliteStore } from '../../src/storage/sqlite.js';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync } from 'fs';
import { NodeType, RelationshipType, Language } from '../../src/graph/types.js';

describe('v5 to v6 migration', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'recon-migrate-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it('detects v5 index (graph.json + meta.json)', async () => {
    const reconDir = join(tmpDir, '.recon');
    await mkdir(reconDir, { recursive: true });
    await writeFile(join(reconDir, 'graph.json'), JSON.stringify({
      nodes: [], relationships: []
    }));
    await writeFile(join(reconDir, 'meta.json'), JSON.stringify({
      version: 1, indexedAt: new Date().toISOString(),
      gitCommit: 'abc', gitBranch: 'main',
      stats: {}, fileHashes: {}
    }));

    expect(detectV5Index(tmpDir)).toBe(true);
  });

  it('returns false when no v5 index exists', () => {
    expect(detectV5Index(tmpDir)).toBe(false);
  });

  it('migrates v5 nodes and relationships to SQLite', async () => {
    const reconDir = join(tmpDir, '.recon');
    await mkdir(reconDir, { recursive: true });

    const graphData = {
      nodes: [
        {
          id: 'ts:func:main', type: NodeType.Function, name: 'main',
          file: 'src/main.ts', startLine: 1, endLine: 10,
          language: Language.TypeScript, package: 'main', exported: true
        }
      ],
      relationships: [
        {
          id: 'r1', type: RelationshipType.CALLS,
          sourceId: 'ts:func:main', targetId: 'ts:func:main',
          confidence: 1.0
        }
      ]
    };

    await writeFile(join(reconDir, 'graph.json'), JSON.stringify(graphData));
    await writeFile(join(reconDir, 'meta.json'), JSON.stringify({
      version: 1, indexedAt: '2026-01-01T00:00:00Z',
      gitCommit: 'abc123', gitBranch: 'main',
      stats: { tsModules: 1, tsSymbols: 1, relationships: 1, indexTimeMs: 100 },
      fileHashes: { 'src/main.ts': 'sha256hash' }
    }));

    const store = await migrateV5ToV6(tmpDir);
    expect(store.nodeCount).toBe(1);
    expect(store.relationshipCount).toBe(1);
    expect(store.getMeta('gitCommit')).toBe('abc123');
    expect(existsSync(join(reconDir, 'graph.json.v5.bak'))).toBe(true);
    store.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/unit/migrate.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement migration**

Create `src/storage/migrate.ts`:

```typescript
import { existsSync, readFileSync, renameSync } from 'fs';
import { join } from 'path';
import { SqliteStore } from './sqlite.js';
import type { Node, Relationship, SerializedGraph } from '../graph/types.js';

const RECON_DIR = '.recon';

export function detectV5Index(projectRoot: string): boolean {
  const reconDir = join(projectRoot, RECON_DIR);
  return (
    existsSync(join(reconDir, 'graph.json')) &&
    existsSync(join(reconDir, 'meta.json'))
  );
}

export function detectV6Index(projectRoot: string): boolean {
  return existsSync(join(projectRoot, RECON_DIR, 'recon.db'));
}

export async function migrateV5ToV6(projectRoot: string): Promise<SqliteStore> {
  const reconDir = join(projectRoot, RECON_DIR);
  const graphPath = join(reconDir, 'graph.json');
  const metaPath = join(reconDir, 'meta.json');

  // Read v5 data
  const graphData: SerializedGraph = JSON.parse(readFileSync(graphPath, 'utf-8'));
  const metaData = JSON.parse(readFileSync(metaPath, 'utf-8'));

  // Create SQLite store
  const store = new SqliteStore(projectRoot);

  // Migrate nodes
  if (graphData.nodes.length > 0) {
    store.insertNodes(graphData.nodes);
  }

  // Migrate relationships
  if (graphData.relationships.length > 0) {
    store.insertRelationships(graphData.relationships);
  }

  // Migrate metadata
  if (metaData.gitCommit) store.setMeta('gitCommit', metaData.gitCommit);
  if (metaData.gitBranch) store.setMeta('gitBranch', metaData.gitBranch);
  if (metaData.indexedAt) store.setMeta('indexedAt', metaData.indexedAt);
  if (metaData.fileHashes) store.setMeta('fileHashes', JSON.stringify(metaData.fileHashes));
  if (metaData.stats) store.setMeta('stats', JSON.stringify(metaData.stats));

  // Backup v5 files
  renameSync(graphPath, graphPath + '.v5.bak');
  renameSync(metaPath, metaPath + '.v5.bak');

  // Clean up other v5 files
  const searchPath = join(reconDir, 'search.json');
  if (existsSync(searchPath)) renameSync(searchPath, searchPath + '.v5.bak');
  const embedPath = join(reconDir, 'embeddings.json');
  if (existsSync(embedPath)) renameSync(embedPath, embedPath + '.v5.bak');

  return store;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/unit/migrate.test.ts
```

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storage/migrate.ts test/unit/migrate.test.ts
git commit -m "feat: add v5-to-v6 JSON-to-SQLite migration"
```

---

### Task 3: Update Node Type — isTest field

**Files:**
- Modify: `src/graph/types.ts`
- Modify: `test/unit/graph.test.ts`

- [ ] **Step 1: Add isTest to Node interface**

In `src/graph/types.ts`, add to the `Node` interface:

```typescript
// After the 'community?' field:
isTest?: boolean;
```

- [ ] **Step 2: Add test for isTest in graph.test.ts**

Add to `test/unit/graph.test.ts` inside the `KnowledgeGraph` describe block:

```typescript
it('stores isTest flag on nodes', () => {
  const graph = new KnowledgeGraph();
  graph.addNode(makeNode('ts:func:a', 'testFunc', { isTest: true }));
  const node = graph.getNode('ts:func:a');
  expect(node).toBeDefined();
  expect((node as any).isTest).toBe(true);
});
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run test/unit/graph.test.ts
```

Expected: All tests PASS (KnowledgeGraph already stores arbitrary Node properties).

- [ ] **Step 4: Commit**

```bash
git add src/graph/types.ts test/unit/graph.test.ts
git commit -m "feat: add isTest flag to Node interface"
```

---

## Phase 2: New Tool Implementations

### Task 4: Structured Error Module

**Files:**
- Create: `src/mcp/errors.ts`
- Test: `test/unit/errors.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/unit/errors.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  ReconToolError,
  symbolNotFound,
  ambiguousSymbol,
  invalidParameter,
  indexStale,
  emptyGraph,
} from '../../src/mcp/errors.js';

describe('ReconToolError', () => {
  it('creates symbol_not_found error with suggestions', () => {
    const err = symbolNotFound('getUserById', ['getUser', 'getUserByEmail']);
    expect(err.error).toBe('symbol_not_found');
    expect(err.symbol).toBe('getUserById');
    expect(err.suggestion.tool).toBe('recon_find');
    expect(err.similar).toContain('getUser');
  });

  it('creates ambiguous_symbol error with matches', () => {
    const matches = [
      { name: 'parse', file: 'src/a.ts' },
      { name: 'parse', file: 'src/b.ts' },
    ];
    const err = ambiguousSymbol('parse', matches);
    expect(err.error).toBe('ambiguous_symbol');
    expect(err.matches).toHaveLength(2);
    expect(err.suggestion.params.file).toBeUndefined();
  });

  it('creates invalid_parameter error with expected values', () => {
    const err = invalidParameter('direction', 'sideways', ['upstream', 'downstream']);
    expect(err.error).toBe('invalid_parameter');
    expect(err.expected).toContain('upstream');
  });

  it('creates index_stale error with timestamp', () => {
    const err = indexStale('2026-01-01T00:00:00Z');
    expect(err.error).toBe('index_stale');
    expect(err.suggestion.tool).toBe('recon_map');
  });

  it('creates empty_graph error', () => {
    const err = emptyGraph();
    expect(err.error).toBe('empty_graph');
    expect(err.suggestion.reason).toContain('npx recon index');
  });

  it('formats error as JSON string', () => {
    const err = symbolNotFound('foo', []);
    const json = JSON.parse(err.toJSON());
    expect(json.error).toBe('symbol_not_found');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/unit/errors.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement error module**

Create `src/mcp/errors.ts`:

```typescript
export interface ToolSuggestion {
  tool: string;
  params: Record<string, unknown>;
  reason: string;
}

export class ReconToolError {
  constructor(
    public error: string,
    public symbol?: string,
    public suggestion: ToolSuggestion = { tool: '', params: {}, reason: '' },
    public similar?: string[],
    public matches?: { name: string; file: string }[],
    public expected?: string[],
    public parameter?: string,
    public lastIndexed?: string,
  ) {}

  toJSON(): string {
    const obj: Record<string, unknown> = { error: this.error };
    if (this.symbol) obj.symbol = this.symbol;
    if (this.suggestion.tool) obj.suggestion = this.suggestion;
    if (this.similar?.length) obj.similar = this.similar;
    if (this.matches?.length) obj.matches = this.matches;
    if (this.expected?.length) obj.expected = this.expected;
    if (this.parameter) obj.parameter = this.parameter;
    if (this.lastIndexed) obj.lastIndexed = this.lastIndexed;
    return JSON.stringify(obj, null, 2);
  }
}

export function symbolNotFound(name: string, similar: string[]): ReconToolError {
  return new ReconToolError(
    'symbol_not_found',
    name,
    {
      tool: 'recon_find',
      params: { query: name },
      reason: 'No exact match. Use recon_find for fuzzy search.',
    },
    similar,
  );
}

export function ambiguousSymbol(
  name: string,
  matches: { name: string; file: string }[],
): ReconToolError {
  return new ReconToolError(
    'ambiguous_symbol',
    name,
    {
      tool: matches[0] ? 'recon_explain' : 'recon_find',
      params: { name, file: undefined },
      reason: `Multiple matches. Add 'file' parameter to disambiguate.`,
    },
    undefined,
    matches,
  );
}

export function invalidParameter(
  param: string,
  received: string,
  expected: string[],
): ReconToolError {
  return new ReconToolError(
    'invalid_parameter',
    undefined,
    {
      tool: '',
      params: {},
      reason: `Parameter '${param}' received '${received}'. Expected: ${expected.join(', ')}`,
    },
    undefined,
    undefined,
    expected,
    param,
  );
}

export function indexStale(lastIndexed: string): ReconToolError {
  return new ReconToolError(
    'index_stale',
    undefined,
    {
      tool: 'recon_map',
      params: {},
      reason: `Index was last built at ${lastIndexed}. Re-index to update.`,
    },
    undefined,
    undefined,
    undefined,
    undefined,
    lastIndexed,
  );
}

export function emptyGraph(): ReconToolError {
  return new ReconToolError(
    'empty_graph',
    undefined,
    {
      tool: '',
      params: {},
      reason: 'No index found. Run: npx recon index',
    },
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/unit/errors.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/errors.ts test/unit/errors.test.ts
git commit -m "feat: add structured error types for MCP tools"
```

---

### Task 5: recon_rules — Dead Code & Code Smell Detection

**Files:**
- Create: `src/mcp/rules.ts`
- Test: `test/unit/rules.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/unit/rules.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { KnowledgeGraph, NodeType, RelationshipType, Language } from '../../src/graph/index.js';
import { runRule, findCircularDeps, type RuleResult } from '../../src/mcp/rules.js';

function makeNode(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id, type: NodeType.Function, name,
    file: 'src/main.ts', startLine: 1, endLine: 10,
    language: Language.TypeScript, package: 'main', exported: true,
    ...overrides,
  };
}

function makeRel(source: string, target: string, type = RelationshipType.CALLS) {
  return {
    id: `${source}->${target}`, type, sourceId: source, targetId: target, confidence: 1.0,
  };
}

describe('recon_rules', () => {
  let graph: KnowledgeGraph;

  beforeEach(() => {
    graph = new KnowledgeGraph();
  });

  describe('dead_code', () => {
    it('finds exported symbols with zero incoming calls/imports', () => {
      graph.addNode(makeNode('ts:func:used', 'used'));
      graph.addNode(makeNode('ts:func:unused', 'unused'));
      graph.addNode(makeNode('ts:func:caller', 'caller'));
      graph.addRelationship(makeRel('ts:func:caller', 'ts:func:used'));

      const result = runRule(graph, 'dead_code');
      expect(result.items.map(i => i.name)).toContain('unused');
      expect(result.items.map(i => i.name)).not.toContain('used');
    });

    it('excludes test nodes from dead code', () => {
      graph.addNode(makeNode('ts:func:testHelper', 'testHelper', { isTest: true }));
      const result = runRule(graph, 'dead_code');
      expect(result.items.map(i => i.name)).not.toContain('testHelper');
    });
  });

  describe('unused_exports', () => {
    it('finds exports only used within same file', () => {
      graph.addNode(makeNode('ts:func:a', 'internalA', { file: 'src/a.ts' }));
      graph.addNode(makeNode('ts:func:b', 'callerB', { file: 'src/a.ts' }));
      graph.addRelationship(makeRel('ts:func:b', 'ts:func:a'));

      const result = runRule(graph, 'unused_exports');
      expect(result.items.map(i => i.name)).toContain('internalA');
    });
  });

  describe('circular_deps', () => {
    it('detects import cycles between packages', () => {
      graph.addNode(makeNode('ts:mod:a', 'moduleA', { type: NodeType.Module, package: 'pkgA' }));
      graph.addNode(makeNode('ts:mod:b', 'moduleB', { type: NodeType.Module, package: 'pkgB' }));
      graph.addNode(makeNode('ts:mod:c', 'moduleC', { type: NodeType.Module, package: 'pkgC' }));
      graph.addRelationship(makeRel('ts:mod:a', 'ts:mod:b', RelationshipType.IMPORTS));
      graph.addRelationship(makeRel('ts:mod:b', 'ts:mod:c', RelationshipType.IMPORTS));
      graph.addRelationship(makeRel('ts:mod:c', 'ts:mod:a', RelationshipType.IMPORTS));

      const cycles = findCircularDeps(graph);
      expect(cycles.length).toBeGreaterThan(0);
    });

    it('returns empty for acyclic graph', () => {
      graph.addNode(makeNode('ts:mod:a', 'a', { type: NodeType.Module }));
      graph.addNode(makeNode('ts:mod:b', 'b', { type: NodeType.Module }));
      graph.addRelationship(makeRel('ts:mod:a', 'ts:mod:b', RelationshipType.IMPORTS));

      const cycles = findCircularDeps(graph);
      expect(cycles).toHaveLength(0);
    });
  });

  describe('large_files', () => {
    it('finds files exceeding symbol threshold', () => {
      for (let i = 0; i < 35; i++) {
        graph.addNode(makeNode(`ts:func:f${i}`, `func${i}`, {
          file: 'src/big.ts', type: NodeType.Function,
        }));
      }
      graph.addNode(makeNode('ts:func:small', 'small', {
        file: 'src/small.ts', type: NodeType.Function,
      }));

      const result = runRule(graph, 'large_files');
      expect(result.items.length).toBe(1);
      expect(result.items[0].name).toBe('src/big.ts');
    });
  });

  describe('orphans', () => {
    it('finds files with no relationships', () => {
      graph.addNode(makeNode('ts:file:orphan', 'orphan.ts', {
        type: NodeType.File, file: 'src/orphan.ts',
      }));
      graph.addNode(makeNode('ts:file:connected', 'connected.ts', {
        type: NodeType.File, file: 'src/connected.ts',
      }));
      graph.addNode(makeNode('ts:func:a', 'a', { file: 'src/connected.ts' }));
      graph.addRelationship(makeRel('ts:file:connected', 'ts:func:a', RelationshipType.CONTAINS));

      const result = runRule(graph, 'orphans');
      expect(result.items.map(i => i.name)).toContain('orphan.ts');
      expect(result.items.map(i => i.name)).not.toContain('connected.ts');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/unit/rules.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement rules module**

Create `src/mcp/rules.ts`:

```typescript
import type { KnowledgeGraph, Node } from '../graph/index.js';
import { NodeType, RelationshipType } from '../graph/index.js';

export interface RuleItem {
  name: string;
  file?: string;
  line?: number;
  detail?: string;
}

export interface RuleResult {
  rule: string;
  items: RuleItem[];
  count: number;
}

type RuleName = 'dead_code' | 'unused_exports' | 'circular_deps' | 'large_files' | 'orphans';

const SKIP_TYPES = new Set([NodeType.Package, NodeType.File, NodeType.Module]);

export function runRule(graph: KnowledgeGraph, rule: RuleName, options: { threshold?: number } = {}): RuleResult {
  switch (rule) {
    case 'dead_code': return findDeadCode(graph);
    case 'unused_exports': return findUnusedExports(graph);
    case 'circular_deps': {
      const cycles = findCircularDeps(graph);
      return {
        rule: 'circular_deps',
        items: cycles.map(c => ({ name: c.join(' → '), detail: `Cycle length: ${c.length}` })),
        count: cycles.length,
      };
    }
    case 'large_files': return findLargeFiles(graph, options.threshold ?? 30);
    case 'orphans': return findOrphanFiles(graph);
  }
}

function findDeadCode(graph: KnowledgeGraph): RuleResult {
  const items: RuleItem[] = [];
  for (const [, node] of graph.nodes) {
    if (SKIP_TYPES.has(node.type)) continue;
    if (!node.exported) continue;
    if ((node as any).isTest) continue;

    const incoming = graph.getIncoming(node.id);
    const externalCallers = incoming.filter(r =>
      (r.type === RelationshipType.CALLS ||
       r.type === RelationshipType.IMPORTS ||
       r.type === RelationshipType.USES_COMPONENT) &&
      r.sourceId !== node.id
    );

    if (externalCallers.length === 0) {
      items.push({ name: node.name, file: node.file, line: node.startLine });
    }
  }
  return { rule: 'dead_code', items, count: items.length };
}

function findUnusedExports(graph: KnowledgeGraph): RuleResult {
  const items: RuleItem[] = [];
  for (const [, node] of graph.nodes) {
    if (SKIP_TYPES.has(node.type)) continue;
    if (!node.exported) continue;
    if ((node as any).isTest) continue;

    const incoming = graph.getIncoming(node.id);
    const externalFileCallers = incoming.filter(r => {
      if (r.type !== RelationshipType.CALLS &&
          r.type !== RelationshipType.IMPORTS &&
          r.type !== RelationshipType.USES_COMPONENT) return false;
      const sourceNode = graph.getNode(r.sourceId);
      return sourceNode && sourceNode.file !== node.file;
    });

    if (externalFileCallers.length === 0) {
      items.push({ name: node.name, file: node.file, line: node.startLine });
    }
  }
  return { rule: 'unused_exports', items, count: items.length };
}

export function findCircularDeps(graph: KnowledgeGraph): string[][] {
  // Build package-level import graph
  const packages = new Map<string, Set<string>>();
  for (const rel of graph.allRelationships()) {
    if (rel.type !== RelationshipType.IMPORTS) continue;
    const source = graph.getNode(rel.sourceId);
    const target = graph.getNode(rel.targetId);
    if (!source?.package || !target?.package) continue;
    if (source.package === target.package) continue;

    if (!packages.has(source.package)) packages.set(source.package, new Set());
    packages.get(source.package)!.add(target.package);
  }

  // DFS with coloring for cycle detection
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string>();
  const cycles: string[][] = [];

  for (const pkg of packages.keys()) color.set(pkg, WHITE);

  function dfs(u: string, path: string[]): void {
    color.set(u, GRAY);
    const neighbors = packages.get(u) ?? new Set();
    for (const v of neighbors) {
      if (!color.has(v)) { color.set(v, WHITE); }
      if (color.get(v) === GRAY) {
        // Back-edge: extract cycle
        const cycleStart = path.indexOf(v);
        if (cycleStart !== -1) {
          cycles.push([...path.slice(cycleStart), v]);
        }
      } else if (color.get(v) === WHITE) {
        dfs(v, [...path, v]);
      }
    }
    color.set(u, BLACK);
  }

  for (const pkg of packages.keys()) {
    if (color.get(pkg) === WHITE) {
      dfs(pkg, [pkg]);
    }
  }

  return cycles;
}

function findLargeFiles(graph: KnowledgeGraph, threshold: number): RuleResult {
  const fileCounts = new Map<string, number>();
  for (const [, node] of graph.nodes) {
    if (!node.file) continue;
    if (SKIP_TYPES.has(node.type)) continue;
    fileCounts.set(node.file, (fileCounts.get(node.file) ?? 0) + 1);
  }

  const items: RuleItem[] = [];
  for (const [file, count] of fileCounts) {
    if (count > threshold) {
      items.push({ name: file, detail: `${count} symbols (threshold: ${threshold})` });
    }
  }
  items.sort((a, b) => {
    const countA = parseInt(a.detail?.split(' ')[0] ?? '0');
    const countB = parseInt(b.detail?.split(' ')[0] ?? '0');
    return countB - countA;
  });

  return { rule: 'large_files', items, count: items.length };
}

function findOrphanFiles(graph: KnowledgeGraph): RuleResult {
  const items: RuleItem[] = [];
  for (const [, node] of graph.nodes) {
    if (node.type !== NodeType.File) continue;
    if ((node as any).isTest) continue;

    const incoming = graph.getIncoming(node.id);
    const outgoing = graph.getOutgoing(node.id);
    if (incoming.length === 0 && outgoing.length === 0) {
      items.push({ name: node.name, file: node.file });
    }
  }
  return { rule: 'orphans', items, count: items.length };
}

export function formatRuleResult(result: RuleResult): string {
  if (result.count === 0) {
    return `${result.rule}: No issues found.`;
  }

  let output = `${result.rule}: ${result.count} issue${result.count > 1 ? 's' : ''}\n\n`;
  for (const item of result.items) {
    output += `  ${item.name}`;
    if (item.file && item.line) output += `  ${item.file}:${item.line}`;
    else if (item.file) output += `  ${item.file}`;
    if (item.detail) output += `  (${item.detail})`;
    output += '\n';
  }
  return output.trimEnd();
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/unit/rules.test.ts
```

Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/rules.ts test/unit/rules.test.ts
git commit -m "feat: add recon_rules — dead code, circular deps, unused exports detection"
```

---

### Task 6: recon_find — Natural Language Query Routing

**Files:**
- Create: `test/unit/find.test.ts`
- Will be wired into handlers.ts in Task 10

- [ ] **Step 1: Write failing tests for query routing**

Create `test/unit/find.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { classifyQuery, type QueryStrategy } from '../../src/mcp/find.js';

describe('classifyQuery', () => {
  it('classifies exact camelCase as exact_match', () => {
    expect(classifyQuery('getUserById')).toBe('exact');
  });

  it('classifies snake_case as exact_match', () => {
    expect(classifyQuery('get_user_by_id')).toBe('exact');
  });

  it('classifies wildcard pattern as pattern', () => {
    expect(classifyQuery('*Handler')).toBe('pattern');
    expect(classifyQuery('user*')).toBe('pattern');
  });

  it('classifies structural keywords as structural', () => {
    expect(classifyQuery('exported functions with no callers')).toBe('structural');
    expect(classifyQuery('unused exports')).toBe('structural');
    expect(classifyQuery('dead code')).toBe('structural');
  });

  it('classifies multi-word natural language as fulltext', () => {
    expect(classifyQuery('functions that handle authentication')).toBe('fulltext');
    expect(classifyQuery('validate user input')).toBe('fulltext');
  });

  it('classifies single common word as fulltext', () => {
    expect(classifyQuery('auth')).toBe('exact');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/unit/find.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement query classifier**

Create `src/mcp/find.ts`:

```typescript
import type { KnowledgeGraph, Node } from '../graph/index.js';
import { NodeType } from '../graph/index.js';

export type QueryStrategy = 'exact' | 'pattern' | 'structural' | 'fulltext';

const STRUCTURAL_KEYWORDS = new Set([
  'exported', 'unexported', 'no callers', 'no callees', 'unused',
  'implements', 'extends', 'orphan', 'dead', 'circular', 'test', 'entry point',
]);

export function classifyQuery(query: string): QueryStrategy {
  const lower = query.toLowerCase().trim();

  // Pattern: contains wildcard
  if (query.includes('*') || query.includes('?')) return 'pattern';

  // Structural: contains 2+ structural keywords
  let structuralCount = 0;
  for (const kw of STRUCTURAL_KEYWORDS) {
    if (lower.includes(kw)) structuralCount++;
  }
  if (structuralCount >= 2) return 'structural';

  // Single word or code-like identifier (camelCase, snake_case, PascalCase)
  const isIdentifier = /^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(query);
  if (isIdentifier) return 'exact';

  // Multi-word with structural keywords
  if (structuralCount >= 1 && lower.split(/\s+/).length >= 3) return 'structural';

  // Multi-word natural language
  return 'fulltext';
}

export interface FindResult {
  id: string;
  name: string;
  type: NodeType;
  file: string;
  line: number;
  package: string;
  exported: boolean;
  callers: number;
  callees: number;
  method: QueryStrategy;
}

export function executeFind(
  graph: KnowledgeGraph,
  query: string,
  options: { type?: string; language?: string; package?: string; limit?: number } = {},
): FindResult[] {
  const strategy = classifyQuery(query);
  const limit = options.limit ?? 20;
  let results: FindResult[];

  switch (strategy) {
    case 'exact':
      results = findExact(graph, query);
      break;
    case 'pattern':
      results = findPattern(graph, query);
      break;
    case 'structural':
      results = findStructural(graph, query);
      break;
    case 'fulltext':
      results = findFulltext(graph, query);
      break;
  }

  // Apply filters
  if (options.type) {
    results = results.filter(r => r.type === options.type);
  }
  if (options.language) {
    results = results.filter(r => {
      const node = graph.getNode(r.id);
      return node?.language === options.language;
    });
  }
  if (options.package) {
    results = results.filter(r => r.package === options.package);
  }

  return results.slice(0, limit).map(r => ({ ...r, method: strategy }));
}

function findExact(graph: KnowledgeGraph, name: string): FindResult[] {
  const nodes = graph.findByName(name);
  return nodes.map(n => nodeToResult(graph, n));
}

function findPattern(graph: KnowledgeGraph, pattern: string): FindResult[] {
  const regex = new RegExp(
    '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i'
  );
  const results: FindResult[] = [];
  for (const [, node] of graph.nodes) {
    if (regex.test(node.name)) {
      results.push(nodeToResult(graph, node));
    }
  }
  return results;
}

function findStructural(graph: KnowledgeGraph, query: string): FindResult[] {
  const lower = query.toLowerCase();
  const results: FindResult[] = [];

  for (const [, node] of graph.nodes) {
    if (node.type === NodeType.Package || node.type === NodeType.File) continue;
    if ((node as any).isTest) continue;

    let match = false;

    if (lower.includes('exported') && !lower.includes('unexported')) {
      match = !!node.exported;
    }
    if (lower.includes('unexported')) {
      match = !node.exported;
    }
    if (lower.includes('no callers')) {
      const incoming = graph.getIncoming(node.id);
      match = match && incoming.length === 0;
    }
    if (lower.includes('no callees')) {
      const outgoing = graph.getOutgoing(node.id);
      match = match && outgoing.length === 0;
    }
    if (lower.includes('unused') || lower.includes('dead')) {
      const incoming = graph.getIncoming(node.id);
      match = !!node.exported && incoming.length === 0;
    }

    if (match) results.push(nodeToResult(graph, node));
  }
  return results;
}

function findFulltext(graph: KnowledgeGraph, query: string): FindResult[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  const scored: { node: Node; score: number }[] = [];

  for (const [, node] of graph.nodes) {
    if (node.type === NodeType.Package || node.type === NodeType.File) continue;
    const nameTokens = tokenizeName(node.name);
    let score = 0;
    for (const token of tokens) {
      if (nameTokens.some(nt => nt.includes(token))) score++;
    }
    if (score > 0) scored.push({ node, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => nodeToResult(graph, s.node));
}

function tokenizeName(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_.\-]/g, ' ')
    .toLowerCase()
    .split(/\s+/);
}

function nodeToResult(graph: KnowledgeGraph, node: Node): FindResult {
  const callers = graph.getIncoming(node.id).filter(r => r.type === 'CALLS' as any).length;
  const callees = graph.getOutgoing(node.id).filter(r => r.type === 'CALLS' as any).length;
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    file: node.file ?? '',
    line: node.startLine ?? 0,
    package: node.package ?? '',
    exported: !!node.exported,
    callers,
    callees,
    method: 'exact',
  };
}

export function formatFindResults(results: FindResult[]): string {
  if (results.length === 0) return 'No results found.';

  let output = `Found ${results.length} result${results.length > 1 ? 's' : ''} (${results[0].method})\n\n`;
  for (const r of results) {
    const exp = r.exported ? 'exported' : 'internal';
    output += `${r.name} [${r.type}] — ${r.file}:${r.line}\n`;
    output += `  ${exp} | callers: ${r.callers} | callees: ${r.callees} | pkg: ${r.package}\n`;
  }
  return output.trimEnd();
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/unit/find.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/find.ts test/unit/find.test.ts
git commit -m "feat: add recon_find with natural language query routing"
```

---

### Task 7: New Tool Definitions — 8 Tools

**Files:**
- Modify: `src/mcp/tools.ts`

- [ ] **Step 1: Read current tools.ts**

```bash
# Understand current structure before modifying
```

Read `src/mcp/tools.ts` to confirm the `ToolDefinition` interface and `RECON_TOOLS` array structure.

- [ ] **Step 2: Replace RECON_TOOLS with 8 new tool definitions**

Replace the entire `RECON_TOOLS` array in `src/mcp/tools.ts` with:

```typescript
export const RECON_TOOLS: ToolDefinition[] = [
  {
    name: 'recon_map',
    description: 'Architecture overview: tech stack, packages, entry points, health.\n\nWHEN: First time in a codebase, or need to recall architecture.\nNOT: You need details about a specific symbol (use recon_explain).\nTHEN: recon_find to locate specific symbols.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Filter by repo name (multi-repo only)' },
      },
    },
  },
  {
    name: 'recon_find',
    description: 'Smart search: exact name, wildcard (*Handler), or natural language.\n\nWHEN: Looking for a symbol, function, class, or pattern.\nNOT: You already know the symbol name and need full context (use recon_explain).\nTHEN: recon_explain for details on a result.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Symbol name, pattern (*Handler), or natural language' },
        type: { type: 'string', description: 'Filter: Function, Class, Method, Struct, Interface, etc.' },
        language: { type: 'string', description: 'Filter by language' },
        package: { type: 'string', description: 'Filter by package' },
        limit: { type: 'number', description: 'Max results (default: 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'recon_explain',
    description: 'Full 360-degree context of a symbol: callers, callees, flows, cross-language links.\n\nWHEN: You need to understand a function/class before modifying it.\nNOT: You just need to read the source code (use Read tool).\nTHEN: recon_impact if you plan to change it.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Symbol name' },
        file: { type: 'string', description: 'File path to disambiguate if multiple matches' },
        depth: { type: 'number', description: 'Levels of callers/callees (default: 1)' },
        include_source: { type: 'boolean', description: 'Include source code snippet' },
      },
      required: ['name'],
    },
  },
  {
    name: 'recon_impact',
    description: 'Blast radius: what breaks if you change this symbol, including affected tests.\n\nWHEN: Before modifying any exported function or shared type.\nNOT: Just exploring (use recon_explain first).\nTHEN: Make the change, then recon_changes to verify.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Symbol name to analyze' },
        direction: { type: 'string', enum: ['upstream', 'downstream'], description: 'upstream = who calls this, downstream = what this calls (default: upstream)' },
        maxDepth: { type: 'number', description: 'Max traversal depth (default: 3)' },
        file: { type: 'string', description: 'File path to disambiguate' },
      },
      required: ['target'],
    },
  },
  {
    name: 'recon_changes',
    description: 'Git diff → affected symbols → risk assessment → affected tests.\n\nWHEN: Before commit, or reviewing a PR.\nNOT: No changes have been made yet.\nTHEN: Fix issues, then commit.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['unstaged', 'staged', 'branch', 'commit'], description: 'What to analyze (default: unstaged)' },
        base: { type: 'string', description: 'Base branch for branch/commit scope' },
        include_diagram: { type: 'boolean', description: 'Include Mermaid diagram (default: false)' },
      },
    },
  },
  {
    name: 'recon_rename',
    description: 'Graph-aware safe rename across all files. Always dry_run first.\n\nWHEN: Renaming a symbol and want to catch all references.\nNOT: Simple text replacement in one file (use Edit tool).\nTHEN: Review plan, then run with dry_run: false.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Current symbol name' },
        new_name: { type: 'string', description: 'New name' },
        file: { type: 'string', description: 'File path to disambiguate' },
        dry_run: { type: 'boolean', description: 'Preview only (default: true)' },
      },
      required: ['symbol', 'new_name'],
    },
  },
  {
    name: 'recon_export',
    description: 'Generate Mermaid diagram of package/symbol/file relationships.\n\nWHEN: Need visual representation for documentation or understanding.\nNOT: Just need a list of packages (use recon_map).\nTHEN: Paste diagram in PR or docs.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Package or symbol name for focused view' },
        scope: { type: 'string', enum: ['package', 'symbol', 'file'], description: 'What to diagram' },
        depth: { type: 'number', description: 'Traversal depth (default: 2)' },
        direction: { type: 'string', enum: ['callers', 'callees', 'both'], description: 'Direction (default: both)' },
        limit: { type: 'number', description: 'Max nodes (default: 30)' },
      },
    },
  },
  {
    name: 'recon_rules',
    description: 'Code quality analysis via knowledge graph: dead code, circular deps, unused exports.\n\nWHEN: Reviewing code quality, cleaning up, or auditing architecture.\nNOT: Looking for a specific symbol (use recon_find).\nTHEN: recon_explain on flagged items for context.',
    inputSchema: {
      type: 'object',
      properties: {
        rule: { type: 'string', enum: ['dead_code', 'unused_exports', 'circular_deps', 'large_files', 'orphans'], description: 'Specific rule to check (omit to run all)' },
        package: { type: 'string', description: 'Filter by package' },
        language: { type: 'string', description: 'Filter by language' },
      },
    },
  },
];
```

- [ ] **Step 3: Run build to verify no type errors**

```bash
npm run build
```

Expected: Build succeeds (tool definitions are data — no logic to break).

- [ ] **Step 4: Commit**

```bash
git add src/mcp/tools.ts
git commit -m "feat: replace 14 tool definitions with 8 v6 tools"
```

---

### Task 8: New Instructions — 27KB → 500 bytes

**Files:**
- Modify: `src/mcp/instructions.ts`

- [ ] **Step 1: Replace RECON_INSTRUCTIONS**

Replace the entire content of `src/mcp/instructions.ts`:

```typescript
export const RECON_INSTRUCTIONS = `Recon — code intelligence for YOUR codebase.

RULES:
1. Before modifying exported symbols → recon_impact first
2. New to a codebase → recon_map first
3. Before commit/PR → recon_changes first

USE RECON (not grep) when:
- "What calls this?" → recon_explain
- "What breaks?" → recon_impact
- "Find X" → recon_find
- "Code smells?" → recon_rules

USE BUILT-IN (not Recon) when:
- Read file contents → Read tool
- Search text literally → Grep tool`;
```

- [ ] **Step 2: Run build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/mcp/instructions.ts
git commit -m "refactor: reduce MCP instructions from 27KB to 500 bytes"
```

---

### Task 9: Remove Deprecated Modules

**Files:**
- Delete: `src/mcp/hints.ts`
- Delete: `src/mcp/augmentation.ts`
- Delete: `src/mcp/staleness.ts`
- Modify: `src/mcp/index.ts`
- Modify: `src/export/exporter.ts`

- [ ] **Step 1: Remove hints.ts, augmentation.ts, staleness.ts**

```bash
rm src/mcp/hints.ts src/mcp/augmentation.ts src/mcp/staleness.ts
```

- [ ] **Step 2: Update src/mcp/index.ts**

Replace content of `src/mcp/index.ts`:

```typescript
export { createServer, startServer } from './server.js';
export { RECON_TOOLS } from './tools.js';
export { handleToolCall } from './handlers.js';
```

- [ ] **Step 3: Remove DOT export from exporter.ts**

In `src/export/exporter.ts`, remove the `toDot` function and update `ExportFormat`:

```typescript
export type ExportFormat = 'mermaid';
```

Update `exportGraph` to remove DOT branch:

```typescript
export function exportGraph(graph: KnowledgeGraph, options: ExportOptions): string {
  const filtered = filterGraph(graph, options);
  return toMermaid(filtered, options);
}
```

- [ ] **Step 4: Run build to check for broken imports**

```bash
npm run build 2>&1 | head -30
```

Fix any remaining imports that reference deleted modules. Update files that import from `hints.ts`, `augmentation.ts`, or `staleness.ts`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove hints, augmentation, staleness modules (merged into tools)"
```

---

### Task 10: New Handler Dispatch

**Files:**
- Modify: `src/mcp/handlers.ts`

This is the largest task. The handler file is rewritten to dispatch to 8 tools instead of 14.

- [ ] **Step 1: Read current handlers.ts structure**

Read `src/mcp/handlers.ts` to understand the current dispatch pattern and helper functions.

- [ ] **Step 2: Rewrite handleToolCall**

Replace the `handleToolCall` function. Keep helper functions that are still needed (impact analysis, rename). The new dispatch:

```typescript
import { KnowledgeGraph, NodeType, RelationshipType } from '../graph/index.js';
import { detectProcesses, getProcess } from '../graph/process.js';
import { detectCommunities } from '../graph/community.js';
import { executeFind, formatFindResults } from './find.js';
import { planRename, formatRenameResult } from './rename.js';
import { runRule, formatRuleResult, findCircularDeps } from './rules.js';
import { symbolNotFound, ambiguousSymbol, invalidParameter, emptyGraph } from './errors.js';
import { exportGraph } from '../export/exporter.js';
import { analyzeChanges, formatReview } from '../review/reviewer.js';
import type { VectorStore } from '../search/vector-store.js';
import { execSync } from 'child_process';

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  graph: KnowledgeGraph,
  projectRoot?: string,
  vectorStore?: VectorStore,
): Promise<string> {
  if (graph.nodeCount === 0) {
    return emptyGraph().toJSON();
  }

  switch (name) {
    case 'recon_map': return handleMap(graph, args, projectRoot);
    case 'recon_find': return handleFind(graph, args, vectorStore);
    case 'recon_explain': return handleExplain(graph, args);
    case 'recon_impact': return handleImpact(graph, args);
    case 'recon_changes': return handleChanges(graph, args, projectRoot);
    case 'recon_rename': return handleRename(graph, args);
    case 'recon_export': return handleExport(graph, args);
    case 'recon_rules': return handleRules(graph, args);
    default: return JSON.stringify({ error: 'unknown_tool', tool: name });
  }
}

function handleMap(graph: KnowledgeGraph, args: Record<string, unknown>, projectRoot?: string): string {
  const repo = args.repo as string | undefined;

  // Packages
  const packages = new Map<string, { imports: string[]; importedBy: string[]; nodeCount: number }>();
  for (const [, node] of graph.nodes) {
    if (repo && node.repo !== repo) continue;
    if (!node.package) continue;
    if (!packages.has(node.package)) {
      packages.set(node.package, { imports: [], importedBy: [], nodeCount: 0 });
    }
    packages.get(node.package)!.nodeCount++;
  }

  // Package dependencies
  for (const rel of graph.allRelationships()) {
    if (rel.type !== RelationshipType.IMPORTS) continue;
    const source = graph.getNode(rel.sourceId);
    const target = graph.getNode(rel.targetId);
    if (!source?.package || !target?.package) continue;
    if (source.package === target.package) continue;

    const srcPkg = packages.get(source.package);
    const tgtPkg = packages.get(target.package);
    if (srcPkg && !srcPkg.imports.includes(target.package)) srcPkg.imports.push(target.package);
    if (tgtPkg && !tgtPkg.importedBy.includes(source.package)) tgtPkg.importedBy.push(source.package);
  }

  // Metrics
  let functions = 0, classes = 0, tests = 0, files = 0;
  for (const [, node] of graph.nodes) {
    if (repo && node.repo !== repo) continue;
    if (node.type === NodeType.Function || node.type === NodeType.Method) functions++;
    if (node.type === NodeType.Class || node.type === NodeType.Struct) classes++;
    if (node.type === NodeType.File) files++;
    if ((node as any).isTest) tests++;
  }

  // Languages
  const langs = new Set<string>();
  for (const [, node] of graph.nodes) {
    if (node.language) langs.add(node.language);
  }

  let output = `Architecture Overview\n\n`;
  output += `Languages: ${[...langs].join(', ')}\n`;
  output += `Metrics: ${files} files, ${functions} functions, ${classes} classes/structs, ${tests} test symbols\n`;
  output += `Packages: ${packages.size}\n\n`;

  for (const [name, pkg] of packages) {
    output += `${name} (${pkg.nodeCount} symbols)\n`;
    if (pkg.imports.length) output += `  imports: ${pkg.imports.join(', ')}\n`;
    if (pkg.importedBy.length) output += `  imported by: ${pkg.importedBy.join(', ')}\n`;
  }

  return output.trimEnd();
}

function handleFind(graph: KnowledgeGraph, args: Record<string, unknown>, vectorStore?: VectorStore): string {
  const query = args.query as string;
  if (!query) return invalidParameter('query', '', ['any search term']).toJSON();

  const results = executeFind(graph, query, {
    type: args.type as string,
    language: args.language as string,
    package: args.package as string,
    limit: args.limit as number,
  });

  return formatFindResults(results);
}

function handleExplain(graph: KnowledgeGraph, args: Record<string, unknown>): string {
  const name = args.name as string;
  if (!name) return invalidParameter('name', '', ['symbol name']).toJSON();

  const file = args.file as string | undefined;
  const depth = (args.depth as number) ?? 1;

  let matches = graph.findByName(name);
  if (file) matches = matches.filter(n => n.file === file);

  if (matches.length === 0) {
    const allNames = [...graph.nodes.values()].map(n => n.name);
    const similar = allNames
      .filter(n => n.toLowerCase().includes(name.toLowerCase()))
      .slice(0, 5);
    return symbolNotFound(name, similar).toJSON();
  }

  if (matches.length > 1 && !file) {
    return ambiguousSymbol(name, matches.map(m => ({ name: m.name, file: m.file ?? '' }))).toJSON();
  }

  const node = matches[0];
  const callers = graph.getIncoming(node.id, RelationshipType.CALLS)
    .map(r => graph.getNode(r.sourceId)).filter(Boolean);
  const callees = graph.getOutgoing(node.id, RelationshipType.CALLS)
    .map(r => graph.getNode(r.targetId)).filter(Boolean);
  const importedBy = graph.getIncoming(node.id, RelationshipType.IMPORTS)
    .map(r => graph.getNode(r.sourceId)).filter(Boolean);
  const imports = graph.getOutgoing(node.id, RelationshipType.IMPORTS)
    .map(r => graph.getNode(r.targetId)).filter(Boolean);
  const methods = graph.getOutgoing(node.id, RelationshipType.HAS_METHOD)
    .map(r => graph.getNode(r.targetId)).filter(Boolean);
  const implementedBy = graph.getIncoming(node.id, RelationshipType.IMPLEMENTS)
    .map(r => graph.getNode(r.sourceId)).filter(Boolean);

  // Execution flows
  const processes = detectProcesses(graph, name, 5);

  // Tests that reference this symbol
  const allIncoming = graph.getIncoming(node.id);
  const testCallers = allIncoming
    .map(r => graph.getNode(r.sourceId))
    .filter(n => n && (n as any).isTest);

  let output = `${node.name} [${node.type}] — ${node.file}:${node.startLine}\n`;
  output += `exported: ${node.exported ? 'yes' : 'no'} | language: ${node.language} | package: ${node.package}`;
  if (node.community) output += ` | community: ${node.community}`;
  output += '\n';

  if (callers.length) {
    output += `\nCallers (${callers.length}):\n`;
    for (const c of callers) output += `  ${c!.name}  ${c!.file}:${c!.startLine}\n`;
  }
  if (callees.length) {
    output += `\nCallees (${callees.length}):\n`;
    for (const c of callees) output += `  ${c!.name}  ${c!.file}:${c!.startLine}\n`;
  }
  if (importedBy.length) {
    output += `\nImported by (${importedBy.length}):\n`;
    for (const i of importedBy) output += `  ${i!.name}  ${i!.file}:${i!.startLine}\n`;
  }
  if (imports.length) {
    output += `\nImports (${imports.length}):\n`;
    for (const i of imports) output += `  ${i!.name}  ${i!.file}:${i!.startLine}\n`;
  }
  if (methods.length) {
    output += `\nMethods (${methods.length}):\n`;
    for (const m of methods) output += `  ${m!.name}  ${m!.file}:${m!.startLine}\n`;
  }
  if (implementedBy.length) {
    output += `\nImplemented by (${implementedBy.length}):\n`;
    for (const i of implementedBy) output += `  ${i!.name}  ${i!.file}:${i!.startLine}\n`;
  }
  if (processes.length) {
    output += `\nFlows (${processes.length}):\n`;
    for (const p of processes) {
      output += `  ${p.name}: ${p.steps.map(s => s.name).join(' → ')}\n`;
    }
  }
  if (testCallers.length) {
    output += `\nTests (${testCallers.length}):\n`;
    for (const t of testCallers) output += `  ${t!.name}  ${t!.file}:${t!.startLine}\n`;
  }

  // Quick risk summary
  const totalAffected = callers.length + importedBy.length;
  const risk = totalAffected >= 20 ? 'CRITICAL' : totalAffected >= 10 ? 'HIGH' : totalAffected >= 3 ? 'MEDIUM' : 'LOW';
  output += `\nAffected if changed: ${totalAffected} direct (${risk} risk)`;

  return output.trimEnd();
}

function handleImpact(graph: KnowledgeGraph, args: Record<string, unknown>): string {
  const target = args.target as string;
  if (!target) return invalidParameter('target', '', ['symbol name']).toJSON();

  const direction = (args.direction as string) ?? 'upstream';
  if (direction !== 'upstream' && direction !== 'downstream') {
    return invalidParameter('direction', direction, ['upstream', 'downstream']).toJSON();
  }

  const maxDepth = (args.maxDepth as number) ?? 3;
  const file = args.file as string | undefined;

  let matches = graph.findByName(target);
  if (file) matches = matches.filter(n => n.file === file);

  if (matches.length === 0) {
    const similar = [...graph.nodes.values()]
      .map(n => n.name)
      .filter(n => n.toLowerCase().includes(target.toLowerCase()))
      .slice(0, 5);
    return symbolNotFound(target, similar).toJSON();
  }

  if (matches.length > 1 && !file) {
    return ambiguousSymbol(target, matches.map(m => ({ name: m.name, file: m.file ?? '' }))).toJSON();
  }

  const node = matches[0];
  const depthGroups: Map<number, Set<string>> = new Map();
  const visited = new Set<string>();
  visited.add(node.id);

  // BFS by depth
  let frontier = [node.id];
  for (let d = 1; d <= maxDepth; d++) {
    const nextFrontier: string[] = [];
    const group = new Set<string>();

    for (const id of frontier) {
      const rels = direction === 'upstream'
        ? graph.getIncoming(id)
        : graph.getOutgoing(id);

      for (const rel of rels) {
        const neighborId = direction === 'upstream' ? rel.sourceId : rel.targetId;
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);
        group.add(neighborId);
        nextFrontier.push(neighborId);
      }
    }

    if (group.size > 0) depthGroups.set(d, group);
    frontier = nextFrontier;
  }

  // Separate test nodes
  const testNodes: { name: string; file: string; depth: number }[] = [];
  const labels = ['WILL BREAK', 'LIKELY AFFECTED', 'MAY NEED TESTING'];

  let output = `Impact Analysis: ${node.name}\n`;
  output += `Direction: ${direction} | Max depth: ${maxDepth}\n\n`;

  let totalD1 = 0;
  for (const [depth, ids] of depthGroups) {
    const label = labels[depth - 1] ?? `d=${depth}`;
    const nodes = [...ids].map(id => graph.getNode(id)).filter(Boolean);
    const prodNodes = nodes.filter(n => !(n as any).isTest);
    const tests = nodes.filter(n => (n as any).isTest);

    if (depth === 1) totalD1 = prodNodes.length;

    if (prodNodes.length > 0) {
      output += `d=${depth} ${label} (${prodNodes.length}):\n`;
      for (const n of prodNodes) {
        output += `  ${n!.name}  ${n!.file}:${n!.startLine}\n`;
      }
      output += '\n';
    }

    for (const t of tests) {
      testNodes.push({ name: t!.name, file: t!.file ?? '', depth });
    }
  }

  if (testNodes.length > 0) {
    output += `Affected Tests (${testNodes.length}):\n`;
    for (const t of testNodes) {
      output += `  ${t.name}  ${t.file}  (d=${t.depth})\n`;
    }
    output += '\n';
  }

  const risk = totalD1 >= 20 ? 'CRITICAL' : totalD1 >= 10 ? 'HIGH' : totalD1 >= 3 ? 'MEDIUM' : 'LOW';
  output += `Risk: ${risk} (${totalD1} direct dependents)`;

  return output.trimEnd();
}

function handleChanges(graph: KnowledgeGraph, args: Record<string, unknown>, projectRoot?: string): string {
  if (!projectRoot) return 'No project root available.';

  const scope = (args.scope as string) ?? 'unstaged';
  const base = args.base as string | undefined;
  const includeDiagram = args.include_diagram as boolean ?? false;

  const options = { scope, base, includeDiagram, includeTests: true };
  const result = analyzeChanges(graph, projectRoot, options as any);
  return formatReview(result, graph, options as any);
}

function handleRename(graph: KnowledgeGraph, args: Record<string, unknown>): string {
  const symbol = args.symbol as string;
  const newName = args.new_name as string;
  if (!symbol) return invalidParameter('symbol', '', ['current symbol name']).toJSON();
  if (!newName) return invalidParameter('new_name', '', ['new symbol name']).toJSON();

  const file = args.file as string | undefined;
  const dryRun = args.dry_run !== false; // default true

  const result = planRename(graph, symbol, newName, file);

  if (typeof result === 'string') {
    // Disambiguation case — convert to structured error
    const matches = graph.findByName(symbol);
    return ambiguousSymbol(symbol, matches.map(m => ({ name: m.name, file: m.file ?? '' }))).toJSON();
  }

  return formatRenameResult(result);
}

function handleExport(graph: KnowledgeGraph, args: Record<string, unknown>): string {
  return exportGraph(graph, {
    format: 'mermaid',
    symbol: args.target as string,
    package: args.scope === 'package' ? args.target as string : undefined,
    depth: (args.depth as number) ?? 2,
    direction: args.direction as any,
    limit: (args.limit as number) ?? 30,
    edges: undefined,
    skipFiles: true,
  });
}

function handleRules(graph: KnowledgeGraph, args: Record<string, unknown>): string {
  const rule = args.rule as string | undefined;
  const rules = rule
    ? [rule]
    : ['dead_code', 'unused_exports', 'circular_deps', 'large_files', 'orphans'];

  let output = '';
  for (const r of rules) {
    const result = runRule(graph, r as any);
    output += formatRuleResult(result) + '\n\n';
  }
  return output.trimEnd();
}
```

- [ ] **Step 3: Run build**

```bash
npm run build
```

Fix any type errors. Common issues: import paths for deleted modules, renamed function signatures.

- [ ] **Step 4: Update handler tests**

Update `test/unit/handlers.test.ts` to test new tool names:

```typescript
// Replace old tool name references:
// 'recon_query' → 'recon_find'
// 'recon_context' → 'recon_explain'
// 'recon_packages' → 'recon_map'
// Add test for unknown tool returning structured error
```

- [ ] **Step 5: Run all tests**

```bash
npx vitest run
```

Fix any failures from renamed tools or removed modules.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: rewrite MCP handlers for 8 v6 tools"
```

---

### Task 11: Update MCP Server Wiring

**Files:**
- Modify: `src/mcp/server.ts`
- Modify: `src/mcp/resources.ts`
- Modify: `src/mcp/prompts.ts`

- [ ] **Step 1: Update resources.ts — reduce to 3**

Keep only: `recon://stats`, `recon://symbol/{name}`, `recon://file/{path}`. Remove `recon://packages` and `recon://process/{name}`.

In `getResourceDefinitions()`, remove the packages resource.
In `getResourceTemplates()`, remove the process template.
In `readResource()`, remove the packages and process handlers.

- [ ] **Step 2: Update prompts.ts — new names**

Replace prompt definitions:

```typescript
export const RECON_PROMPTS: ReconPrompt[] = [
  {
    name: 'pre_commit',
    description: 'Pre-commit impact analysis',
    arguments: [{ name: 'scope', description: 'staged or unstaged', required: false }],
  },
  {
    name: 'architecture',
    description: 'Generate architecture documentation',
    arguments: [],
  },
  {
    name: 'onboard',
    description: 'Codebase onboarding guide',
    arguments: [],
  },
];
```

Update `getPromptMessages()` to reference new tool names (`recon_map`, `recon_find`, `recon_changes`).

- [ ] **Step 3: Update server.ts**

In `createServer()`, ensure:
- `ListTools` returns `RECON_TOOLS` (already 8 new tools)
- `CallTool` dispatches to `handleToolCall` (already updated)
- `SetInstructions` uses the new 500-byte `RECON_INSTRUCTIONS`
- Resources and prompts point to updated modules

- [ ] **Step 4: Run build and tests**

```bash
npm run build && npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.ts src/mcp/resources.ts src/mcp/prompts.ts
git commit -m "feat: wire v6 tools, resources, prompts into MCP server"
```

---

## Phase 3: Analyzer Updates

### Task 12: Cross-Language Auto-Discovery

**Files:**
- Modify: `src/analyzers/cross-language.ts`
- Modify: `src/config/config.ts`

- [ ] **Step 1: Update config.ts with new fields**

Add to the `ReconConfig` interface in `src/config/config.ts`:

```typescript
crossLanguage?: {
  auto?: boolean;
  routes?: string[];
  consumers?: string[];
};
testPatterns?: string[];
rules?: {
  largeFileThreshold?: number;
  circularDepsLevel?: 'package' | 'file';
};
```

Update the `loadConfig` defaults:

```typescript
crossLanguage: { auto: true, routes: [], consumers: [] },
testPatterns: ['**/*.test.*', '**/*.spec.*', '**/*_test.*', '**/__tests__/**'],
rules: { largeFileThreshold: 30, circularDepsLevel: 'package' },
```

- [ ] **Step 2: Remove hardcoded paths from cross-language.ts**

In `src/analyzers/cross-language.ts`, replace the hardcoded file paths with config-driven discovery:

```typescript
// BEFORE (remove):
// const routerPath = join(projectRoot, 'apps/api/router/router.go');
// const constantsPath = join(projectRoot, 'apps/web/src/lib/constants.ts');

// AFTER:
import { loadConfig } from '../config/config.js';
import { globSync } from 'fs';

export function buildCrossLanguageEdges(
  projectRoot: string,
  existingNodeIds: Set<string>,
  config?: { routes?: string[]; consumers?: string[] },
): AnalyzerResult {
  const cfg = config ?? loadConfig(projectRoot).crossLanguage;

  // Auto-discover route files
  const routeFiles = cfg.routes?.length
    ? cfg.routes.flatMap(p => globSync(p, { cwd: projectRoot }))
    : autoDiscoverRouteFiles(projectRoot);

  const consumerFiles = cfg.consumers?.length
    ? cfg.consumers.flatMap(p => globSync(p, { cwd: projectRoot }))
    : autoDiscoverConsumerFiles(projectRoot);

  // ... rest of logic stays the same but uses discovered files
}

function autoDiscoverRouteFiles(root: string): string[] {
  const patterns = [
    '**/*router*.go', '**/*route*.go',
    '**/*router*.ts', '**/*route*.ts',
    '**/*urls*.py', '**/*routes*.py',
  ];
  const ignore = ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'];
  const files: string[] = [];
  for (const pattern of patterns) {
    try {
      const matches = globSync(pattern, { cwd: root, ignore });
      files.push(...matches);
    } catch { /* no matches */ }
  }
  return [...new Set(files)];
}

function autoDiscoverConsumerFiles(root: string): string[] {
  const patterns = [
    '**/*constant*.ts', '**/*api*.ts', '**/*endpoint*.ts',
    '**/*constant*.js', '**/*api*.js',
  ];
  const ignore = ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'];
  const files: string[] = [];
  for (const pattern of patterns) {
    try {
      const matches = globSync(pattern, { cwd: root, ignore });
      files.push(...matches);
    } catch { /* no matches */ }
  }
  return [...new Set(files)];
}
```

- [ ] **Step 3: Run build and tests**

```bash
npm run build && npx vitest run
```

- [ ] **Step 4: Commit**

```bash
git add src/analyzers/cross-language.ts src/config/config.ts
git commit -m "feat: replace hardcoded cross-language paths with auto-discovery"
```

---

### Task 13: Test File Indexing

**Files:**
- Modify: `src/analyzers/ts-analyzer.ts`
- Modify: `src/analyzers/tree-sitter/extractor.ts`

- [ ] **Step 1: Add test file detection helper**

In `src/analyzers/ts-analyzer.ts`, add at the top:

```typescript
const TEST_FILE_PATTERNS = [
  /\.test\.[tj]sx?$/,
  /\.spec\.[tj]sx?$/,
  /_test\.[tj]sx?$/,
  /[\\/]__tests__[\\/]/,
  /[\\/]test[\\/]/,
  /[\\/]tests[\\/]/,
  /[\\/]spec[\\/]/,
];

function isTestFile(filePath: string): boolean {
  return TEST_FILE_PATTERNS.some(p => p.test(filePath));
}
```

- [ ] **Step 2: Stop skipping test files in TS analyzer**

In `analyzeTypeScript()`, find the line that filters out test files (e.g., `if (file.endsWith('.test.ts')) continue;`) and replace with:

```typescript
// BEFORE: skip test files
// if (file.endsWith('.test.ts') || file.endsWith('.spec.ts')) continue;

// AFTER: index test files but mark them
const nodeIsTest = isTestFile(file);
// When creating nodes, add: isTest: nodeIsTest
```

For every `graph.addNode(...)` call in the TS analyzer, add the `isTest` property:

```typescript
graph.addNode({
  // ... existing properties
  isTest: nodeIsTest,
} as any);
```

- [ ] **Step 3: Same for tree-sitter extractor**

In `src/analyzers/tree-sitter/extractor.ts`, apply the same pattern: detect test files and set `isTest: true` on extracted nodes.

- [ ] **Step 4: Run tests**

```bash
npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add src/analyzers/ts-analyzer.ts src/analyzers/tree-sitter/extractor.ts
git commit -m "feat: index test files with isTest flag instead of skipping"
```

---

## Phase 4: CLI & Integration

### Task 14: CLI Updates

**Files:**
- Modify: `src/cli/index.ts`
- Modify: `src/cli/commands.ts`

- [ ] **Step 1: Remove init and review commands from CLI**

In `src/cli/index.ts`, remove the `program.command('init')` and `program.command('review')` blocks.

- [ ] **Step 2: Update serve command for SQLite**

In `src/cli/commands.ts`, update `serveCommand()`:

```typescript
// Replace JSON loading with SQLite:
import { SqliteStore } from '../storage/sqlite.js';
import { detectV5Index, migrateV5ToV6, detectV6Index } from '../storage/migrate.js';

// In serveCommand:
let store: SqliteStore;
if (detectV6Index(projectRoot)) {
  store = new SqliteStore(projectRoot);
} else if (detectV5Index(projectRoot)) {
  console.log('Migrating v5 index to v6 (SQLite)...');
  store = await migrateV5ToV6(projectRoot);
  console.log('Migration complete.');
} else {
  // Fresh index needed
  store = new SqliteStore(projectRoot);
}

// Load graph from SQLite into memory for graph operations
const graph = loadGraphFromStore(store);
```

- [ ] **Step 3: Update index command**

In `indexCommand()`, after indexing, save to SQLite:

```typescript
const store = new SqliteStore(projectRoot);
store.insertNodes([...graph.nodes.values()]);
store.insertRelationships([...graph.relationships.values()]);
store.setMeta('gitCommit', currentCommit);
store.setMeta('indexedAt', new Date().toISOString());
store.close();
```

- [ ] **Step 4: Run build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/cli/index.ts src/cli/commands.ts
git commit -m "feat: update CLI for SQLite storage, remove init/review commands"
```

---

### Task 15: HTTP Security — Localhost Binding

**Files:**
- Modify: `src/server/http.ts`

- [ ] **Step 1: Bind to localhost and restrict CORS**

In `src/server/http.ts`, update:

```typescript
// Replace:
// app.use(cors());
// With:
app.use(cors({
  origin: [/^https?:\/\/localhost(:\d+)?$/, /^https?:\/\/127\.0\.0\.1(:\d+)?$/],
}));

// Replace:
// app.listen(port, () => { ... });
// With:
const host = options.host ?? '127.0.0.1';
app.listen(port, host, () => {
  console.log(`Recon HTTP server: http://${host}:${port}`);
  if (host === '0.0.0.0') {
    console.log('WARNING: Exposing Recon on all interfaces. Your code structure will be visible on the network.');
  }
});
```

- [ ] **Step 2: Run HTTP tests**

```bash
npx vitest run test/unit/http.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/server/http.ts
git commit -m "fix: bind HTTP server to localhost, restrict CORS"
```

---

### Task 16: Watcher SQLite Integration

**Files:**
- Modify: `src/watcher/watcher.ts`

- [ ] **Step 1: Update watcher to write to SQLite**

In `src/watcher/watcher.ts`, update the save logic:

```typescript
// The watcher currently mutates the in-memory graph and periodically flushes to JSON.
// Update to also write to SQLite:

import { SqliteStore } from '../storage/sqlite.js';

// In the ReconWatcher class, add:
private store?: SqliteStore;

// In constructor, accept store parameter:
constructor(
  graph: KnowledgeGraph,
  projectDirs: ProjectDir[],
  debounceMs?: number,
  ignore?: string[],
  projectRoot?: string,
  store?: SqliteStore,
) {
  // ... existing logic
  this.store = store;
}

// In the save method, replace JSON serialization with:
private save(): void {
  if (!this.store) return;
  // For each changed file tracked by the watcher:
  // 1. Remove old nodes: store.removeNodesByFile(changedFile)
  // 2. Get new nodes from in-memory graph: graph.nodes filtered by file
  // 3. Insert new nodes: store.insertNodes(newNodes)
  // 4. Get relationships where source/target is in newNodes
  // 5. Insert relationships: store.insertRelationships(newRels)
  for (const file of this.changedFiles) {
    this.store.removeNodesByFile(file);
    const fileNodes: Node[] = [];
    for (const [, node] of this.graph.nodes) {
      if (node.file === file) fileNodes.push(node);
    }
    if (fileNodes.length > 0) this.store.insertNodes(fileNodes);

    const fileNodeIds = new Set(fileNodes.map(n => n.id));
    const rels: Relationship[] = [];
    for (const rel of this.graph.allRelationships()) {
      if (fileNodeIds.has(rel.sourceId) || fileNodeIds.has(rel.targetId)) {
        rels.push(rel);
      }
    }
    if (rels.length > 0) this.store.insertRelationships(rels);
  }
  this.changedFiles.clear();
}
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run
```

- [ ] **Step 3: Commit**

```bash
git add src/watcher/watcher.ts
git commit -m "feat: update file watcher to persist changes to SQLite"
```

---

### Task 17: Package.json Version Bump

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Bump version to 6.0.0**

In `package.json`:

```json
{
  "version": "6.0.0"
}
```

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: bump version to 6.0.0"
```

---

### Task 18: Integration Testing

**Files:**
- Modify: `test/unit/integration.test.ts`

- [ ] **Step 1: Update integration tests for v6 tools**

In `test/unit/integration.test.ts`, update tool calls to use new names:

```typescript
// Replace:
// await handleToolCall('recon_query', { query: 'getUserById' }, graph);
// With:
// await handleToolCall('recon_find', { query: 'getUserById' }, graph);

// Replace:
// await handleToolCall('recon_context', { name: 'getUserById' }, graph);
// With:
// await handleToolCall('recon_explain', { name: 'getUserById' }, graph);

// Replace:
// await handleToolCall('recon_packages', {}, graph);
// With:
// await handleToolCall('recon_map', {}, graph);

// Add new test for recon_rules:
it('recon_rules detects dead code in test graph', async () => {
  const result = await handleToolCall('recon_rules', { rule: 'dead_code' }, graph);
  expect(result).toBeDefined();
  expect(typeof result).toBe('string');
});
```

- [ ] **Step 2: Add SQLite integration test**

Add to integration tests:

```typescript
it('full pipeline: index → SQLite → load → search', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'recon-int-'));
  const store = new SqliteStore(tmpDir);

  // Insert graph into SQLite
  for (const [, node] of graph.nodes) {
    store.insertNode(node);
  }
  for (const rel of graph.allRelationships()) {
    store.insertRelationship(rel);
  }

  // Search via FTS5
  const results = store.search('user');
  expect(results.length).toBeGreaterThan(0);

  store.close();
  await rm(tmpDir, { recursive: true });
});
```

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
```

Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add test/unit/integration.test.ts
git commit -m "test: update integration tests for v6 tools and SQLite"
```

---

### Task 19: Final Build Verification

- [ ] **Step 1: Clean build**

```bash
rm -rf dist/ && npm run build
```

Expected: No errors.

- [ ] **Step 2: Run full test suite**

```bash
npx vitest run
```

Expected: All tests PASS.

- [ ] **Step 3: Test CLI commands**

```bash
# Test index command
node dist/cli/index.js index --force

# Test serve command (quick start/stop)
timeout 5 node dist/cli/index.js serve || true

# Test status command
node dist/cli/index.js status

# Verify .recon/recon.db exists
ls -la .recon/recon.db
```

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "chore: final v6.0.0 build verification and fixes"
```

---

## Phase 5: Follow-Up Tasks

These items from the spec are not critical for the v6.0.0 release but should be implemented shortly after:

### Task 20: Tech Stack Auto-Detection in recon_map

**Files:**
- Modify: `src/mcp/handlers.ts` (handleMap function)

- [ ] **Step 1: Add framework detection to handleMap**

Add to the `handleMap` function in `src/mcp/handlers.ts`:

```typescript
// After language detection, before output:
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

function detectTechStack(projectRoot: string): string[] {
  const stack: string[] = [];
  
  const pkgPath = join(projectRoot, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (allDeps['next']) stack.push(`Next.js ${allDeps['next']}`);
      if (allDeps['react']) stack.push(`React ${allDeps['react']}`);
      if (allDeps['express']) stack.push(`Express ${allDeps['express']}`);
      if (allDeps['vue']) stack.push(`Vue ${allDeps['vue']}`);
      if (allDeps['@angular/core']) stack.push(`Angular ${allDeps['@angular/core']}`);
      if (allDeps['@nestjs/core']) stack.push(`NestJS ${allDeps['@nestjs/core']}`);
      if (allDeps['vite']) stack.push(`Vite ${allDeps['vite']}`);
      if (allDeps['vitest']) stack.push('Vitest');
      if (allDeps['jest']) stack.push('Jest');
    } catch { /* ignore parse errors */ }
  }

  const goModPath = join(projectRoot, 'go.mod');
  if (existsSync(goModPath)) {
    const content = readFileSync(goModPath, 'utf-8');
    if (content.includes('github.com/gin-gonic/gin')) stack.push('Gin');
    if (content.includes('github.com/labstack/echo')) stack.push('Echo');
    if (content.includes('github.com/gofiber/fiber')) stack.push('Fiber');
    if (content.includes('github.com/go-chi/chi')) stack.push('Chi');
  }

  const reqPath = join(projectRoot, 'requirements.txt');
  const pyprojectPath = join(projectRoot, 'pyproject.toml');
  if (existsSync(reqPath) || existsSync(pyprojectPath)) {
    const content = existsSync(reqPath) ? readFileSync(reqPath, 'utf-8') : readFileSync(pyprojectPath, 'utf-8');
    if (content.includes('django')) stack.push('Django');
    if (content.includes('flask')) stack.push('Flask');
    if (content.includes('fastapi')) stack.push('FastAPI');
  }

  if (existsSync(join(projectRoot, 'Dockerfile'))) stack.push('Docker');
  if (existsSync(join(projectRoot, '.github'))) stack.push('GitHub Actions');

  return stack;
}
```

Add to handleMap output: `Stack: ${detectTechStack(projectRoot).join(', ')}\n`

- [ ] **Step 2: Run tests and commit**

```bash
npx vitest run && git add src/mcp/handlers.ts && git commit -m "feat: add tech stack auto-detection to recon_map"
```

---

### Task 21: Contextual Confidence Scoring

**Files:**
- Modify: `src/analyzers/ts-analyzer.ts`
- Modify: `src/analyzers/tree-sitter/extractor.ts`
- Modify: `src/analyzers/cross-language.ts`

Update confidence scoring from fixed values to contextual:

| Signal | Confidence |
|---|---|
| Direct import + direct call | 1.0 |
| Import but call via alias | 0.9 |
| Same name, same file, no import | 0.7 |
| Same name, different file, no import | 0.4 |
| Cross-language URL exact match | 0.9 |
| Cross-language URL pattern match | 0.6 |

- [ ] **Step 1:** In each analyzer, when creating CALLS relationships, set confidence based on whether an IMPORTS relationship exists between the same source/target files. If yes → 1.0, if no → 0.4-0.7 depending on proximity.

- [ ] **Step 2:** Run tests and commit.

---

### Task 22: Tree-sitter Extraction Additions

**Files:**
- Modify: `src/analyzers/tree-sitter/queries.ts`
- Modify: `src/analyzers/tree-sitter/extractor.ts`

Add tree-sitter queries for:
- Constants and enum values
- Type aliases
- Decorators/annotations (Python `@decorator`, Java `@Annotation`, TS `@Decorator`)
- Test markers (`describe`, `it`, `test`, `#[test]`, `func Test`)

- [ ] **Step 1:** Add new S-expression queries per language in `queries.ts`.
- [ ] **Step 2:** Update `extractor.ts` to create nodes/relationships for new query types.
- [ ] **Step 3:** Add tests in `tree-sitter.test.ts` for new extractions.
- [ ] **Step 4:** Run tests and commit.

---

### Task 23: TypeScript Analyzer Enhancements

**Files:**
- Modify: `src/analyzers/ts-analyzer.ts`

Add:
- Barrel file resolution: trace `export { X } from "Y"` chains to original source
- Generic type tracking: `Promise<User>` creates USES_TYPE edge to User
- tsconfig extends chain: read `extends` field to resolve full path alias map

- [ ] **Step 1:** Implement barrel file resolution by following re-export chains.
- [ ] **Step 2:** Add generic type extraction by walking TypeArguments in AST.
- [ ] **Step 3:** Update tsconfig resolution to follow `extends` chain.
- [ ] **Step 4:** Run tests and commit.

---

### Task 24: Analyzer Error Handling

**Files:**
- Modify: `src/analyzers/ts-analyzer.ts`
- Modify: `src/analyzers/tree-sitter/extractor.ts`

Replace silent file skipping with logged warnings:

```typescript
// In each analyzer, when a file fails to parse:
const warnings: { file: string; reason: string }[] = [];
try {
  // ... parse file
} catch (err) {
  warnings.push({ file: filePath, reason: (err as Error).message });
}
// Store warnings in meta table via SqliteStore
```

- [ ] **Step 1:** Add warnings array to AnalyzerResult type.
- [ ] **Step 2:** Catch errors in TS analyzer and push to warnings.
- [ ] **Step 3:** Catch errors in tree-sitter extractor and push to warnings.
- [ ] **Step 4:** Display warnings in recon_map output.
- [ ] **Step 5:** Run tests and commit.
