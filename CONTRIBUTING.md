# Contributing to Recon

Thanks for your interest in contributing! Here's how to get started.

## Getting Started

1. **Fork** the repository on GitHub
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/<your-username>/recon.git
   cd recon
   ```
3. **Install** dependencies:
   ```bash
   npm install
   ```
4. **Build** the project:
   ```bash
   npm run build
   ```

## Development Workflow

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feat/your-feature
   ```
2. Make your changes
3. Ensure the project builds:
   ```bash
   npm run build
   ```
4. Commit with a descriptive message:
   ```bash
   git commit -m "feat: add support for Python analysis"
   ```
5. Push to your fork and open a Pull Request

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new feature
- `fix:` — bug fix
- `refactor:` — code change that neither fixes a bug nor adds a feature
- `docs:` — documentation only
- `chore:` — build process, CI, tooling

## Project Structure

- `src/analyzers/` — Language-specific code analysis (TypeScript Compiler API, tree-sitter for 13 languages, cross-language)
- `src/graph/` — Knowledge graph, community detection, execution flow tracing
- `src/mcp/` — MCP server, 14 tool definitions, handlers, prompts, resources
- `src/search/` — BM25 search index, hybrid semantic search, vector store
- `src/query/` — Cypher-like query parser and executor
- `src/watcher/` — Live file watcher with surgical graph updates
- `src/export/` — Mermaid/DOT graph export
- `src/review/` — Graph-aware PR review
- `src/server/` — HTTP REST API + dashboard serving
- `src/storage/` — Index persistence (JSON file I/O)
- `src/cli/` — CLI commands (index, serve, status, clean, export, review)
- `src/dashboard/` — Interactive web dashboard (HTML/CSS/JS)

## Code Style

- TypeScript strict mode
- ES modules (`"type": "module"`)
- Uses **vitest** for testing — run `npm test` (459 tests across 17 suites)

## Reporting Issues

Open an issue on GitHub with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Node.js and Go versions
