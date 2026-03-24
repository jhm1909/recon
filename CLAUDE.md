# Recon — Code Intelligence Engine

## Project Overview

Recon is a lightweight code intelligence engine that builds a knowledge graph of codebases (13 languages via tree-sitter + TypeScript Compiler API) and exposes it via MCP (Model Context Protocol). It provides 14 tools, 3 prompts, and 5 resources for dependency mapping, blast radius analysis, safe rename, execution flow tracing, and graph queries.

## Build & Run

```bash
npm install
npm run build          # TypeScript → dist/
npx recon index        # Index a codebase
npx recon serve        # Start MCP server on stdio
```

## Architecture

- `src/analyzers/` — Go AST analysis, TypeScript compiler API analysis, cross-language API matching
- `src/graph/` — In-memory knowledge graph (`KnowledgeGraph` class with Map + adjacency index)
- `src/mcp/` — MCP server (stdio), tool definitions (`RECON_TOOLS`), tool handlers, next-step hints
- `src/storage/` — JSON serialization to `.recon/` directory (graph.json + meta.json)
- `src/cli/` — Commander-based CLI with `index`, `serve`, `status`, `clean` commands

## Key Patterns

- Node IDs use namespaced prefixes: `go:func:`, `ts:comp:`, etc.
- Incremental indexing via SHA-256 file hashing — unchanged files are skipped
- Cross-language edges link TypeScript API calls to Go HTTP handlers
- Every tool response includes a next-step hint guiding the agent to the logical next action

## When Modifying

- Tool definitions live in `src/mcp/tools.ts` — update both the definition and the handler in `src/mcp/handlers.ts`
- The `RECON_TOOLS` array is the single source of truth for tool schemas
- Graph types are in `src/graph/types.ts` — changing Node/Relationship interfaces affects serialization
- Storage format is plain JSON — no migrations, just bump version in IndexMeta if schema changes

## Do Not

- Do not add dependencies without good reason — the project is intentionally lightweight
- Do not modify the MCP protocol layer — use the `@modelcontextprotocol/sdk` as-is
- Do not hardcode project-specific paths — Recon should work with any Go + TypeScript codebase
