/**
 * MCP Tool Definitions
 *
 * Defines tools exposed to AI agents via MCP protocol.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
      default?: unknown;
      items?: { type: string };
      enum?: string[];
    }>;
    required?: string[];
  };
}

export const RECON_TOOLS: ToolDefinition[] = [
  {
    name: 'recon_map',
    description: 'Architecture overview: tech stack, packages, entry points, health.\n\nWHEN: First time in a codebase, or need to recall architecture.\nNOT: You need details about a specific symbol (use recon_explain).\nTHEN: recon_find to locate specific symbols.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        repo: { type: 'string', description: 'Filter by repo name (multi-repo only)' },
      },
    },
  },
  {
    name: 'recon_find',
    description: 'Smart search: exact name, wildcard (*Handler), or natural language.\n\nWHEN: Looking for a symbol, function, class, or pattern.\nNOT: You already know the symbol name and need full context (use recon_explain).\nTHEN: recon_explain for details on a result.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Symbol name, pattern (*Handler), or natural language' },
        type: { type: 'string', description: 'Filter: Function, Class, Method, Struct, Interface, etc.' },
        language: { type: 'string', description: 'Filter by language' },
        package: { type: 'string', description: 'Filter by package' },
        limit: { type: 'number', description: 'Max results (default: 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'recon_explain',
    description: 'Full 360-degree context of a symbol: callers, callees, flows, cross-language links.\n\nWHEN: You need to understand a function/class before modifying it.\nNOT: You just need to read the source code (use Read tool).\nTHEN: recon_impact if you plan to change it.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Symbol name' },
        file: { type: 'string', description: 'File path to disambiguate if multiple matches' },
        depth: { type: 'number', description: 'Levels of callers/callees (default: 1)' },
        include_source: { type: 'boolean', description: 'Include source code snippet' },
      },
      required: ['name'],
    },
  },
  {
    name: 'recon_impact',
    description: 'Blast radius: what breaks if you change this symbol, including affected tests.\n\nWHEN: Before modifying any exported function or shared type.\nNOT: Just exploring (use recon_explain first).\nTHEN: Make the change, then recon_changes to verify.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        target: { type: 'string', description: 'Symbol name to analyze' },
        direction: { type: 'string', enum: ['upstream', 'downstream'], description: 'upstream = who calls this, downstream = what this calls (default: upstream)' },
        maxDepth: { type: 'number', description: 'Max traversal depth (default: 3)' },
        file: { type: 'string', description: 'File path to disambiguate' },
      },
      required: ['target'],
    },
  },
  {
    name: 'recon_changes',
    description: 'Git diff → affected symbols → risk assessment → affected tests.\n\nWHEN: Before commit, or reviewing a PR.\nNOT: No changes have been made yet.\nTHEN: Fix issues, then commit.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        scope: { type: 'string', enum: ['unstaged', 'staged', 'branch', 'commit'], description: 'What to analyze (default: unstaged)' },
        base: { type: 'string', description: 'Base branch for branch/commit scope' },
        include_diagram: { type: 'boolean', description: 'Include Mermaid diagram (default: false)' },
      },
    },
  },
  {
    name: 'recon_rename',
    description: 'Graph-aware safe rename across all files. Always dry_run first.\n\nWHEN: Renaming a symbol and want to catch all references.\nNOT: Simple text replacement in one file (use Edit tool).\nTHEN: Review plan, then run with dry_run: false.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Current symbol name' },
        new_name: { type: 'string', description: 'New name' },
        file: { type: 'string', description: 'File path to disambiguate' },
        dry_run: { type: 'boolean', description: 'Preview only (default: true)' },
      },
      required: ['symbol', 'new_name'],
    },
  },
  {
    name: 'recon_export',
    description: 'Generate Mermaid diagram of package/symbol/file relationships.\n\nWHEN: Need visual representation for documentation or understanding.\nNOT: Just need a list of packages (use recon_map).\nTHEN: Paste diagram in PR or docs.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        target: { type: 'string', description: 'Package or symbol name for focused view' },
        scope: { type: 'string', enum: ['package', 'symbol', 'file'], description: 'What to diagram' },
        depth: { type: 'number', description: 'Traversal depth (default: 2)' },
        direction: { type: 'string', enum: ['callers', 'callees', 'both'], description: 'Direction (default: both)' },
        limit: { type: 'number', description: 'Max nodes (default: 30)' },
      },
    },
  },
  {
    name: 'recon_rules',
    description: 'Code quality analysis via knowledge graph: dead code, circular deps, unused exports.\n\nWHEN: Reviewing code quality, cleaning up, or auditing architecture.\nNOT: Looking for a specific symbol (use recon_find).\nTHEN: recon_explain on flagged items for context.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        rule: { type: 'string', enum: ['dead_code', 'unused_exports', 'circular_deps', 'large_files', 'orphans'], description: 'Specific rule to check (omit to run all)' },
        package: { type: 'string', description: 'Filter by package' },
        language: { type: 'string', description: 'Filter by language' },
      },
    },
  },
];
