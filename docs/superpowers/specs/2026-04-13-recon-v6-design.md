# Recon v6.0.0 — Comprehensive Redesign Spec

## Identity

**"Agent understands your code like a senior dev"** — with safety and fast onboarding as supporting pillars.

## Approach

**Evolution of storage + revolution of API surface.** Keep analyzers (tree-sitter + TS Compiler API), replace storage layer (JSON → SQLite), redesign tool surface (14 → 8), add new capabilities (test impact, dead code, natural language search).

## Target Audience

Open source community — must work with any stack, any project size. No hardcoded paths, no framework-specific assumptions baked in.

## Breaking Changes

Major version bump to 6.0.0. No backward compatibility with v5 tool names. Auto-migration from v5 JSON to v6 SQLite on first run.

---

## 1. Storage Layer — SQLite + FTS5

### Current Problem

- Entire graph loaded into RAM — 50K file project = 100MB+ memory
- JSON serialize/deserialize on every save — O(n) with total nodes
- Crash mid-index = partial state, no rollback
- BM25 custom implementation in separate `search.json`
- Startup requires loading + parsing everything

### New Design

Single SQLite database at `.recon/recon.db`:

```sql
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,        -- Function, Class, Method, etc.
  name TEXT NOT NULL,
  file TEXT,
  line INTEGER,
  endLine INTEGER,
  exported BOOLEAN DEFAULT FALSE,
  language TEXT,
  package TEXT,
  community TEXT,
  isTest BOOLEAN DEFAULT FALSE,
  meta TEXT                  -- JSON blob for extensible metadata
);

CREATE TABLE relationships (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,        -- CALLS, IMPORTS, HAS_METHOD, etc.
  source TEXT NOT NULL REFERENCES nodes(id),
  target TEXT NOT NULL REFERENCES nodes(id),
  confidence REAL DEFAULT 1.0,
  meta TEXT                  -- JSON blob (httpMethod, urlPattern, etc.)
);

-- FTS5 replaces custom BM25
CREATE VIRTUAL TABLE nodes_fts USING fts5(
  name, package, file,
  content='nodes',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
-- Keys: repo, gitCommit, schemaVersion, indexedAt, nodeCount, relCount

CREATE TABLE embeddings (
  node_id TEXT PRIMARY KEY REFERENCES nodes(id),
  vector BLOB               -- Float32Array serialized
);

-- Performance indexes
CREATE INDEX idx_nodes_file ON nodes(file);
CREATE INDEX idx_nodes_type ON nodes(type);
CREATE INDEX idx_nodes_package ON nodes(package);
CREATE INDEX idx_nodes_language ON nodes(language);
CREATE INDEX idx_nodes_test ON nodes(isTest);
CREATE INDEX idx_rels_source ON relationships(source);
CREATE INDEX idx_rels_target ON relationships(target);
CREATE INDEX idx_rels_type ON relationships(type);
```

### Why SQLite

- `better-sqlite3` — synchronous, zero-config, single file, fast
- FTS5 replaces custom BM25 — faster, unicode-aware, ranking built-in
- ACID transactions — crash-safe, no partial state
- Query without loading entire graph into RAM
- Scales naturally to 500K+ nodes
- `.recon/recon.db` replaces 4 separate JSON files

### What's Kept

- In-memory adjacency index for hot paths (impact analysis, context lookup) — lazy-loaded, only subgraph needed
- SHA-256 incremental indexing logic — unchanged
- File watcher surgical update — writes directly to DB instead of mutating Map then flushing JSON

### Dependency Addition

```
+ better-sqlite3          (runtime)
+ @types/better-sqlite3   (devDependency)
```

No dependencies removed. Total: +1 runtime dependency.

---

## 2. Tool API Surface — 14 → 8 Tools

### Tool 1: `recon_map`

**Purpose:** Architecture overview — first tool to call in any codebase.

**Replaces:** `recon_packages` + `recon_list_repos` + `recon_watcher_status`

```
Input:  { repo?: string }
Output:
  - Tech stack detected (languages, frameworks, package managers)
  - Packages/modules with dependency arrows
  - Entry points (API routes, CLI, main files)
  - Metrics (files, functions, classes, test ratio)
  - Index health (freshness, watcher status)
  - Multi-repo listing (if applicable)
  - Warnings (skipped files, parse errors)
```

Tech stack auto-detection sources:
- `package.json` → next, express, react, vue, angular, nestjs
- `go.mod` → gin, echo, fiber, chi
- `Cargo.toml` → actix, axum, rocket
- `requirements.txt` / `pyproject.toml` → django, flask, fastapi
- `Gemfile` → rails, sinatra
- `*.csproj` → aspnet, blazor
- `Dockerfile` → containerized
- `.github/` → CI/CD active

### Tool 2: `recon_find`

**Purpose:** Smart search — exact, pattern, natural language, semantic.

**Replaces:** `recon_query` + `recon_query_graph`

```
Input:  { query: string, type?: NodeType, language?: string,
          package?: string, limit?: number }
Output:
  - Ranked matches: name, file:line, type, exported, callers, callees
  - Search method used (fts5 / semantic / exact / pattern / structural)
```

Query routing logic (rule-based, no LLM needed):
- Contains `*` or `?` → pattern match (SQL LIKE)
- Single word or camelCase/snake_case → exact match → fallback FTS5
- Contains structural keywords (`exported`, `no callers`, `unused`, `implements`) → SQL structural query
- Multi-word natural language → FTS5 full-text → fallback semantic if embeddings available

### Tool 3: `recon_explain`

**Purpose:** Full 360-degree context of a symbol.

**Replaces:** `recon_context` + `recon_processes` + `recon_api_map` + `recon_augment`

```
Input:  { name: string, file?: string, depth?: number,
          include_source?: boolean }
Output:
  - Identity: type, file:line, exported, language, package, community
  - Callers (who calls this?)
  - Callees (what does this call?)
  - Imports / Imported by
  - Methods (if struct/class/interface)
  - Implements / Extended by
  - Execution flows passing through this symbol
  - Cross-language links (Go handler <-> TS consumer, if applicable)
  - Source code snippet (if include_source=true)
  - Quick risk: "Affected if changed: N direct, M transitive (RISK level)"
```

### Tool 4: `recon_impact`

**Purpose:** Blast radius analysis + affected tests.

**Replaces:** `recon_impact` (upgraded with test impact)

```
Input:  { target: string, direction?: "upstream"|"downstream",
          maxDepth?: number, file?: string }
Output:
  - d=1: WILL BREAK (direct callers/importers)
  - d=2: LIKELY AFFECTED
  - d=3: MAY NEED TESTING
  - Risk: LOW / MEDIUM / HIGH / CRITICAL
  - Affected tests (test files that import/call affected symbols)
  - Cross-app warnings
  - Suggested actions
```

Test impact analysis: scans nodes with `isTest=true` in the affected set, reports which test files cover the changed code.

### Tool 5: `recon_changes`

**Purpose:** Git diff → symbols → risk assessment.

**Replaces:** `recon_detect_changes` + `recon_pr_review`

```
Input:  { scope?: "unstaged"|"staged"|"branch"|"commit",
          base?: string, include_diagram?: boolean }
Output:
  - Changed files + modified symbols
  - Blast radius per symbol
  - Overall risk level
  - Affected execution flows
  - Affected tests
  - Review priorities (ordered by risk)
  - Mermaid diagram (optional)
```

### Tool 6: `recon_rename`

**Purpose:** Graph-aware safe rename across files.

**Replaces:** `recon_rename` (bug fixed)

```
Input:  { symbol: string, new_name: string, file?: string,
          dry_run?: boolean }
Output:
  - Edit plan: [{file, line, old, new, confidence: "graph"|"text"}]
  - Total edit count
  - Risk warnings (if text_search confidence edits exist)
```

Fix: disambiguation returns structured error object instead of plain string.

### Tool 7: `recon_export`

**Purpose:** Mermaid diagram generation.

**Replaces:** `recon_export` (DOT format removed)

```
Input:  { target?: string, scope?: "package"|"symbol"|"file",
          depth?: number, direction?: "callers"|"callees"|"both",
          limit?: number }
Output:
  - Mermaid flowchart code block
```

### Tool 8: `recon_rules`

**Purpose:** Code quality analysis via graph. NEW — no v5 equivalent.

```
Input:  { rule?: "dead_code"|"unused_exports"|"circular_deps"
                |"large_files"|"orphans",
          package?: string, language?: string }
Output:
  - dead_code: exported symbols with zero importers
  - unused_exports: exports only used within same file
  - circular_deps: cycles in import graph (DFS with coloring)
  - large_files: files exceeding symbol threshold (default: 30)
  - orphans: files with zero incoming and zero outgoing relationships
```

Circular dependency detection algorithm: DFS with WHITE/GRAY/BLACK coloring. Back-edge to GRAY node = cycle. Runs at package level by default.

---

## 3. New Capabilities

### 3.1 Test Impact Analysis

v5 excludes test files from the graph. v6 indexes test files with `isTest: true` flag.

Detection heuristics for test files:
- File name patterns: `*.test.*`, `*.spec.*`, `*_test.*`
- Directory patterns: `__tests__/`, `test/`, `tests/`, `spec/`
- Content markers: `describe(`, `it(`, `test(`, `#[test]`, `func Test`

Default behavior:
- `recon_find`: excludes test nodes by default (`WHERE isTest = FALSE`)
- `recon_impact`: includes test nodes in separate "Affected Tests" section
- `recon_changes`: includes test nodes in affected tests section

### 3.2 Natural Language Query Routing

`recon_find` accepts natural language queries without requiring Cypher syntax.

Rule-based routing (no LLM inference needed):

| Input Pattern | Strategy | Example |
|---|---|---|
| Contains `*` or `?` | Pattern match (SQL LIKE) | `*Handler` |
| Single token, camelCase/snake_case | Exact → FTS5 fallback | `getUserById` |
| Structural keywords | SQL structural query | `exported functions with no callers` |
| Multi-word natural language | FTS5 → semantic fallback | `functions that handle authentication` |

Structural keywords detected: `exported`, `unexported`, `no callers`, `no callees`, `unused`, `implements`, `extends`, `orphan`, `dead`, `circular`, `test`, `entry point`. If a query contains 2+ of these keywords, treat as structural query. Otherwise, fall through to FTS5.

### 3.3 Dead Code & Code Smell Detection

5 rules in `recon_rules`, all powered by graph queries:

| Rule | Logic | Value |
|---|---|---|
| `dead_code` | exported=true AND zero incoming CALLS/IMPORTS | Find unused code |
| `unused_exports` | exported=true AND only used within same file | Unnecessary exports |
| `circular_deps` | DFS back-edge detection on import graph | Import cycles |
| `large_files` | COUNT(nodes) GROUP BY file > threshold | Files needing split |
| `orphans` | Zero incoming AND zero outgoing relationships | Forgotten files |

### 3.4 Tech Stack Auto-Detection

Part of `recon_map`. Reads manifest files to detect frameworks:

| Source | Detects |
|---|---|
| `package.json` | next, express, react, vue, angular, nestjs, vite |
| `go.mod` | gin, echo, fiber, chi |
| `Cargo.toml` | actix, axum, rocket, tokio |
| `requirements.txt` / `pyproject.toml` | django, flask, fastapi |
| `Gemfile` | rails, sinatra |
| `*.csproj` | aspnet, blazor |
| `Dockerfile` | containerized |
| `.github/` | CI/CD platform |

---

## 4. Analyzer Improvements

### 4.1 Cross-Language — Config-Driven Discovery

Remove all hardcoded paths. Replace with auto-discovery + optional config.

```jsonc
// .recon.json (optional — auto-detection works without this)
{
  "crossLanguage": {
    "auto": true,
    "routes": [],      // manual: glob patterns for route files
    "consumers": []    // manual: glob patterns for API consumer files
  }
}
```

Auto-discovery steps:
1. Detect framework from tech stack (recon_map)
2. Apply framework-specific regex for route registration patterns
3. Normalize URL patterns for cross-language matching
4. Create CALLS_API edges with confidence scoring

### 4.2 Contextual Confidence Scoring

Replace fixed heuristic confidence with per-signal scoring:

| Signal | Confidence | Reason |
|---|---|---|
| Direct import + direct call | 1.0 | Compiler-level certainty |
| Import but call via alias | 0.9 | Near certain |
| Same name, same file, no import | 0.7 | Likely local call |
| Same name, different file, no import | 0.4 | Possible name collision |
| Cross-language URL match (exact) | 0.9 | URL matches exactly |
| Cross-language URL match (pattern) | 0.6 | Has wildcard/param |

### 4.3 Tree-sitter Extraction Additions

New extractions added to tree-sitter queries:

| New | Reason |
|---|---|
| Constants/Enum values | Needed for refactoring awareness |
| Type aliases | `type UserID = string` — track in graph |
| Decorators/Annotations | `@Injectable()`, `@Controller("/api")` — framework metadata |
| Test markers | `describe`, `it`, `test`, `#[test]`, `func Test` — for test indexing |

Not added (intentionally):
- Comments/docstrings — not graph data, use Read tool
- Variable tracking — too granular, more noise than signal
- Control flow (if/for/while) — agent doesn't need this

### 4.4 TypeScript Analyzer Additions

Keep `ts.createSourceFile()` parser-only approach.

Add:
- Barrel file resolution: `index.ts` → re-exports → trace to original source
- Generic type tracking: `Promise<User>` → USES_TYPE → User
- Path alias resolution: read tsconfig extends chain + project references

### 4.5 Error Handling in Analyzers

Replace silent skipping with recorded warnings:

| Error | v5 Behavior | v6 Behavior |
|---|---|---|
| Parse error | Silent skip | Log warning + record in meta table |
| Permission error | Silent skip | Log error + record in meta table |
| Binary file | Silent skip | Detect magic bytes → skip + warn |
| Encoding issue | Silent skip | Try UTF-8 → Latin-1 → skip + warn |

`recon_map` output includes warnings section showing skipped files.

---

## 5. Agent UX

### 5.1 System Instructions

Reduce from ~27KB to ~500 bytes:

```
Recon — code intelligence for YOUR codebase.

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
- Search text literally → Grep tool
```

### 5.2 Tool Description Format

Each tool description follows a standard template:

```
[Tool name] — [1 sentence what it does]

WHEN: [when to call this]
NOT: [when NOT to call this]
THEN: [logical next tool]
```

Remove separate `getNextStepHint()` system — hints are in descriptions. Saves tokens per response.

### 5.3 Structured Error Messages

Every error returns a structured JSON object:

```json
{
  "error": "symbol_not_found",
  "symbol": "getUserById",
  "suggestion": {
    "tool": "recon_find",
    "params": { "query": "getUserById" },
    "reason": "No exact match. Use recon_find for fuzzy search."
  },
  "similar": ["getUser", "getUserByEmail", "findUserById"]
}
```

Error types and their responses:
- `symbol_not_found` — similar matches + suggest recon_find
- `ambiguous_symbol` — list matches + suggest adding file param
- `invalid_parameter` — expected values + example
- `index_stale` — last indexed time + suggest re-index
- `empty_graph` — suggest `npx recon index`

### 5.4 Response Format Principles

1. Structured data first, prose second
2. Don't echo input back
3. Flat structure — no nested markdown tables
4. Target <2000 tokens per response — truncate + hint if larger

### 5.5 MCP Prompts

3 prompts, simplified:

| Prompt | Purpose | Flow |
|---|---|---|
| `pre_commit` | Before commit | `recon_changes(staged)` → flag risk → list affected tests |
| `architecture` | Generate ARCHITECTURE.md | `recon_map` → `recon_rules` → format doc |
| `onboard` | Onboarding guide | `recon_map` → `recon_find(entry points)` → `recon_explain(top 5)` |

### 5.6 MCP Resources

3 resources (reduced from 5):
- `recon://stats` — index health check
- `recon://symbol/{name}` — lightweight symbol lookup
- `recon://file/{path}` — symbols in a file

Removed:
- `recon://packages` — replaced by `recon_map` tool
- `recon://process/{name}` — merged into `recon_explain`

---

## 6. Configuration

### .recon.json

All fields optional. No config file = everything auto-detected.

```jsonc
{
  "projects": [],
  "embeddings": false,
  "watch": true,
  "watchDebounce": 1500,
  "http": false,
  "port": 3100,
  "ignore": [],
  "crossLanguage": {
    "auto": true,
    "routes": [],
    "consumers": []
  },
  "testPatterns": [],
  "rules": {
    "largeFileThreshold": 30,
    "circularDepsLevel": "package"
  }
}
```

### CLI Commands

5 commands (reduced from 7):

| Command | Description | Changes |
|---|---|---|
| `recon index` | Index codebase | Added `--include-tests` |
| `recon serve` | MCP server + watcher | Unchanged |
| `recon status` | Index health + stats | Merged watcher status |
| `recon clean` | Delete `.recon/` | Unchanged |
| `recon export` | Export Mermaid diagram | Removed DOT format |

Removed: `recon init` (zero-config default), `recon review` (merged into recon_changes tool).

### Security

- HTTP server binds `127.0.0.1` by default (was `0.0.0.0`)
- CORS restricted to localhost origins
- `--host 0.0.0.0` flag available with printed warning

---

## 7. Migration Path

### v5 → v6 Auto-Migration

On first `recon index` or `recon serve` with v6:

1. Detect `.recon/graph.json` + `meta.json` (v5 format)
2. Read JSON files, create `recon.db`
3. INSERT all nodes and relationships into SQLite
4. Build FTS5 index
5. Copy metadata
6. Rename `graph.json` → `graph.json.v5.bak`
7. Print migration message

No downgrade support. One-way migration.

### Tool Name Migration

| v5 Tool | v6 Equivalent |
|---|---|
| `recon_packages` | `recon_map` |
| `recon_query` | `recon_find` |
| `recon_context` | `recon_explain` |
| `recon_impact` | `recon_impact` |
| `recon_detect_changes` | `recon_changes` |
| `recon_rename` | `recon_rename` |
| `recon_query_graph` | `recon_find` (natural language) |
| `recon_processes` | `recon_explain` |
| `recon_api_map` | `recon_explain` (cross-language section) |
| `recon_augment` | Removed (redundant with recon_explain) |
| `recon_watcher_status` | `recon_map` (health section) |
| `recon_list_repos` | `recon_map` (multi-repo section) |
| `recon_export` | `recon_export` |
| `recon_pr_review` | `recon_changes` |
| — | `recon_rules` (NEW) |

---

## 8. What's Unchanged

- Tree-sitter analyzers for 12 languages
- TypeScript Compiler API analyzer (`ts.createSourceFile`)
- SHA-256 incremental indexing
- Chokidar file watcher with surgical update
- Community detection (Label Propagation)
- Process detection (BFS + scoring)
- `@modelcontextprotocol/sdk` MCP protocol layer
- Package name `recon-mcp` on npm
- MIT license
- Node.js >= 20 requirement
