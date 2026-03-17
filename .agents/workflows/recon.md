---
description: Use Recon code intelligence tools for safe code modification and codebase exploration
---

# Recon Code Intelligence Workflow

Recon MCP tools are available for understanding code relationships, checking blast radius, and safe renaming.

## Before Modifying Exported Functions

// turbo
1. Run `recon_impact({target: "<function_name>", direction: "upstream"})` to check blast radius
2. Review d=1 items (WILL BREAK) — warn user if risk is HIGH
3. Use `recon_context({name: "<function_name>"})` for full dependency view
4. Make changes
5. Run `recon_detect_changes()` to verify impact

## Exploring Unfamiliar Code

1. `recon_packages()` — architecture overview
2. `recon_query({query: "<concept>"})` — find relevant symbols
3. `recon_context({name: "<symbol>"})` — deep-dive with callers/callees

## Safe Rename

1. `recon_rename({symbol_name: "old", new_name: "new", dry_run: true})` — preview
2. Review edit plan
3. `recon_rename({symbol_name: "old", new_name: "new", dry_run: false})` — apply
4. `recon_detect_changes()` — verify

## When to Use Recon vs grep_search

- **"What calls X?"** → `recon_context` (grep misses indirect calls)
- **"What breaks if I change X?"** → `recon_impact` (no grep equivalent)
- **"Find function by name"** → both OK, Recon gives structured results
- **"Rename across files"** → `recon_rename` (safer than find-replace)
- **"Trace execution flow"** → `recon_processes` (no grep equivalent)
