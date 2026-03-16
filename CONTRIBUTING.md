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

- `src/analyzers/` — Language-specific code analysis (Go, TypeScript, cross-language)
- `src/graph/` — Knowledge graph data structure and types
- `src/mcp/` — MCP server, tool definitions, and handlers
- `src/storage/` — Index persistence (JSON file I/O)
- `src/cli/` — CLI commands (index, serve, status, clean)

## Code Style

- TypeScript strict mode
- ES modules (`"type": "module"`)
- No external test framework yet — contributions welcome

## Reporting Issues

Open an issue on GitHub with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Node.js and Go versions
