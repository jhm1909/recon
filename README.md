<p align="center">
  <img src="https://em-content.zobj.net/source/apple/391/microscope_1f52c.png" width="80" />
</p>

<h1 align="center">Recon</h1>

<p align="center">
  <strong>Code intelligence engine for AI agents</strong><br/>
  Knowledge graph · 13 languages · Live re-index · MCP + REST · Interactive dashboard
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/recon-mcp"><img src="https://img.shields.io/npm/v/recon-mcp?style=flat-square&color=cb3837" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/recon-mcp"><img src="https://img.shields.io/npm/dm/recon-mcp?style=flat-square&color=blue" alt="npm downloads" /></a>
  <a href="https://github.com/jhm1909/recon/blob/main/LICENSE"><img src="https://img.shields.io/github/license/jhm1909/recon?style=flat-square" alt="license" /></a>
  <a href="https://modelcontextprotocol.io/"><img src="https://img.shields.io/badge/MCP-compatible-8A2BE2?style=flat-square" alt="MCP" /></a>
  <img src="https://img.shields.io/badge/tests-459%20passed-brightgreen?style=flat-square" alt="tests" />
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#features">Features</a> ·
  <a href="#configuration">Config</a> ·
  <a href="#mcp-integration">MCP Setup</a> ·
  <a href="#tool-reference">Tools</a> ·
  <a href="#dashboard">Dashboard</a> ·
  <a href="#mcp-prompts">Prompts</a>
</p>

---

## Why Recon?

AI coding agents are **blind to architecture**. They grep, they guess, they break things.

Recon fixes this by indexing your codebase into a **knowledge graph** — functions, classes, call chains, imports, communities — and exposing it through **14 MCP tools**, **3 prompts**, and **5 resources** that any AI agent can query.

> 💡 **One command, full awareness.** Your agent gets dependency mapping, blast radius analysis, safe renames, execution flow tracing, Cypher queries, and hybrid semantic search — without reading every file.

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

---

## Features

<table>
<tr>
<td width="50%">

### 🔍 Code Intelligence
- **13 languages** via tree-sitter + dedicated analyzers
- **Multi-repo** indexing and cross-repo queries
- **Community detection** — automatic module clustering (label propagation)
- **Blast radius** — know what breaks before you touch it
- **Graph-aware rename** — safe multi-file renames
- **Execution flow tracing** — BFS from entry points through call chains
- **Cross-language tracing** — follow API calls across Go ↔ TypeScript
- **PR Review** — graph-aware blast radius, risk assessment, affected flows

</td>
<td width="50%">

### ⚡ Search & Query
- **BM25 search** — camelCase/snake_case tokenization with relevance ranking
- **Hybrid semantic search** — vector embeddings (all-MiniLM-L6-v2) + RRF fusion
- **Cypher-like queries** — `MATCH`/`WHERE`/`RETURN` structural queries
- **MCP Resources** — `recon://` URIs for packages, symbols, files, processes, stats
- **MCP Prompts** — guided workflows for impact analysis, architecture docs, onboarding
- **Framework detection** — automatic entry point multipliers for 20+ frameworks
- **Live re-index** — file watcher with surgical graph updates (~50ms per file)
- **Graph auto-save** — persists graph to disk every 5 updates or 30s, survives restarts
- **Graph export** — Mermaid flowchart or Graphviz DOT, filterable by package/symbol/type

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

By default, Recon uses **BM25 keyword search**. For **hybrid semantic search** (find conceptually similar code, not just exact name matches), install one optional package:

```bash
npm install @huggingface/transformers
```

Recon **auto-detects** it and enables hybrid BM25 + vector search with [all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2) embeddings. No extra config or flags needed — just install and re-index.

## Graph Export

Export the knowledge graph as **Mermaid** (paste in GitHub PRs/docs) or **Graphviz DOT** (render to SVG):

```bash
# Mermaid flowchart for a package
recon export --package mcp --limit 20

# DOT ego graph around a symbol
recon export --format dot --symbol handleQuery --depth 2

# Filter by node types and edge types
recon export --type Function,Interface --edges CALLS

# Pipe DOT to SVG
recon export --format dot | dot -Tsvg > architecture.svg
```

Also available as MCP tool `recon_export` — agents can generate diagrams directly in conversation.

## PR Review

Graph-aware code review — know what breaks **before** you merge:

```bash
# Review all uncommitted changes
recon review

# Review current branch vs main
recon review --scope branch --base main

# Review only staged changes
recon review --scope staged
```

Output includes: per-file risk (🔴🟡🟢), blast radius, affected execution flows, architecture diagram, and review priorities. Also available as MCP tool `recon_pr_review`.

## How It Works

```
You add MCP config → Agent starts Recon automatically → Done.
```

When your AI agent starts:

1. Agent reads MCP config → runs `npx recon-mcp serve`
2. `npx` downloads Recon from npm (cached after first run)
3. Recon **auto-indexes** the project (`cwd`) → creates `.recon/` folder
4. **File watcher** starts → monitors source files for changes
5. MCP server opens on **stdio** (stdin/stdout) — no network, no port
6. Agent sees 14 tools + 3 prompts + 5 resources
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

This creates a **merged graph** — both projects are indexed, watched, and querable from a single MCP server. Use `recon_list_repos` to see all repos, and the `repo` parameter on any tool to filter.

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

Then filter by repo in queries: `recon_query({query: "Auth", repo: "backend"})`. Use `recon_list_repos` to see all indexed repos.

### Auto-Indexing

`recon serve` handles indexing automatically:

| Scenario | Behavior |
|----------|----------|
| First run (no `.recon/`) | Full index → creates `.recon/` |
| Code changed since last index | Incremental re-index (only changed files) |
| No changes | Uses cached index → instant startup |
| Force re-index | `recon index --force` |
| Skip auto-index | `recon serve --no-index` |
| Index but no watcher | `recon serve --no-watch` |

> **Built-in Instructions:** Recon automatically injects [MCP server instructions](https://modelcontextprotocol.io/docs/concepts/server-instructions) into the agent's system prompt. The agent will proactively use `recon_impact` before editing, `recon_context` for exploration, and `recon_rename` for safe renames — no manual prompting needed.

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

recon export                       # Export graph as Mermaid flowchart
recon export --format dot          # Export as Graphviz DOT
recon export --symbol handleQuery  # Ego graph around a symbol

recon review                       # PR review — blast radius + risk
recon review --scope branch        # Review branch diff vs main
recon review --scope staged        # Review staged changes only

recon status                       # Show index stats
recon status --repo my-backend     # Status for specific repo
recon clean                        # Delete index
recon init                         # Create .recon.json config file
```

> **Auto-index:** `serve` checks if the index is up-to-date with the current Git commit. If stale, it re-indexes automatically before starting. Use `--no-index` to skip.

---

## Configuration

Create a `.recon.json` at your project root to persist settings:

```bash
recon init  # Creates .recon.json with defaults
```

```jsonc
// .recon.json
{
  "projects": ["../frontend"],   // Additional dirs to index + watch
  "embeddings": false,           // Enable vector embeddings
  "watch": true,                 // Enable live file watcher
  "watchDebounce": 1500,         // Debounce interval (ms)
  "ignore": ["generated/"]       // Extra paths to ignore
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

All 14 tools accept an optional `repo` parameter for multi-repo filtering.

### recon_packages

List all packages/modules with dependency relationships.

```
recon_packages(language?: "go" | "typescript" | "all")
```

### recon_query

BM25 ranked search with automatic camelCase/snake_case tokenization. Exact names rank highest. Supports optional hybrid BM25 + vector search with Reciprocal Rank Fusion.

```
recon_query(query: string, type?: string, language?: string, semantic?: boolean, limit?: number)
```

### recon_context

360° view of a symbol — callers, callees, imports, methods, implementations, community membership.

```
recon_context(name: string, file?: string, includeSource?: boolean)
```

### recon_impact

Blast radius analysis — what breaks if you change a symbol. Includes affected communities and confidence tiers.

```
recon_impact(target: string, direction: "upstream" | "downstream", maxDepth?: number)
```

**Risk levels:** `LOW` (0–2 d1) · `MEDIUM` (3–9) · `HIGH` (10–19) · `CRITICAL` (20+ or cross-app)

### recon_detect_changes

Map git diff to affected symbols and trace blast radius.

```
recon_detect_changes(scope?: "unstaged" | "staged" | "all" | "branch", base?: string)
```

### recon_api_map

Cross-language API route map — endpoint → Go handler → TypeScript consumers.

```
recon_api_map(method?: string, pattern?: string, handler?: string)
```

### recon_rename

Safe multi-file rename using the knowledge graph. Each edit is tagged with confidence: **`graph`** (high, safe to accept) or **`text_search`** (review carefully).

```
recon_rename(symbol_name: string, new_name: string, dry_run?: boolean)
```

### recon_query_graph

Cypher-like structural queries against the knowledge graph.

```cypher
MATCH (a)-[:CALLS]->(b:Function) WHERE b.name = 'main' RETURN a.name, a.file
MATCH (s:Struct)-[:HAS_METHOD]->(m:Method) WHERE s.name = 'Config' RETURN m.name
MATCH (child:Class)-[:EXTENDS]->(parent:Class) RETURN child.name, parent.name
```

**Node types:** `Package` · `File` · `Function` · `Method` · `Struct` · `Interface` · `Module` · `Component` · `Type` · `Class` · `Enum` · `Trait`

**Edge types:** `CONTAINS` · `DEFINES` · `CALLS` · `IMPORTS` · `HAS_METHOD` · `IMPLEMENTS` · `USES_COMPONENT` · `CALLS_API` · `EXTENDS`

### recon_list_repos

List all indexed repositories with node/relationship counts and git info.

### recon_processes

Detect execution flows by tracing call chains from entry points. Sorted by complexity.

```
recon_processes(limit?: number, filter?: string)
```

### recon_augment

Compact symbol context for AI augmentation — returns callers, callees, processes, and community in one concise block.

```
recon_augment(pattern: string)
```

### recon_watcher_status

Get the live status of the file watcher — active state, watched directories, update count, last update, pending queue, and recent errors.

```
recon_watcher_status()
```

### recon_export

Export the knowledge graph as a Mermaid flowchart or Graphviz DOT diagram. Filterable by package, symbol, node type, and edge type.

```
recon_export(format?: "mermaid" | "dot", package?: string, symbol?: string, depth?: number, type?: string, edges?: string, limit?: number)
```

### recon_pr_review

Graph-aware PR review — analyzes code changes using the dependency graph to assess blast radius, risk, affected execution flows, and review priorities.

```
recon_pr_review(scope?: "staged" | "unstaged" | "branch" | "all", base?: string, include_diagram?: boolean)
```

**Risk levels:** `LOW` · `MEDIUM` · `HIGH` · `CRITICAL` — scored by direct callers, confidence tiers, and cross-community impact.

---

## MCP Resources

Structured data via `recon://` URIs — agents READ these without making a tool call.

| Resource | URI | Description |
|----------|-----|-------------|
| Package Map | `recon://packages` | All packages/modules with dependency counts |
| Index Stats | `recon://stats` | Node and relationship counts by type and language |
| Symbol Detail | `recon://symbol/{name}` | Symbol definition, callers, callees, relationships |
| File Symbols | `recon://file/{path}` | All symbols in a file with types and line ranges |
| Process Trace | `recon://process/{name}` | Execution flow trace from entry point through call chain |

---

## MCP Prompts

Three guided workflows that instruct AI agents step-by-step using Recon's tools:

| Prompt | Description | Usage |
|--------|-------------|-------|
| **`detect_impact`** | Pre-commit change analysis → risk report | `detect_impact(scope: "staged")` |
| **`generate_map`** | Architecture documentation with mermaid diagrams | `generate_map()` |
| **`onboard`** | New developer onboarding guide | `onboard(focus: "auth")` |

Each prompt returns a structured message with step-by-step instructions. The agent receives the message and autonomously executes each step using Recon tools.

---

## Dashboard

Start the HTTP server to access the interactive code intelligence dashboard:

```bash
recon serve --http  # → http://localhost:3100
```

**Features:**
- 🔹 **Graph Tab** — Force-directed knowledge graph with type-colored nodes, community coloring toggle, and click-to-inspect
- 🔹 **Processes Tab** — Execution flow viewer with call chains, branch counts, and community tags
- 🔹 **Impact Tab** — Interactive blast radius analysis with risk levels and confidence tiers
- 🔹 **Live Search** — Debounced search dropdown (200ms) with keyboard navigation (↑↓ Enter Esc)
- 🔹 **Graph Legend** — Node type → shape/color mapping
- 🔹 **Package Sidebar** — Filter graph by package with symbol counts

---

## Multi-Repo Support

Index and query multiple repositories from a single `.recon/` directory:

```bash
cd /path/to/backend && recon index --repo backend
cd /path/to/frontend && recon index --repo frontend

recon serve                  # Serve all repos (merged graph)
recon serve --repo backend   # Serve single repo
```

All tools accept an optional `repo` parameter. Use `recon_list_repos` to discover indexed repos. Per-repo indices are stored under `.recon/repos/{repoName}/`.

---

## Search

### BM25 Keyword Search

- **Tokenizer** splits camelCase, PascalCase, snake_case, digit boundaries (`base64Decode` → `["base", "64", "decode"]`)
- **Name boost** — symbol names weighted 3× higher than file paths
- **IDF scoring** — rare terms rank higher
- **Fallback** — substring matching when BM25 returns nothing

### Hybrid Semantic Search

Enable with `recon index --embeddings`, then use `recon_query({query: "...", semantic: true})`.

- **Model:** `Xenova/all-MiniLM-L6-v2` (384-dim embeddings via `@huggingface/transformers`)
- **Fusion:** Reciprocal Rank Fusion (RRF) — `score = 1/(k + rank)`, k=60
- **Storage:** Persisted to `.recon/embeddings.json`

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
│   │   ├── tools.ts              # 12 tool definitions (JSON Schema)
│   │   ├── handlers.ts           # Tool dispatch + query logic
│   │   ├── prompts.ts            # 3 MCP prompt templates
│   │   ├── hints.ts              # Next-step hints for agent guidance
│   │   ├── instructions.ts       # AI agent instructions (system prompt)
│   │   ├── augmentation.ts       # Compact context injection
│   │   ├── staleness.ts          # Index freshness check
│   │   ├── rename.ts             # Graph-aware multi-file rename
│   │   └── resources.ts          # MCP Resources (recon:// URIs)
│   ├── search/
│   │   ├── bm25.ts               # BM25 search index
│   │   ├── hybrid-search.ts      # BM25 + vector RRF fusion
│   │   └── vector-store.ts       # In-memory cosine similarity
│   ├── query/
│   │   ├── parser.ts             # Cypher DSL parser
│   │   └── executor.ts           # Query execution + formatting
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
  tree-sitter → 13 languages   ├─→ KnowledgeGraph ─→ .recon/graph.json
  router.go → API routes       ─┤   (in-memory)   ─→ .recon/meta.json
  label propagation → clusters ─┤   + BM25 Index   ─→ .recon/search.json
  BFS → execution flows        ─┘   + Communities  ─→ .recon/embeddings.json
                                     + Embeddings
                                     + Processes
                                          │
                                  ┌───────┤
                          File Watcher (chokidar)
                          surgical update ~50ms/file
                                          │
                                ┌─────────┴──────────┐
                           MCP Server (stdio)   HTTP REST API
                         ┌───┴────┐────┐        (:3100 + Dashboard)
                     12 Tools  3 Prompts  5 Resources
                         │        │      recon://packages
                   ┌─────┼────┐   │      recon://symbol/{name}
                   │     │    │   │      recon://file/{path}
                Claude  Cursor …   │      recon://process/{name}
                 Code  Antigravity │      recon://stats
                                  │
                          detect_impact
                          generate_map
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
curl -X POST http://localhost:3100/api/tools/recon_query \
  -H 'Content-Type: application/json' \
  -d '{"query": "AuthMiddleware"}'

# Read a resource
curl 'http://localhost:3100/api/resources/read?uri=recon://symbol/AuthMiddleware'
```

CORS enabled by default for browser clients.

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

**410 tests** across **14 test suites:**

| Suite | Tests | Coverage |
|-------|-------|----------|
| `graph.test.ts` | 23 | KnowledgeGraph API — add, query, remove, serialize |
| `handlers.test.ts` | 30 | MCP tool dispatch with mock graph |
| `search.test.ts` | 27 | BM25 tokenizer, ranking, serialization |
| `rename.test.ts` | 28 | Graph-aware rename, disambiguation, formatting |
| `resources.test.ts` | 35 | Resource URI parsing, all 5 resource types |
| `tree-sitter.test.ts` | 58 | Multi-language extraction, cross-language consistency |
| `query.test.ts` | 47 | Cypher parser, execution, markdown formatting |
| `multi-repo.test.ts` | 16 | Multi-repo storage, filtering, list_repos |
| `community.test.ts` | 13 | Label propagation clustering, handler integration |
| `embeddings.test.ts` | 39 | Vector store, RRF fusion, hybrid search |
| `process.test.ts` | 21 | Execution flow detection, BFS, cycles |
| `http.test.ts` | 18 | HTTP REST API routes, CORS |
| `framework-detection.test.ts` | 27 | Path/name framework detection, multipliers |
| `augmentation.test.ts` | 28 | Augmentation engine, staleness check, MCP prompts |

---

## Community Detection

After indexing, Recon automatically detects code communities using the **Label Propagation Algorithm (LPA)**:

- Each function/class/struct gets a `community` label based on its connections
- Communities are named after the most common package in each cluster
- `recon_context` shows community membership
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
| **BM25 cache** | Auto-invalidated via graph version counter |
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
