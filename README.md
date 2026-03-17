# Recon

Lightweight code intelligence engine for AI agents. Builds a knowledge graph of **13 languages**, tracks cross-language API calls, detects code communities, and exposes 10 tools + 5 resources via [Model Context Protocol](https://modelcontextprotocol.io/) or HTTP REST API.

> Give your AI agent architectural awareness — dependency mapping, blast radius analysis, safe renames, community detection, Cypher-like graph queries, hybrid semantic search, execution flow tracing, multi-repo support, and call graph traversal without reading every file.

---

## Why Recon?

AI coding agents are blind to architecture. They grep, they guess, they break things. Recon fixes this by indexing your codebase into a knowledge graph that agents can query through MCP:

- **13 language support** — Go, TypeScript, Python, Rust, Java, C, C++, Ruby, PHP, C#, Kotlin, Swift via tree-sitter + dedicated analyzers
- **Multi-repo indexing** — index multiple repositories, query across them or filter by repo
- **Community detection** — automatic module clustering via label propagation to understand code architecture
- **Blast radius before editing** — know what breaks before you touch it
- **Graph-aware rename** — safe multi-file renames using the call graph, not find-and-replace
- **Cypher-like graph queries** — structural queries with `MATCH`/`WHERE`/`RETURN` syntax
- **BM25 ranked search** — keyword search with camelCase/snake_case tokenization and relevance scoring
- **Hybrid semantic search** — optional vector embeddings (all-MiniLM-L6-v2) with Reciprocal Rank Fusion for BM25 + semantic results
- **Process/flow detection** — automatic execution flow tracing from entry points through call chains
- **HTTP REST API** — optional Express server (`recon serve --http`) wrapping all MCP tools as REST endpoints
- **Cross-language tracing** — follow API calls from TypeScript frontend to Go backend
- **MCP Resources** — structured data via `recon://` URIs for packages, symbols, files, processes, and stats
- **Incremental indexing** — sub-second re-index on file changes
- **Zero config** — point it at a repo, run `npx recon index`, done

## Supported Languages

| Language | Analyzer | What's indexed |
|----------|----------|---------------|
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

Kotlin and Swift grammars are optional dependencies — install them with `npm install tree-sitter-kotlin tree-sitter-swift` if needed.

## Architecture

```
├── bin/recon                # CLI entry point
├── src/
│   ├── analyzers/
│   │   ├── ts-analyzer.ts   # TypeScript/React component extraction
│   │   ├── cross-language.ts # Go route ↔ TS API call matching
│   │   ├── tree-sitter/     # Multi-language tree-sitter analyzer
│   │   │   ├── parser.ts    #   Grammar loading + language detection
│   │   │   ├── queries.ts   #   S-expression queries (13 languages)
│   │   │   ├── extractor.ts #   Symbol/call/import/heritage extraction
│   │   │   ├── analyzer.ts  #   File walker + incremental indexing
│   │   │   └── index.ts     #   Module barrel
│   │   └── types.ts         # Shared analyzer interfaces
│   ├── graph/
│   │   ├── graph.ts         # KnowledgeGraph — in-memory Map + adjacency index
│   │   ├── community.ts     # Label propagation community detection
│   │   ├── process.ts       # Execution flow detection (BFS from entry points)
│   │   └── types.ts         # Node, Relationship, enums
│   ├── mcp/
│   │   ├── server.ts        # MCP server (stdio transport)
│   │   ├── tools.ts         # Tool definitions (JSON Schema)
│   │   ├── handlers.ts      # Tool dispatch + query logic
│   │   ├── hints.ts         # Next-step hints appended to responses
│   │   ├── instructions.ts  # AI agent instructions (injected into system prompt)
│   │   ├── rename.ts        # Graph-aware multi-file rename
│   │   └── resources.ts     # MCP Resources (recon:// URIs)
│   ├── query/
│   │   ├── parser.ts        # Simplified Cypher DSL parser
│   │   ├── executor.ts      # Query execution + markdown formatting
│   │   └── index.ts         # Module barrel
│   ├── search/
│   │   ├── bm25.ts          # Standalone BM25 search index
│   │   ├── embedder.ts      # Vector embeddings (all-MiniLM-L6-v2)
│   │   ├── vector-store.ts  # In-memory cosine similarity store
│   │   ├── hybrid-search.ts # BM25 + vector RRF fusion
│   │   ├── text-generator.ts# Embedding text generator
│   │   └── index.ts         # Module barrel
│   ├── storage/
│   │   ├── store.ts         # JSON file I/O (.recon/ + multi-repo)
│   │   └── types.ts         # IndexMeta, IndexStats
│   ├── server/
│   │   └── http.ts          # Express HTTP REST API server
│   ├── utils/
│   │   └── hash.ts          # SHA-256 file hashing
│   └── cli/
│       ├── index.ts         # Commander CLI setup
│       └── commands.ts      # index, serve, status, clean commands
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
                                ┌─────────┴──────────┐
                           MCP Server (stdio)   HTTP REST API
                           ┌────┴────┐          (:3100)
                        10 Tools   5 Resources
                           │         │
                     ┌─────┼─────┐   recon://packages
                     │     │     │   recon://symbol/{name}
                 Claude   Cursor  …   recon://file/{path}
                  Code   Antigravity  recon://process/{name}
                                      recon://stats
```

## Installation

### Quick Start (npx — no install needed)

```bash
# Index your project
cd /path/to/your/project
npx recon-mcp index

# Start MCP server (auto-indexes if needed)
npx recon-mcp serve
```

### Global Install

```bash
npm install -g recon-mcp

# Then use anywhere
recon index
recon serve
```

### From Source

```bash
git clone https://github.com/jhm1909/recon.git
cd recon
npm install
npm run build
```

Requires Node.js >= 20. Tree-sitter grammars for all supported languages are installed as npm dependencies. Kotlin and Swift grammars are optional (`npm install tree-sitter-kotlin tree-sitter-swift`).

## Usage

### CLI Commands

```bash
# Index the codebase (incremental by default)
npx recon index

# Force full re-index
npx recon index --force

# Index as a named repo (multi-repo support)
npx recon index --repo my-backend

# Index with vector embeddings for semantic search
npx recon index --embeddings

# Show index status
npx recon status

# Show status for a specific repo
npx recon status --repo my-backend

# Start MCP server on stdio (auto-indexes if needed)
npx recon-mcp serve

# Start without auto-indexing (use existing index)
npx recon-mcp serve --no-index

# Start MCP server for a specific repo only
npx recon-mcp serve --repo my-backend

# Start HTTP REST API server instead of MCP
npx recon-mcp serve --http

# Start HTTP REST API on a custom port (default: 3100)
npx recon-mcp serve --http --port 8080

# Delete index
npx recon-mcp clean

# Delete index for a specific repo only
npx recon-mcp clean --repo my-backend
```

> **Auto-index:** `serve` automatically checks if the index exists and is up-to-date with the current Git commit. If not, it runs `index` automatically before starting. Use `--no-index` to skip this check.

### MCP Integration

Add to your AI agent's MCP config to give it code intelligence:

**Claude Code** (`.claude/mcp.json`):

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

**Cursor** (`.cursor/mcp.json`):

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

**Antigravity** (`mcp_config.json`):

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

> **Server Instructions:** Recon includes built-in MCP instructions that are automatically injected into the AI agent's system prompt. The agent will know when to use `recon_impact` before editing, `recon_context` for exploration, etc. — no manual configuration needed.
```

## Multi-Repo Support

Recon can index and serve multiple repositories from a single `.recon/` directory:

```bash
# Index different repos
cd /path/to/backend && npx recon index --repo backend
cd /path/to/frontend && npx recon index --repo frontend

# Serve all repos (merged graph)
npx recon serve

# Or serve a single repo
npx recon serve --repo backend
```

When serving multiple repos, all MCP tools accept an optional `repo` parameter to filter results to a specific repository. Use `recon_list_repos` to discover which repos are indexed.

Per-repo indices are stored under `.recon/repos/{repoName}/`. Legacy single-repo indices (without `--repo`) continue to work unchanged.

## Community Detection

After indexing, Recon automatically detects code communities using the **Label Propagation Algorithm (LPA)**. Densely connected symbols are clustered into modules, giving agents architectural awareness beyond package boundaries.

- Each non-structural node (functions, structs, classes, etc.) gets a `community` label
- Communities are named after the most common package in each cluster
- `recon_context` shows which community a symbol belongs to
- `recon_impact` lists affected communities in the risk summary for cross-module awareness

Community detection runs automatically during indexing — no configuration needed.

## Tool Reference

All tools accept an optional `repo` parameter to filter by repository when using multi-repo indexing.

### recon_packages

List all packages (Go) and modules (TypeScript) with dependency relationships.

| Parameter | Type | Description |
|-----------|------|-------------|
| `language` | `"go" \| "typescript" \| "all"` | Filter by language (default: `"all"`) |
| `repo` | `string` | Filter by repo name |

### recon_query

Search the knowledge graph for symbols by name or pattern. Uses BM25 ranked search with automatic camelCase/snake_case tokenization — `"AuthMiddle"` finds `AuthMiddleware`, and exact names rank highest. Falls back to substring matching when BM25 returns no results. Enable `semantic: true` for hybrid BM25 + vector search with Reciprocal Rank Fusion (requires `--embeddings` during indexing).

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | `string` | **Required.** Name or substring to search (case-insensitive) |
| `type` | `string` | Filter: `Function`, `Method`, `Struct`, `Interface`, `Component`, `Type`, `Package`, `Class`, `Enum`, `Trait` |
| `package` | `string` | Filter by package path substring |
| `language` | `"go" \| "typescript" \| "python" \| "rust" \| "java" \| "c" \| "cpp"` | Filter by language |
| `semantic` | `boolean` | Use hybrid BM25 + vector search (default: `false`) |
| `limit` | `number` | Max results (default: 20) |
| `repo` | `string` | Filter by repo name |

### recon_context

360-degree view of a single symbol — callers, callees, imports, methods, implementations, and community membership.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | **Required.** Symbol name (e.g., `"Button"`, `"Handler.GetGuild"`) |
| `file` | `string` | Disambiguate when multiple symbols share a name |
| `includeSource` | `boolean` | Include source code (default: `false`) |
| `repo` | `string` | Filter by repo name |

### recon_impact

Blast radius analysis — what breaks if you change a symbol. Includes affected communities in the risk summary.

| Parameter | Type | Description |
|-----------|------|-------------|
| `target` | `string` | **Required.** Symbol to analyze |
| `direction` | `"upstream" \| "downstream"` | **Required.** Callers or callees |
| `maxDepth` | `number` | Traversal depth (default: 3) |
| `includeTests` | `boolean` | Include test files (default: `false`) |
| `relationTypes` | `string[]` | Filter edges: `CALLS`, `IMPORTS`, `HAS_METHOD`, `IMPLEMENTS`, `USES_COMPONENT`, `CALLS_API`, `EXTENDS` |
| `minConfidence` | `number` | Confidence threshold 0.0-1.0 (default: 0.0) |
| `file` | `string` | Disambiguate by file path substring |
| `repo` | `string` | Filter by repo name |

**Risk levels:** LOW (0-2 d1), MEDIUM (3-9), HIGH (10-19), CRITICAL (20+ or cross-app)

### recon_detect_changes

Map git diff to affected symbols and trace blast radius.

| Parameter | Type | Description |
|-----------|------|-------------|
| `scope` | `"unstaged" \| "staged" \| "all" \| "branch"` | What to analyze (default: `"all"`) |
| `base` | `string` | Base branch for `"branch"` scope (default: `"main"`) |
| `repo` | `string` | Filter by repo name |

### recon_api_map

Cross-language API route map — endpoint -> Go handler -> TypeScript consumers.

| Parameter | Type | Description |
|-----------|------|-------------|
| `method` | `string` | Filter by HTTP method |
| `pattern` | `string` | Filter by URL pattern substring |
| `handler` | `string` | Filter by handler name substring |
| `repo` | `string` | Filter by repo name |

### recon_rename

Safe multi-file rename using the knowledge graph. Traces callers, importers, method owners, and component users to generate a confidence-tagged edit plan. Safer than find-and-replace because it understands the call graph.

| Parameter | Type | Description |
|-----------|------|-------------|
| `symbol_name` | `string` | **Required.** Current name of the symbol |
| `new_name` | `string` | **Required.** New name for the symbol |
| `file` | `string` | Disambiguate when multiple symbols share a name |
| `dry_run` | `boolean` | Preview edits without applying (default: `true`) |
| `repo` | `string` | Filter by repo name |

Each edit is tagged with a confidence level:
- **`graph`** — found via knowledge graph relationship (high confidence, safe to accept)
- **`text_search`** — found via name matching (lower confidence, review carefully)

**Usage:** Run with `dry_run: true` first (default) to preview the edit plan, then `dry_run: false` to apply.

### recon_query_graph

Execute structural queries against the knowledge graph using a simplified Cypher-like syntax. Returns results as a markdown table.

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | `string` | **Required.** Cypher-like query (`MATCH...WHERE...RETURN...LIMIT`) |
| `limit` | `number` | Max rows to return (default: 50) |
| `repo` | `string` | Filter by repo name |

**Supported syntax:**

```cypher
-- Find all classes
MATCH (c:Class) RETURN c.name, c.file

-- Find callers of a function
MATCH (a)-[:CALLS]->(b:Function) WHERE b.name = 'main' RETURN a.name, a.file

-- Find methods of a struct
MATCH (s:Struct)-[:HAS_METHOD]->(m:Method) WHERE s.name = 'Config' RETURN m.name, m.file

-- Find class inheritance
MATCH (child:Class)-[:EXTENDS]->(parent:Class) RETURN child.name, parent.name

-- Find exported functions in a package
MATCH (f:Function) WHERE f.package CONTAINS 'auth' AND f.exported = 'true' RETURN f.name, f.file

-- Find interface implementations
MATCH (s:Struct)-[:IMPLEMENTS]->(i:Interface) RETURN s.name, i.name
```

**Node types:** `Package`, `File`, `Function`, `Method`, `Struct`, `Interface`, `Module`, `Component`, `Type`, `Class`, `Enum`, `Trait`

**Edge types:** `CONTAINS`, `DEFINES`, `CALLS`, `IMPORTS`, `HAS_METHOD`, `IMPLEMENTS`, `USES_COMPONENT`, `CALLS_API`, `EXTENDS`

**WHERE operators:** `=`, `<>`, `CONTAINS`, `STARTS WITH` (all case-insensitive)

**Node properties:** `id`, `type`, `name`, `file`, `startLine`, `endLine`, `language`, `package`, `exported`, `repo`, `community`

### recon_list_repos

List all indexed repositories with their stats.

| Parameter | Type | Description |
|-----------|------|-------------|
| *(none)* | | Lists all repos with node/relationship counts, git info, and index time |

### recon_processes

Detect execution flows by tracing call chains from entry points (HTTP handlers, exported functions, root nodes). Returns processes sorted by complexity.

| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | `number` | Max processes to return (default: 20) |
| `filter` | `string` | Filter by process name substring |
| `repo` | `string` | Filter by repo name |

## MCP Resources

Recon exposes structured data via `recon://` URIs that MCP clients can read directly.

| Resource | URI | Description |
|----------|-----|-------------|
| Package Map | `recon://packages` | All packages/modules with dependency counts |
| Index Stats | `recon://stats` | Node and relationship counts by type and language |
| Symbol Detail | `recon://symbol/{name}` | Symbol definition, callers, callees, relationships |
| File Symbols | `recon://file/{path}` | All symbols in a file with types and line ranges |
| Process Trace | `recon://process/{name}` | Execution flow trace from entry point through call chain |

**Example:** An agent can `READ recon://stats` to get an overview of the indexed codebase, `READ recon://symbol/AuthMiddleware` to see all callers and callees, or `READ recon://process/HandleLogin` to trace an execution flow — all without making a tool call.

## Search

`recon_query` uses a standalone BM25 ranking algorithm for relevance-scored search:

- **Tokenizer** splits camelCase, PascalCase, snake_case, and digit boundaries (`base64Decode` → `["base", "64", "decode"]`)
- **Name boost** — symbol names are weighted 3x higher than file paths and packages
- **IDF scoring** — rare terms rank higher than common ones
- **Lazy initialization** — the BM25 index is built on first query and cached; invalidated when the graph changes
- **Fallback** — when BM25 returns no results, falls back to case-insensitive substring matching

The search index is persisted to `.recon/search.json` during indexing for fast cold starts.

### Hybrid Semantic Search

When indexed with `--embeddings`, `recon_query` supports hybrid search combining BM25 keyword ranking with vector similarity:

- **Model:** `Xenova/all-MiniLM-L6-v2` (384-dimensional embeddings via `@huggingface/transformers`)
- **Fusion:** Reciprocal Rank Fusion (RRF) merges BM25 and vector results with `score = 1/(k + rank)`, k=60
- **Usage:** Pass `semantic: true` to `recon_query` to activate hybrid mode
- **Storage:** Embeddings persisted to `.recon/embeddings.json`

Install `@huggingface/transformers` (listed as optional dependency) for semantic search support. The model is downloaded on first use.

## Incremental Indexing

Files are hashed with SHA-256. On re-index, only changed files are re-analyzed:

- **TypeScript**: per-file granularity — only re-parse changed `.ts`/`.tsx` files
- **Tree-sitter languages**: per-file granularity — only re-parse changed source files
- Unchanged symbols are carried over from the previous index
- `serve` auto-detects stale indexes by comparing Git commit hashes

Force full re-index with `--force` if the graph seems stale.

## Graph Schema

### Node Types

| Type | ID Pattern | Language |
|------|-----------|----------|
| Package | `go:pkg:{importPath}` | Go |
| File | `go:file:{path}` / `ts:file:{path}` | Both |
| Function | `go:func:{pkg}.{name}` / `ts:func:{path}:{name}` | Both |
| Method | `go:method:{pkg}.{recv}.{name}` | Go |
| Struct | `go:struct:{pkg}.{name}` | Go |
| Interface | `go:iface:{pkg}.{name}` / `ts:iface:{path}:{name}` | Both |
| Component | `ts:comp:{path}:{name}` | TS |
| Type | `ts:type:{path}:{name}` | TS |
| Class | `py:class:{path}:{name}:{line}` | Python, Java, C++, Ruby, PHP, C#, Kotlin, Swift |
| Enum | `rs:enum:{path}:{name}:{line}` | Rust, Java, C, C++, C#, Kotlin, Swift |
| Trait | `rs:trait:{path}:{name}:{line}` | Rust |
| Module | `py:mod:{path}:{name}:{line}` | Python |

### Node Properties

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Unique node identifier |
| `type` | `NodeType` | One of the node types above |
| `name` | `string` | Symbol name |
| `file` | `string` | Source file path |
| `startLine` | `number` | Start line in file |
| `endLine` | `number` | End line in file |
| `language` | `Language` | Source language |
| `package` | `string` | Package/module path |
| `exported` | `boolean` | Whether the symbol is exported |
| `repo` | `string?` | Repository name (multi-repo) |
| `community` | `string?` | Community/cluster label (auto-detected) |

### Relationship Types

| Type | Meaning | Confidence |
|------|---------|------------|
| CONTAINS | Package/Module -> File | 1.0 |
| DEFINES | File -> Symbol | 1.0 |
| CALLS | Function -> Function | 0.5-1.0 |
| IMPORTS | Package -> Package / File -> File | 1.0 |
| HAS_METHOD | Struct/Class -> Method | 1.0 |
| IMPLEMENTS | Struct -> Interface / Class -> Trait | 0.8-0.9 |
| EXTENDS | Class -> Class (inheritance) | 0.9 |
| USES_COMPONENT | Component -> Component (JSX) | 0.9 |
| CALLS_API | TS Function -> Go Handler (cross-language) | 0.85-0.95 |

## Testing

```bash
npm test           # Run all tests
npx vitest --watch # Watch mode
```

355 tests covering:

| Suite | Tests | What's covered |
|-------|-------|----------------|
| `graph.test.ts` | 23 | KnowledgeGraph API — add, query, remove, serialize |
| `handlers.test.ts` | 30 | MCP tool dispatch with 9-node mock graph |
| `search.test.ts` | 27 | BM25 tokenizer, ranking, serialization |
| `rename.test.ts` | 28 | Graph-aware rename planning, disambiguation, formatting |
| `resources.test.ts` | 35 | Resource URI parsing, all 5 resource types |
| `tree-sitter.test.ts` | 58 | Multi-language extraction, graph construction, cross-language consistency |
| `query.test.ts` | 47 | Cypher parser, query execution, markdown formatting, error handling |
| `multi-repo.test.ts` | 16 | Multi-repo storage, filtering, recon_list_repos |
| `community.test.ts` | 13 | Label propagation clustering, community stats, handler integration |
| `embeddings.test.ts` | 39 | Vector store, RRF fusion, hybrid search, text generation |
| `process.test.ts` | 21 | Execution flow detection, BFS walk, cycles, cross-language flows |
| `http.test.ts` | 18 | HTTP REST API routes, tool execution, resources, CORS |

## HTTP REST API

As an alternative to the MCP stdio transport, Recon can serve the same tools and resources over HTTP:

```bash
npx recon serve --http              # Listen on :3100
npx recon serve --http --port 8080  # Custom port
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check + index stats (node/relationship counts) |
| `GET` | `/api/tools` | List all available tools with schemas |
| `POST` | `/api/tools/:name` | Execute a tool (body = JSON params) |
| `GET` | `/api/resources` | List MCP resources + templates |
| `GET` | `/api/resources/read?uri=...` | Read a resource by URI |

### Examples

```bash
# Health check
curl http://localhost:3100/api/health

# Search for a symbol
curl -X POST http://localhost:3100/api/tools/recon_query \
  -H 'Content-Type: application/json' \
  -d '{"query": "AuthMiddleware"}'

# Read a resource
curl 'http://localhost:3100/api/resources/read?uri=recon://symbol/AuthMiddleware'
```

CORS is enabled by default for browser-based clients.

## AI Agent Instructions

Recon includes built-in [MCP server instructions](https://modelcontextprotocol.io/docs/concepts/server-instructions) that are automatically injected into the AI agent's system prompt when the agent connects. These instructions teach agents:

- **When to use Recon** vs built-in tools (grep, view_file, etc.)
- **Critical rules** — always check blast radius before editing exported functions
- **Workflow patterns** — safe modification, codebase exploration, rename, pre-commit review
- **Advanced queries** — Cypher-like graph queries for structural analysis

This means agents will proactively use `recon_impact` before editing shared code, use `recon_context` instead of grep for relationship queries, and use `recon_rename` for safe multi-file renames — all without any manual prompting.

See [`src/mcp/instructions.ts`](src/mcp/instructions.ts) for the full instructions text.

## License

[MIT](LICENSE)
