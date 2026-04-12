/**
 * MCP Server Instructions
 *
 * Compact instructions injected into the AI agent's system prompt
 * when connecting to the Recon MCP server. Guides agents on WHEN
 * and HOW to use Recon tools vs built-in tools.
 */

export const RECON_INSTRUCTIONS = `Recon — code intelligence for YOUR codebase.

RULES:
1. Before modifying exported symbols → recon_impact first
2. New to a codebase → recon_map first
3. Before commit/PR → recon_changes first

USE RECON (not grep) when:
- "What calls this?" → recon_explain
- "What breaks?" → recon_impact
- "Find X" → recon_find
- "Code smells?" → recon_rules

USE BUILT-IN (not Recon) when:
- Read file contents → Read tool
- Search text literally → Grep tool`;
