
<h1 align="center">Recon</h1>

<p align="center">
  <strong>Give your AI agent a brain. Index your codebase in 5 seconds.</strong><br/>
  <sub>A code intelligence MCP server — 8 tools, 13 languages, knowledge graph, zero config.</sub>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/recon-mcp"><img src="https://img.shields.io/npm/v/recon-mcp?style=flat-square&color=cb3837" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/recon-mcp"><img src="https://img.shields.io/npm/dm/recon-mcp?style=flat-square&color=blue" alt="npm downloads" /></a>
  <a href="https://github.com/jhm1909/recon/blob/main/LICENSE"><img src="https://img.shields.io/github/license/jhm1909/recon?style=flat-square" alt="license" /></a>
  <a href="https://modelcontextprotocol.io/"><img src="https://img.shields.io/badge/MCP-compatible-8A2BE2?style=flat-square" alt="MCP" /></a>
  <img src="https://img.shields.io/badge/tests-541%20passed-brightgreen?style=flat-square" alt="tests" />
</p>

<p align="center">
  <a href="#tldr">TL;DR</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#features">Features</a> ·
  <a href="#mcp-integration">MCP Setup</a> ·
  <a href="#tool-reference">Tools</a> ·
  <a href="#dashboard">Dashboard</a>
</p>

---

## TL;DR

**Your AI agent is blind to architecture.** It greps, it guesses, it breaks things in files it never read.

Recon fixes this in one line:

```bash
npx recon-mcp serve
```

That's it. Your agent now has a knowledge graph of your entire codebase:

- **Ask "what breaks if I change this function?"** — blast radius in ms
- **"Trace execution flow from this API route"** — cross-language call chain
- **"Find code structurally similar to X"** — hybrid FTS5 + vector search
- **"Safely rename this across the repo"** — graph-aware, no false positives
- **"Draw me an architecture diagram"** — Mermaid, one command
- **"Find dead code and circular deps"** — code quality rules
- **"Which tests are affected?"** — test impact analysis

Works with **Claude Code, Cursor, Windsurf** and any MCP client. **Zero config.** **13 languages.** **MIT.**

<p align="center">
  <video src="https://github.com/user-attachments/assets/1da53db2-c97d-4a0d-8282-2ef40ad6c5ba" width="100%" autoplay loop muted playsinline></video>
</p>

---

## Why Recon?

AI coding agents are **blind to architecture**. They read one file at a time, grep for identifiers, guess at call sites, and break things in places they never saw.

You can't fix this with a bigger context window. You need **structure**.

Recon indexes your codebase into a **knowledge graph** — functions, classes, call chains, imports, communities — and exposes it through **8 MCP tools**, **3 prompts**, and **3 resources** that any AI agent can query.

> **One command, full awareness.** Your agent gets dependency mapping, blast radius analysis, safe renames, execution flow tracing, natural language search, and code quality analysis — without reading every file.

---

## Quick Start

```bash
# Index your project (zero config)
cd /path/to/your/project
npx recon-mcp index

# Start MCP server for AI agents
npx recon-mcp serve

# Or start HTTP REST API + interactive dashboard
npx recon-mcp serve --http
# → http://localhost:3100
```

**Global install** (optional):

```bash
npm install -g recon-mcp
recon index && recon serve
```

> Requires **Node.js ≥ 20**. Tree-sitter grammars are bundled as npm dependencies.
> v6 uses SQLite storage (`.recon/recon.db`) — single file, no JSON sprawl.

---

## Features

<table>
<tr>
<td width="50%">

### Code Intelligence
- **13 languages** via tree-sitter + dedicated analyzers
- **Multi-repo** indexing and cross-repo queries
- **Community detection** — automatic module clustering (label propagation)
- **Blast radius** — know what breaks before you touch it
- **Graph-aware rename** — safe multi-file renames
- **Execution flow tracing** — BFS from entry points through call chains
- **Cross-language tracing** — follow API calls across Go ↔ TypeScript
- **Code quality analysis** — dead code, circular deps, unused exports
- **Test impact analysis** — affected tests per change

</td>
<td width="50%">

### Search & Query
- **FTS5 full-text search** — camelCase/snake_case tokenization with relevance ranking
- **Natural language search** — find symbols by description, not just exact names
- **Hybrid semantic search** — vector embeddings (all-MiniLM-L6-v2) + RRF fusion
- **MCP Resources** — `recon://` URIs for symbols, files, stats
- **MCP Prompts** — guided workflows for impact analysis, architecture docs, onboarding
- **Framework detection** — automatic entry point multipliers for 20+ frameworks
- **Live re-index** — file watcher with surgical graph updates (~50ms per file)
- **Graph auto-save** — persists to SQLite on every update, survives restarts
- **Graph export** — Mermaid flowchart, filterable by package/symbol/type

</td>
</tr>
</table>

---

## Supported Languages

| Language | Analyzer | What's indexed |
|----------|----------|----------------|
| **Go** | Tree-sitter + dedicated | Packages, functions, methods, structs, interfaces, call graph, imports |
| **TypeScript** | Dedicated (Compiler API) | Modules, components, functions, types, JSX usage, imports |
| **Python** | Tree-sitter | Classes, functions, methods, inheritance, imports, calls |
| **Rust** | Tree-sitter | Structs, enums, traits, functions, impl blocks, use imports, calls |
| **Java** | Tree-sitter | Classes, interfaces, enums, methods, imports, calls |
| **C** | Tree-sitter | Functions, structs, enums, macros, #include imports, calls |
| **C++** | Tree-sitter | Classes, structs, namespaces, enums, functions, inheritance, calls |
| **Ruby** | Tree-sitter | Classes, modules, methods, inheritance, require imports, calls |
| **PHP** | Tree-sitter | Classes, interfaces, functions, methods, use imports, calls |
| **C#** | Tree-sitter | Classes, interfaces, enums, methods, using imports, calls |
| **Kotlin** | Tree-sitter (optional) | Classes, interfaces, enums, functions, import declarations, calls |
| **Swift** | Tree-sitter (optional) | Classes, structs, enums, functions, import declarations, calls |
| **Cross-language** | Route matching | HTTP API routes mapped from Go handlers to TypeScript consumers |

> Kotlin and Swift require optional grammars: `npm install tree-sitter-kotlin tree-sitter-swift`
> Go grammar (`tree-sitter-go`) is bundled by default.

## Enhanced Search (Optional)

By default, Recon uses **FTS5 full-text search**. For **hybrid semantic search** (find conceptually similar code, not just exact name matches), install one optional package:

```bash
npm install @huggingface/transformers
```

Recon **auto-detects** it and enables hybrid FTS5 + vector search with [all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2) embeddings. No extra config or flags needed — just install and re-index.

## Graph Export

Export the knowledge graph as **Mermaid** (paste in GitHub PRs/docs):

```bash
# Mermaid flowchart for a package
recon export --package mcp --limit 20

# Ego graph around a symbol
recon export --symbol handleQuery --depth 2

# Filter by node types and edge types
recon export --type Function,Interface --edges CALLS
```

Also available as MCP tool `recon_export` — agents can generate diagrams directly in conversation.

## How It Works

```
You add MCP config → Agent starts Recon automatically → Done.
```

When your AI agent starts:

1. Agent reads MCP config → runs `npx recon-mcp serve`
2. `npx` downloads Recon from npm (cached after first run)
3. Recon **auto-indexes** the project (`cwd`) → creates `.recon/recon.db`
4. **File watcher** starts → monitors source files for changes
5. MCP server opens on **stdio** (stdin/stdout) — no network, no port
6. Agent sees 8 tools + 3 prompts + 3 resources
7. Agent receives built-in instructions → knows when to use each tool
8. You edit code → graph updates surgically in ~50ms → auto-saved to disk → agent always has fresh data

> **Zero config. Zero commands. Fully automatic.**

---

## MCP Integration

### Single Project

Add to your AI agent's MCP config:

<table>
<tr>
<td>

**Claude Code** (`.claude/mcp.json`)

```json
{
  "mcpServers": {
    "recon": {
      "command": "npx",
      "args": ["recon-mcp", "serve"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

</td>
<td>

**Cursor** (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "recon": {
      "command": "npx",
      "args": ["recon-mcp", "serve"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

</td>
</tr>
</table>

> `cwd` tells Recon **which project to index**. It scans code from this directory and creates `.recon/` there.

### Multiple Projects

Index and watch multiple projects from a single Recon server using `--projects`:

```json
{
  "mcpServers": {
    "recon": {
      "command": "npx",
      "args": ["recon-mcp", "serve", "--projects", "/path/to/frontend"],
      "cwd": "/path/to/backend"
    }
  }
}
```

This creates a **merged graph** — both projects are indexed, watched, and queryable from a single MCP server. Use the `repo` parameter on any tool to filter by project.

Alternatively, run separate servers per project:

```json
{
  "mcpServers": {
    "recon-backend": {
      "command": "npx",
      "args": ["recon-mcp", "serve"],
      "cwd": "/path/to/backend"
    },
    "recon-frontend": {
      "command": "npx",
      "args": ["recon-mcp", "serve"],
      "cwd": "/path/to/frontend"
    }
  }
}

### Multi-Repo (Merged Graph)

For cross-project queries (e.g., tracing API calls from frontend to backend), use multi-repo mode:

```bash
# Index each project with a name
cd /path/to/backend  && npx recon-mcp index --repo backend
cd /path/to/frontend && npx recon-mcp index --repo frontend
```

```json
{
  "mcpServers": {
    "recon": {
      "command": "npx",
      "args": ["recon-mcp", "serve"],
      "cwd": "/path/to/backend"
    }
  }
}
```

Then filter by repo in queries: `recon_find({query: "Auth", repo: "backend"})`.

### Auto-Indexing

`recon serve` handles indexing automatically:

| Scenario | Behavior |
|----------|----------|
| First run (no `.recon/`) | Full index → creates `.recon/recon.db` |
| Code changed since last index | Incremental re-index (only changed files) |
| No changes | Uses cached index → instant startup |
| Force re-index | `recon index --force` |
| Skip auto-index | `recon serve --no-index` |
| Index but no watcher | `recon serve --no-watch` |

> **Built-in Instructions:** Recon automatically injects [MCP server instructions](https://modelcontextprotocol.io/docs/concepts/server-instructions) into the agent's system prompt. The agent will proactively use `recon_impact` before editing, `recon_explain` for exploration, and `recon_rename` for safe renames — no manual prompting needed.

---

## CLI Commands

```bash
recon index                        # Index codebase (incremental)
recon index --force                # Force full re-index
recon index --repo my-backend      # Index as named repo (multi-repo)
recon index --embeddings           # Include vector embeddings for semantic search

recon serve                        # Start MCP server on stdio (auto-indexes + live watcher)
recon serve --projects ../frontend # Watch additional project directories
recon serve --http                 # Start HTTP REST API + dashboard on :3100
recon serve --http --port 8080     # Custom port
recon serve --no-index             # Skip auto-indexing and file watcher
recon serve --no-watch             # Auto-index but disable file watcher
recon serve --repo my-backend      # Serve specific repo only

recon export                       # Export graph as Mermaid flowchart (Mermaid only)
recon export --symbol handleQuery  # Ego graph around a symbol

recon status                       # Show index stats
recon status --repo my-backend     # Status for specific repo
recon clean                        # Delete index
```

> **Auto-index:** `serve` checks if the index is up-to-date with the current Git commit. If stale, it re-indexes automatically before starting. Use `--no-index` to skip.

---

## Configuration

Create a `.recon.json` at your project root to persist settings:

```jsonc
// .recon.json
{
  "projects": ["../frontend"],   // Additional dirs to index + watch
  "embeddings": false,           // Enable vector embeddings
  "watch": true,                 // Enable live file watcher
  "watchDebounce": 1500,         // Debounce interval (ms)
  "ignore": ["generated/"],      // Extra paths to ignore
  "crossLanguage": true,         // Enable cross-language API matching
  "testPatterns": ["**/*.test.*", "**/*.spec.*"],  // Test file patterns
  "rules": {                     // Code quality rule config
    "deadCode": true,
    "circularDeps": true,
    "unusedExports": true
  }
}
```

**Priority:** CLI flags always override `.recon.json`, which overrides defaults.

With a config file, your MCP setup stays minimal:

```json
{
  "mcpServers": {
    "recon": {
      "command": "npx",
      "args": ["recon-mcp", "serve"],
      "cwd": "/path/to/project"
    }
  }
}
```

> No more long `args` arrays — all config lives in `.recon.json`.

---

## Tool Reference

All 8 tools accept an optional `repo` parameter for multi-repo filtering.

### recon_map

Architecture overview: packages, tech stack, entry points, health.

```
recon_map(repo?: string)
```

### recon_find

Smart search: exact name, wildcard (`*Handler`), or natural language.

```
recon_find(query: string, type?: string, language?: string, package?: string, limit?: number)
```

### recon_explain

Full 360° context: callers, callees, flows, cross-language links, tests.

```
recon_explain(name: string, file?: string, depth?: number, include_source?: boolean)
```

### recon_impact

Blast radius analysis with affected tests.

```
recon_impact(target: string, direction?: "upstream" | "downstream", maxDepth?: number, file?: string)
```

**Risk levels:** `LOW` (0-2 d1) · `MEDIUM` (3-9) · `HIGH` (10-19) · `CRITICAL` (20+ or cross-app)

### recon_changes

Git diff to affected symbols, risk assessment, and affected tests.

```
recon_changes(scope?: "unstaged" | "staged" | "all" | "branch", base?: string, include_diagram?: boolean)
```

### recon_rename

Graph-aware safe rename across files. Dry-run by default.

```
recon_rename(symbol: string, new_name: string, file?: string, dry_run?: boolean)
```

### recon_export

Generate Mermaid diagram.

```
recon_export(target?: string, scope?: string, depth?: number, direction?: string, limit?: number)
```

### recon_rules

Code quality: dead code, circular deps, unused exports, large files, orphans.

```
recon_rules(rule?: string, package?: string, language?: string)
```

---

## MCP Resources

Structured data via `recon://` URIs — agents READ these without making a tool call.

| Resource | URI | Description |
|----------|-----|-------------|
| Index Stats | `recon://stats` | Node and relationship counts by type and language |
| Symbol Detail | `recon://symbol/{name}` | Symbol definition, callers, callees, relationships |
| File Symbols | `recon://file/{path}` | All symbols in a file with types and line ranges |

---

## MCP Prompts

Three guided workflows that instruct AI agents step-by-step using Recon's tools:

| Prompt | Description | Usage |
|--------|-------------|-------|
| **`pre_commit`** | Pre-commit change analysis → risk report | `pre_commit(scope: "staged")` |
| **`architecture`** | Architecture documentation with mermaid diagrams | `architecture()` |
| **`onboard`** | New developer onboarding guide | `onboard(focus: "auth")` |

Each prompt returns a structured message with step-by-step instructions. The agent receives the message and autonomously executes each step using Recon tools.

---

## Dashboard

Start the HTTP server to access the interactive code intelligence dashboard:

```bash
recon serve --http  # → http://localhost:3100
```

**Features:**
- **Graph Tab** — Force-directed knowledge graph with type-colored nodes, community coloring toggle, and click-to-inspect
- **Processes Tab** — Execution flow viewer with call chains, branch counts, and community tags
- **Impact Tab** — Interactive blast radius analysis with risk levels and confidence tiers
- **Live Search** — Debounced search dropdown (200ms) with keyboard navigation (↑↓ Enter Esc)
- **Graph Legend** — Node type → shape/color mapping
- **Package Sidebar** — Filter graph by package with symbol counts

---

## Multi-Repo Support

Index and query multiple repositories from a single `.recon/` directory:

```bash
cd /path/to/backend && recon index --repo backend
cd /path/to/frontend && recon index --repo frontend

recon serve                  # Serve all repos (merged graph)
recon serve --repo backend   # Serve single repo
```

All tools accept an optional `repo` parameter. Per-repo indices are stored in `.recon/recon.db`.

---

## Search

### FTS5 Full-Text Search

FTS5 replaces custom BM25, with camelCase/snake_case tokenization built into SQLite.

- **Tokenizer** splits camelCase, PascalCase, snake_case, digit boundaries (`base64Decode` → `["base", "64", "decode"]`)
- **Name boost** — symbol names weighted 3x higher than file paths
- **Ranking** — FTS5 rank function with relevance scoring
- **Fallback** — substring matching when FTS5 returns nothing

### Hybrid Semantic Search

Enable with `recon index --embeddings`, then use `recon_find({query: "...", semantic: true})`.

- **Model:** `Xenova/all-MiniLM-L6-v2` (384-dim embeddings via `@huggingface/transformers`)
- **Fusion:** Reciprocal Rank Fusion (RRF) — `score = 1/(k + rank)`, k=60
- **Storage:** Persisted in recon.db

---

## Architecture

```
├── src/
│   ├── analyzers/
│   │   ├── ts-analyzer.ts        # TypeScript/React extraction (Compiler API)
│   │   ├── cross-language.ts     # Go route ↔ TS API call matching
│   │   ├── framework-detection.ts # 20+ framework entry point detection
│   │   └── tree-sitter/          # Multi-language tree-sitter analyzer
│   ├── graph/
│   │   ├── graph.ts              # KnowledgeGraph — in-memory Map + adjacency + version
│   │   ├── community.ts          # Label propagation community detection
│   │   └── process.ts            # Execution flow detection (BFS)
│   ├── watcher/
│   │   └── watcher.ts            # Live file watcher — surgical graph updates
│   ├── mcp/
│   │   ├── server.ts             # MCP server (stdio transport)
│   │   ├── tools.ts              # 8 tool definitions (JSON Schema)
│   │   ├── handlers.ts           # Tool dispatch + query logic
│   │   ├── prompts.ts            # 3 MCP prompt templates
│   │   ├── hints.ts              # Next-step hints for agent guidance
│   │   ├── instructions.ts       # AI agent instructions (system prompt)
│   │   ├── augmentation.ts       # Compact context injection
│   │   ├── staleness.ts          # Index freshness check
│   │   ├── rename.ts             # Graph-aware multi-file rename
│   │   └── resources.ts          # MCP Resources (recon:// URIs)
│   ├── search/
│   │   ├── fts5.ts               # FTS5 full-text search
│   │   ├── hybrid-search.ts      # FTS5 + vector RRF fusion
│   │   └── vector-store.ts       # In-memory cosine similarity
│   ├── server/
│   │   └── http.ts               # Express HTTP REST API + dashboard
│   ├── dashboard/                # Interactive web dashboard
│   │   ├── index.html
│   │   ├── style.css
│   │   └── app.js
│   └── cli/
│       ├── index.ts              # Commander CLI
│       └── commands.ts           # index, serve, status, clean
```

### Data Flow

```
  TS Compiler API → components ─┐
  tree-sitter → 13 languages   ├─→ KnowledgeGraph ─→ .recon/recon.db (SQLite)
  router.go → API routes       ─┤   (in-memory)       single database:
  label propagation → clusters ─┤   + FTS5 Index       - nodes, relationships
  BFS → execution flows        ─┘   + Communities      - search index (FTS5)
                                     + Embeddings       - embeddings
                                     + Processes        - metadata
                                          │
                                  ┌───────┤
                          File Watcher (chokidar)
                          surgical update ~50ms/file
                                          │
                                ┌─────────┴──────────┐
                           MCP Server (stdio)   HTTP REST API
                         ┌───┴────┐────┐        (:3100 + Dashboard)
                      8 Tools  3 Prompts  3 Resources
                         │        │      recon://symbol/{name}
                   ┌─────┼────┐   │      recon://file/{path}
                   │     │    │   │      recon://stats
                Claude  Cursor …   │
                 Code  Antigravity │
                                  │
                          pre_commit
                          architecture
                          onboard
```

---

## HTTP REST API

```bash
recon serve --http              # Listen on :3100
recon serve --http --port 8080  # Custom port
```

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check + index stats |
| `GET` | `/api/tools` | List available tools with schemas |
| `POST` | `/api/tools/:name` | Execute a tool (body = JSON params) |
| `GET` | `/api/resources` | List MCP resources + templates |
| `GET` | `/api/resources/read?uri=...` | Read resource by URI |

```bash
# Search for a symbol
curl -X POST http://localhost:3100/api/tools/recon_find \
  -H 'Content-Type: application/json' \
  -d '{"query": "AuthMiddleware"}'

# Read a resource
curl 'http://localhost:3100/api/resources/read?uri=recon://symbol/AuthMiddleware'
```

CORS enabled by default for browser clients.

> **Security:** HTTP server binds to localhost (127.0.0.1) by default. Use `--host 0.0.0.0` to expose on network.

---

## Graph Schema

### Node Properties

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Unique node identifier |
| `type` | `NodeType` | Function, Method, Struct, Interface, Class, etc. |
| `name` | `string` | Symbol name |
| `file` | `string` | Source file path |
| `startLine` / `endLine` | `number` | Line range in file |
| `language` | `Language` | Source language |
| `package` | `string` | Package/module path |
| `exported` | `boolean` | Whether the symbol is exported |
| `repo` | `string?` | Repository name (multi-repo) |
| `community` | `string?` | Community/cluster label (auto-detected) |
| `isTest` | `boolean?` | Whether the symbol is in a test file |

### Relationship Types

| Type | Meaning | Confidence |
|------|---------|------------|
| `CONTAINS` | Package/Module → File | 1.0 |
| `DEFINES` | File → Symbol | 1.0 |
| `CALLS` | Function → Function | 0.5–1.0 |
| `IMPORTS` | Package → Package / File → File | 1.0 |
| `HAS_METHOD` | Struct/Class → Method | 1.0 |
| `IMPLEMENTS` | Struct → Interface / Class → Trait | 0.8–0.9 |
| `EXTENDS` | Class → Class (inheritance) | 0.9 |
| `USES_COMPONENT` | Component → Component (JSX) | 0.9 |
| `CALLS_API` | TS Function → Go Handler (cross-language) | 0.85–0.95 |

---

## Testing

```bash
npm test           # Run all tests
npx vitest --watch # Watch mode
```

**541 tests** across **22 test suites:**

| Suite | Tests | Coverage |
|-------|-------|----------|
| `graph.test.ts` | 23 | KnowledgeGraph API — add, query, remove, serialize |
| `handlers.test.ts` | 30 | MCP tool dispatch with mock graph |
| `search.test.ts` | 27 | FTS5 tokenizer, ranking, serialization |
| `rename.test.ts` | 28 | Graph-aware rename, disambiguation, formatting |
| `resources.test.ts` | 35 | Resource URI parsing, all 3 resource types |
| `tree-sitter.test.ts` | 58 | Multi-language extraction, cross-language consistency |
| `multi-repo.test.ts` | 16 | Multi-repo storage, filtering |
| `community.test.ts` | 13 | Label propagation clustering, handler integration |
| `embeddings.test.ts` | 39 | Vector store, RRF fusion, hybrid search |
| `process.test.ts` | 21 | Execution flow detection, BFS, cycles |
| `http.test.ts` | 18 | HTTP REST API routes, CORS |
| `framework-detection.test.ts` | 27 | Path/name framework detection, multipliers |
| `augmentation.test.ts` | 28 | Augmentation engine, staleness check, MCP prompts |
| `sqlite.test.ts` | 32 | SQLite storage, migrations, FTS5 indexing |
| `find.test.ts` | 24 | Smart search — exact, wildcard, natural language |
| `rules.test.ts` | 29 | Dead code, circular deps, unused exports, orphans |
| `errors.test.ts` | 18 | Error handling, edge cases, graceful degradation |
| `migrate.test.ts` | 15 | JSON-to-SQLite migration, data integrity |

---

## Community Detection

After indexing, Recon automatically detects code communities using the **Label Propagation Algorithm (LPA)**:

- Each function/class/struct gets a `community` label based on its connections
- Communities are named after the most common package in each cluster
- `recon_explain` shows community membership
- `recon_impact` lists affected communities for cross-module awareness

---

## Live Re-Indexing

Recon watches source files and updates the knowledge graph **in real-time**:

| Feature | Detail |
|---------|--------|
| **File watcher** | chokidar v4 with 1.5s debounce, `awaitWriteFinish` for atomic writes |
| **Surgical update** | Remove old nodes → re-parse single file → insert new nodes + edges |
| **Speed** | ~50ms per file change |
| **TS files** | Full re-analysis: symbols, imports, calls, JSX components |
| **Tree-sitter files** | Full re-analysis: symbols, calls, heritage, methods (Python, Rust, Java, etc.) |
| **Edge reconstruction** | CALLS, IMPORTS, HAS_METHOD, EXTENDS, IMPLEMENTS, USES_COMPONENT |
| **Incoming callers** | Automatically re-linked after update |
| **FTS5 index** | Auto-updated in SQLite on every graph change |
| **Multi-project** | `--projects` flag watches additional directories |
| **Ignored** | `node_modules/`, `.git/`, `dist/`, `.next/`, `build/`, `coverage/` |

### Incremental Indexing

Files are hashed with SHA-256. On `recon index`, only changed files are re-analyzed:

- **TypeScript**: per-file granularity via Compiler API
- **Tree-sitter**: per-file granularity for all 13 languages
- **Auto-detection**: `serve` compares Git commit hashes to detect stale indexes
- Force full re-index with `--force`

---

## License

[MIT](LICENSE)
