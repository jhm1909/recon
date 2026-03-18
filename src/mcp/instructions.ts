/**
 * MCP Server Instructions
 *
 * Detailed instructions injected into the AI agent's system prompt
 * when connecting to the Recon MCP server. Guides agents on WHEN
 * and HOW to use Recon tools vs built-in tools.
 */

export const RECON_INSTRUCTIONS = `
# Recon — Code Intelligence MCP Server

You have access to Recon, a code intelligence engine that builds a knowledge graph
of the codebase. Recon understands relationships between functions, types, imports,
and call chains across all languages in the project.

## CRITICAL RULES

1. **BEFORE modifying any exported function or shared type:**
   → ALWAYS call recon_impact({target: "<name>", direction: "upstream"}) first
   → Review d=1 items (WILL BREAK) before editing
   → If risk is HIGH or CRITICAL, warn the user before proceeding

2. **When exploring an unfamiliar codebase or answering "how does X work?":**
   → Start with recon_packages() for architecture overview
   → Then recon_query({query: "<concept>"}) to find relevant symbols
   → Then recon_context({name: "<symbol>"}) for 360° dependency view
   → This gives you callers, callees, imports — grep cannot do this

3. **BEFORE committing changes:**
   → Call recon_detect_changes() to understand blast radius
   → Review affected symbols and risk level
   → Report risk to user if MEDIUM or higher

4. **When the user asks to rename a symbol:**
   → Use recon_rename() instead of manual find-and-replace
   → It uses the call graph for accuracy (safer than text search)
   → Always dry_run: true first, then apply after review

## WHEN TO USE RECON vs BUILT-IN TOOLS

| Task | Use Recon | Use Built-in |
|---|---|---|
| "What calls this function?" | ✅ recon_context | ❌ grep misses indirect calls |
| "What breaks if I change X?" | ✅ recon_impact | ❌ no built-in equivalent |
| "Find function by name" | ✅ recon_query (structured) | ✅ grep_search (text) — both OK |
| "Show file contents" | ❌ | ✅ view_file |
| "Read specific lines" | ❌ | ✅ view_file |
| "Rename across files" | ✅ recon_rename | ❌ find-replace misses context |
| "Trace execution flow" | ✅ recon_processes | ❌ no built-in equivalent |
| "Architecture overview" | ✅ recon_packages | ❌ list_dir only shows files |

## WORKFLOW PATTERNS

### Pattern A: Safe Code Modification
recon_impact({target: "X", direction: "upstream"})  → Check blast radius
recon_context({name: "X"})                          → Understand full context
[Make changes]
recon_detect_changes()                              → Verify impact

### Pattern B: Codebase Exploration
recon_packages()                     → Architecture overview
recon_query({query: "<concept>"})    → Find relevant symbols
recon_context({name: "<symbol>"})    → Deep-dive with relationships

### Pattern C: Safe Rename
recon_rename({symbol_name: "old", new_name: "new", dry_run: true})  → Preview
[Review plan]
recon_rename({symbol_name: "old", new_name: "new", dry_run: false}) → Apply
recon_detect_changes()                                               → Verify

### Pattern D: Pre-Commit Review
recon_detect_changes({scope: "staged"})  → What do staged changes affect?
recon_context({name: "<risky_symbol>"})  → Deep-dive on high-risk items

### Pattern E: Monitor Watcher
recon_watcher_status()  → Check if file watcher is active and healthy

### Pattern F: Quick Symbol Lookup
recon_augment({pattern: "<name>"})  → Rapid context: callers, callees, community

## ADVANCED QUERIES

For complex structural questions, use recon_query_graph with Cypher-like syntax:
- Find all exported functions: MATCH (f:Function) WHERE f.exported = 'true' RETURN f.name, f.file
- Find callers of a function: MATCH (a)-[:CALLS]->(b) WHERE b.name = 'X' RETURN a.name, a.file
- Find class hierarchy: MATCH (c)-[:EXTENDS]->(p) RETURN c.name, p.name
- Find interfaces with no implementations: MATCH (i:Interface) WHERE NOT (i)<-[:IMPLEMENTS]-() RETURN i.name

## RESOURCES (lightweight reads, ~100-500 tokens)

- recon://packages — Package/module dependency map
- recon://stats — Index statistics and health check
- recon://process/{name} — Step-by-step execution trace of a flow
`.trim();
