# CodeMap

Lightweight code intelligence MCP server for the Hubdustry monorepo. Builds a knowledge graph of Go and TypeScript symbols, tracks cross-language API calls, and exposes 6 tools to AI agents via [Model Context Protocol](https://modelcontextprotocol.io/).

## Architecture

```
tools/codemap/
├── bin/codemap              # CLI entry point
├── src/
│   ├── analyzers/
│   │   ├── go-analyzer.ts   # Go packages + AST symbol extraction
│   │   ├── ts-analyzer.ts   # TypeScript/React component extraction
│   │   ├── cross-language.ts # Go route ↔ TS API call matching
│   │   └── types.ts         # Shared analyzer interfaces
│   ├── graph/
│   │   ├── graph.ts         # KnowledgeGraph — in-memory Map + adjacency index
│   │   └── types.ts         # Node, Relationship, enums
│   ├── mcp/
│   │   ├── server.ts        # MCP server (stdio transport)
│   │   ├── tools.ts         # Tool definitions (JSON Schema)
│   │   ├── handlers.ts      # Tool dispatch + query logic
│   │   └── hints.ts         # Next-step hints appended to responses
│   ├── storage/
│   │   ├── store.ts         # JSON file I/O (.codemap/)
│   │   └── types.ts         # IndexMeta, IndexStats
│   ├── utils/
│   │   └── hash.ts          # SHA-256 file hashing
│   └── cli/
│       ├── index.ts         # Commander CLI setup
│       └── commands.ts      # index, serve, status, clean commands
└── tools/ast-analyzer/      # Go AST CLI (built automatically)
    └── main.go
```

### Data Flow

```
  go list → Go packages      ─┐
  Go AST CLI → symbols/calls  ├─→ KnowledgeGraph ─→ .codemap/graph.json
  TS Compiler API → components ├─→   (in-memory)  ─→ .codemap/meta.json
  router.go → API routes      ─┘
                                         │
                                    MCP Server (stdio)
                                         │
                              ┌──────────┼──────────┐
                              │          │          │
                         Claude Code  Antigravity  Other MCP clients
```

## Installation

```bash
cd tools/codemap
npm install
npm run build
```

The Go AST analyzer binary is built automatically on first index.

## Usage

### CLI Commands

```bash
# Index the codebase (incremental by default)
npx codemap index

# Force full re-index
npx codemap index --force

# Show index status
npx codemap status

# Start MCP server on stdio
npx codemap serve

# Delete index
npx codemap clean
```

### MCP Integration

Add to `.claude/mcp.json` or equivalent:

```json
{
  "mcpServers": {
    "codemap": {
      "command": "node",
      "args": ["tools/codemap/dist/cli/index.js", "serve"]
    }
  }
}
```

## Tool Reference

### codemap_packages

List all packages (Go) and modules (TypeScript) with dependency relationships.

| Parameter | Type | Description |
|-----------|------|-------------|
| `language` | `"go" \| "typescript" \| "all"` | Filter by language (default: `"all"`) |

### codemap_query

Search the knowledge graph for symbols by name or pattern.

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | `string` | **Required.** Name or substring to search (case-insensitive) |
| `type` | `string` | Filter: `Function`, `Method`, `Struct`, `Interface`, `Component`, `Type`, `Package` |
| `package` | `string` | Filter by package path substring |
| `language` | `"go" \| "typescript"` | Filter by language |
| `limit` | `number` | Max results (default: 20) |

### codemap_context

360-degree view of a single symbol — callers, callees, imports, methods, implementations.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | **Required.** Symbol name (e.g., `"Button"`, `"Handler.GetGuild"`) |
| `file` | `string` | Disambiguate when multiple symbols share a name |
| `includeSource` | `boolean` | Include source code (default: `false`) |

### codemap_impact

Blast radius analysis — what breaks if you change a symbol.

| Parameter | Type | Description |
|-----------|------|-------------|
| `target` | `string` | **Required.** Symbol to analyze |
| `direction` | `"upstream" \| "downstream"` | **Required.** Callers or callees |
| `maxDepth` | `number` | Traversal depth (default: 3) |
| `includeTests` | `boolean` | Include test files (default: `false`) |
| `relationTypes` | `string[]` | Filter edges: `CALLS`, `IMPORTS`, `HAS_METHOD`, `IMPLEMENTS`, `USES_COMPONENT`, `CALLS_API` |
| `minConfidence` | `number` | Confidence threshold 0.0–1.0 (default: 0.0) |
| `file` | `string` | Disambiguate by file path substring |

**Risk levels:** LOW (0–2 d1), MEDIUM (3–9), HIGH (10–19), CRITICAL (20+ or cross-app)

### codemap_detect_changes

Map git diff to affected symbols and trace blast radius.

| Parameter | Type | Description |
|-----------|------|-------------|
| `scope` | `"unstaged" \| "staged" \| "all" \| "branch"` | What to analyze (default: `"all"`) |
| `base` | `string` | Base branch for `"branch"` scope (default: `"main"`) |

### codemap_api_map

Cross-language API route map — endpoint → Go handler → TypeScript consumers.

| Parameter | Type | Description |
|-----------|------|-------------|
| `method` | `string` | Filter by HTTP method |
| `pattern` | `string` | Filter by URL pattern substring |
| `handler` | `string` | Filter by handler name substring |

## Incremental Indexing

Files are hashed with SHA-256. On re-index, only changed files are re-analyzed:

- **Go**: per-package granularity — if any `.go` file in a package changed, re-analyze the whole package
- **TypeScript**: per-file granularity — only re-parse changed `.ts`/`.tsx` files
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

### Relationship Types

| Type | Meaning | Confidence |
|------|---------|------------|
| CONTAINS | Package/Module → File | 1.0 |
| DEFINES | File → Symbol | 1.0 |
| CALLS | Function → Function | 0.5–1.0 |
| IMPORTS | Package → Package / File → File | 1.0 |
| HAS_METHOD | Struct → Method | 1.0 |
| IMPLEMENTS | Struct → Interface | 0.8 |
| USES_COMPONENT | Component → Component (JSX) | 0.9 |
| CALLS_API | TS Function → Go Handler (cross-language) | 0.85–0.95 |

## Current Stats

```
Go packages:    78
Go symbols:     2,651
TS files:       388
TS symbols:     710
Relationships:  24,337
API routes:     191
Cross-lang edges: 28
Total nodes:    4,592
Index time:     ~34s (full), ~5s (incremental)
```
