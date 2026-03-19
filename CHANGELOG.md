# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [5.3.0] - 2026-03-19

### Added
- **Worker pool** for parallel tree-sitter parsing — `worker_threads` with round-robin distribution, auto-enabled for 100+ files (3-4× speedup on large repos)
- "How It Works" section in README — 7-step flow explanation
- Multi-project setup guide in README — separate servers vs multi-repo
- Auto-indexing documentation table in README

## [5.1.1] - 2026-03-18

### Fixed
- `typescript` moved from `devDependencies` to `dependencies` — fixes `ERR_MODULE_NOT_FOUND` crash on global install and `npx`

## [5.1.0] - 2026-03-18

### Added
- **MCP Prompts**: `detect_impact`, `generate_map`, `onboard` — guided workflows for AI agents
- **`recon_augment` tool** — compact context injection for AI search augmentation
- **Framework detection** — automatic entry point multipliers for 20+ frameworks (Next.js, Express, NestJS, Django, Go, Spring, Rust, etc.)
- **Staleness check** — auto-detect stale index by comparing git commit hashes
- **`AGENTS.md` generation** — auto-generated codebase guide in `.recon/`
- **Live search dropdown** — 200ms debounce, keyboard navigation (↑↓ Enter Esc), type badges
- **Dashboard premium upgrade** — dark theme, Graph + Processes + Impact tabs, graph legend, community coloring toggle
- 55 new tests: `framework-detection.test.ts` (27) and `augmentation.test.ts` (28)

### Changed
- Professional README rewrite with badges (npm, downloads, license, MCP, tests), feature grid, complete tool reference

## [5.0.2] - 2026-03-17

### Fixed
- Process tab parser — correct execution flow rendering

## [5.0.1] - 2026-03-16

### Added
- Initial public release on npm
- **11 MCP tools**: packages, impact, context, query, detect_changes, api_map, rename, query_graph, list_repos, processes, augment
- **5 MCP resources**: packages, stats, symbol, file, process (`recon://` URIs)
- **13 language support** via tree-sitter: Python, Rust, Java, C, C++, Ruby, PHP, C#, Kotlin, Swift, Go, TypeScript, cross-language
- **BM25 search** with camelCase/snake_case tokenization
- **Hybrid semantic search** — BM25 + vector embeddings (all-MiniLM-L6-v2) with RRF fusion
- **Cypher-like graph queries** — MATCH/WHERE/RETURN structural queries
- **Multi-repo support** — index and query multiple repos from single `.recon/`
- **Community detection** — label propagation clustering
- **Incremental indexing** — SHA-256 file hashing, only re-parse changed files
- **HTTP REST API** + interactive dashboard on `:3100`
- **Cross-language tracing** — Go route handlers ↔ TypeScript API consumers
- **Graph-aware rename** — safe multi-file renames with confidence tagging
- **MCP server instructions** — auto-injected into AI agent system prompts
- **410 tests** across 14 test suites
