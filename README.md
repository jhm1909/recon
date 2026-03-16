# Recon

Lightweight code intelligence engine for AI agents. Builds a knowledge graph of **Go, TypeScript, Python, Rust, Java, C, and C++** codebases, tracks cross-language API calls, and exposes 8 tools + 4 resources via [Model Context Protocol](https://modelcontextprotocol.io/).

> Give your AI agent architectural awareness — dependency mapping, blast radius analysis, safe renames, Cypher-like graph queries, and call graph traversal without reading every file.

---

## Why Recon?

AI coding agents are blind to architecture. They grep, they guess, they break things. Recon fixes this by indexing your codebase into a knowledge graph that agents can query through MCP:

- **7 language support** — Go, TypeScript, Python, Rust, Java, C, C++ via tree-sitter + dedicated analyzers
- **Blast radius before editing** — know what breaks before you touch it
- **Graph-aware rename** — safe multi-file renames using the call graph, not find-and-replace
- **Cypher-like graph queries** — structural queries with `MATCH`/`WHERE`/`RETURN` syntax
- **BM25 ranked search** — keyword search with camelCase/snake_case tokenization and relevance scoring
- **Cross-language tracing** — follow API calls from TypeScript frontend to Go backend
- **MCP Resources** — structured data via `recon://` URIs for packages, symbols, files, and stats
- **Incremental indexing** — sub-second re-index on file changes
- **Zero config** — point it at a repo, run `npx recon index`, done

## Supported Languages

| Language | Analyzer | What's indexed |
|----------|----------|---------------|
| **Go** | Dedicated (AST CLI) | Packages, functions, methods, structs, interfaces, call graph, imports |
| **TypeScript** | Dedicated (Compiler API) | Modules, components, functions, types, JSX usage, imports |
| **Python** | Tree-sitter | Classes, functions, methods, inheritance, imports, calls |
| **Rust** | Tree-sitter | Structs, enums, traits, functions, impl blocks, use imports, calls |
| **Java** | Tree-sitter | Classes, interfaces, enums, methods, imports, calls |
| **C** | Tree-sitter | Functions, structs, enums, macros, #include imports, calls |
| **C++** | Tree-sitter | Classes, structs, namespaces, enums, functions, inheritance, calls |
| **Cross-language** | Route matching | HTTP API routes mapped from Go handlers to TypeScript consumers |

## Architecture

```
├── bin/recon                # CLI entry point
├── src/
│   ├── analyzers/
│   │   ├── go-analyzer.ts   # Go packages + AST symbol extraction
│   │   ├── ts-analyzer.ts   # TypeScript/React component extraction
│   │   ├── cross-language.ts # Go route ↔ TS API call matching
│   │   ├── tree-sitter/     # Multi-language tree-sitter analyzer
│   │   │   ├── parser.ts    #   Grammar loading + language detection
│   │   │   ├── queries.ts   #   S-expression queries (5 languages)
│   │   │   ├── extractor.ts #   Symbol/call/import/heritage extraction
│   │   │   ├── analyzer.ts  #   File walker + incremental indexing
│   │   │   └── index.ts     #   Module barrel
│   │   └── types.ts         # Shared analyzer interfaces
│   ├── graph/
│   │   ├── graph.ts         # KnowledgeGraph — in-memory Map + adjacency index
│   │   └── types.ts         # Node, Relationship, enums
│   ├── mcp/
│   │   ├── server.ts        # MCP server (stdio transport)
│   │   ├── tools.ts         # Tool definitions (JSON Schema)
│   │   ├── handlers.ts      # Tool dispatch + query logic
│   │   ├── hints.ts         # Next-step hints appended to responses
│   │   ├── rename.ts        # Graph-aware multi-file rename
│   │   └── resources.ts     # MCP Resources (recon:// URIs)
│   ├── query/
│   │   ├── parser.ts        # Simplified Cypher DSL parser
│   │   ├── executor.ts      # Query execution + markdown formatting
│   │   └── index.ts         # Module barrel
│   ├── search/
│   │   ├── bm25.ts          # Standalone BM25 search index
│   │   └── index.ts         # Module barrel
│   ├── storage/
│   │   ├── store.ts         # JSON file I/O (.recon/)
│   │   └── types.ts         # IndexMeta, IndexStats
│   ├── utils/
│   │   └── hash.ts          # SHA-256 file hashing
│   └── cli/
│       ├── index.ts         # Commander CLI setup
│       └── commands.ts      # index, serve, status, clean commands
└── analyzer/                # Go AST CLI (built automatically)
    └── main.go
```

### Data Flow

```
  go list → Go packages      ─┐
  Go AST CLI → symbols/calls  ├─→ KnowledgeGraph ─→ .recon/graph.json
  TS Compiler API → components ├─→   (in-memory)  ─→ .recon/meta.json
  tree-sitter → 5 languages   ├─→   + BM25 Index  ─→ .recon/search.json
  router.go → API routes      ─┘
                                         │
                                    MCP Server (stdio)
                                    ┌────┴────┐
                                 8 Tools   4 Resources
                                    │         │
                              ┌─────┼─────┐   recon://packages
                              │     │     │   recon://symbol/{name}
                         Claude   Cursor  …   recon://file/{path}
                          Code            …   recon://stats
```

## Installation

```bash
git clone https://github.com/jhm1909/recon.git
cd recon
npm install
npm run build
```

Requires Node.js >= 20 and Go (for AST analysis). The Go AST analyzer binary is built automatically on first index. Tree-sitter grammars for Python, Rust, Java, C, and C++ are installed as npm dependencies.

## Usage

### CLI Commands

```bash
# Index the codebase (incremental by default)
npx recon index

# Force full re-index
npx recon index --force

# Show index status
npx recon status

# Start MCP server on stdio
npx recon serve

# Delete index
npx recon clean
```

### MCP Integration

Add to your MCP client config (e.g., `.claude/mcp.json`):

```json
{
  "mcpServers": {
    "recon": {
      "command": "node",
      "args": ["/path/to/recon/dist/cli/index.js", "serve"]
    }
  }
}
```

## Tool Reference

### recon_packages

List all packages (Go) and modules (TypeScript) with dependency relationships.

| Parameter | Type | Description |
|-----------|------|-------------|
| `language` | `"go" \| "typescript" \| "all"` | Filter by language (default: `"all"`) |

### recon_query

Search the knowledge graph for symbols by name or pattern. Uses BM25 ranked search with automatic camelCase/snake_case tokenization — `"AuthMiddle"` finds `AuthMiddleware`, and exact names rank highest. Falls back to substring matching when BM25 returns no results.

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | `string` | **Required.** Name or substring to search (case-insensitive) |
| `type` | `string` | Filter: `Function`, `Method`, `Struct`, `Interface`, `Component`, `Type`, `Package`, `Class`, `Enum`, `Trait` |
| `package` | `string` | Filter by package path substring |
| `language` | `"go" \| "typescript" \| "python" \| "rust" \| "java" \| "c" \| "cpp"` | Filter by language |
| `limit` | `number` | Max results (default: 20) |

### recon_context

360-degree view of a single symbol — callers, callees, imports, methods, implementations.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | **Required.** Symbol name (e.g., `"Button"`, `"Handler.GetGuild"`) |
| `file` | `string` | Disambiguate when multiple symbols share a name |
| `includeSource` | `boolean` | Include source code (default: `false`) |

### recon_impact

Blast radius analysis — what breaks if you change a symbol.

| Parameter | Type | Description |
|-----------|------|-------------|
| `target` | `string` | **Required.** Symbol to analyze |
| `direction` | `"upstream" \| "downstream"` | **Required.** Callers or callees |
| `maxDepth` | `number` | Traversal depth (default: 3) |
| `includeTests` | `boolean` | Include test files (default: `false`) |
| `relationTypes` | `string[]` | Filter edges: `CALLS`, `IMPORTS`, `HAS_METHOD`, `IMPLEMENTS`, `USES_COMPONENT`, `CALLS_API`, `EXTENDS` |
| `minConfidence` | `number` | Confidence threshold 0.0-1.0 (default: 0.0) |
| `file` | `string` | Disambiguate by file path substring |

**Risk levels:** LOW (0-2 d1), MEDIUM (3-9), HIGH (10-19), CRITICAL (20+ or cross-app)

### recon_detect_changes

Map git diff to affected symbols and trace blast radius.

| Parameter | Type | Description |
|-----------|------|-------------|
| `scope` | `"unstaged" \| "staged" \| "all" \| "branch"` | What to analyze (default: `"all"`) |
| `base` | `string` | Base branch for `"branch"` scope (default: `"main"`) |

### recon_api_map

Cross-language API route map — endpoint -> Go handler -> TypeScript consumers.

| Parameter | Type | Description |
|-----------|------|-------------|
| `method` | `string` | Filter by HTTP method |
| `pattern` | `string` | Filter by URL pattern substring |
| `handler` | `string` | Filter by handler name substring |

### recon_rename

Safe multi-file rename using the knowledge graph. Traces callers, importers, method owners, and component users to generate a confidence-tagged edit plan. Safer than find-and-replace because it understands the call graph.

| Parameter | Type | Description |
|-----------|------|-------------|
| `symbol_name` | `string` | **Required.** Current name of the symbol |
| `new_name` | `string` | **Required.** New name for the symbol |
| `file` | `string` | Disambiguate when multiple symbols share a name |
| `dry_run` | `boolean` | Preview edits without applying (default: `true`) |

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

**Node properties:** `id`, `type`, `name`, `file`, `startLine`, `endLine`, `language`, `package`, `exported`

## MCP Resources

Recon exposes structured data via `recon://` URIs that MCP clients can read directly.

| Resource | URI | Description |
|----------|-----|-------------|
| Package Map | `recon://packages` | All packages/modules with dependency counts |
| Index Stats | `recon://stats` | Node and relationship counts by type and language |
| Symbol Detail | `recon://symbol/{name}` | Symbol definition, callers, callees, relationships |
| File Symbols | `recon://file/{path}` | All symbols in a file with types and line ranges |

**Example:** An agent can `READ recon://stats` to get an overview of the indexed codebase, or `READ recon://symbol/AuthMiddleware` to see all callers and callees without making a tool call.

## Search

`recon_query` uses a standalone BM25 ranking algorithm for relevance-scored search:

- **Tokenizer** splits camelCase, PascalCase, snake_case, and digit boundaries (`base64Decode` → `["base", "64", "decode"]`)
- **Name boost** — symbol names are weighted 3x higher than file paths and packages
- **IDF scoring** — rare terms rank higher than common ones
- **Lazy initialization** — the BM25 index is built on first query and cached; invalidated when the graph changes
- **Fallback** — when BM25 returns no results, falls back to case-insensitive substring matching

The search index is persisted to `.recon/search.json` during indexing for fast cold starts.

## Incremental Indexing

Files are hashed with SHA-256. On re-index, only changed files are re-analyzed:

- **Go**: per-package granularity — if any `.go` file in a package changed, re-analyze the whole package
- **TypeScript**: per-file granularity — only re-parse changed `.ts`/`.tsx` files
- **Tree-sitter languages**: per-file granularity — only re-parse changed source files
- Unchanged symbols are carried over from the previous index

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
| Class | `py:class:{path}:{name}:{line}` | Python, Java, C++ |
| Enum | `rs:enum:{path}:{name}:{line}` | Rust, Java, C, C++ |
| Trait | `rs:trait:{path}:{name}:{line}` | Rust |
| Module | `py:mod:{path}:{name}:{line}` | Python |

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

248 tests covering:

| Suite | Tests | What's covered |
|-------|-------|----------------|
| `graph.test.ts` | 23 | KnowledgeGraph API — add, query, remove, serialize |
| `handlers.test.ts` | 30 | MCP tool dispatch with 9-node mock graph |
| `search.test.ts` | 27 | BM25 tokenizer, ranking, serialization |
| `rename.test.ts` | 28 | Graph-aware rename planning, disambiguation, formatting |
| `resources.test.ts` | 35 | Resource URI parsing, all 4 resource types |
| `tree-sitter.test.ts` | 58 | Multi-language extraction, graph construction, cross-language consistency |
| `query.test.ts` | 47 | Cypher parser, query execution, markdown formatting, error handling |

## License

[MIT](LICENSE)
