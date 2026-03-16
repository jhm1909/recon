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
    required: string[];
  };
}

const REPO_PROPERTY = {
  type: 'string',
  description: 'Filter by repo name (multi-repo). Omit to search across all indexed repos.',
} as const;

export const RECON_TOOLS: ToolDefinition[] = [
  {
    name: 'recon_packages',
    description: `List all packages (Go) and modules (TypeScript) with their dependency relationships. High-level architecture overview.

WHEN TO USE: First step when exploring the codebase. Understand which packages exist and how they depend on each other.
AFTER THIS: Use recon_impact() to check blast radius before editing a package.`,
    inputSchema: {
      type: 'object',
      properties: {
        language: {
          type: 'string',
          description: 'Filter by language: "go", "typescript", "all" (default: "all")',
          enum: ['go', 'typescript', 'all'],
          default: 'all',
        },
        repo: REPO_PROPERTY,
      },
      required: [],
    },
  },
  {
    name: 'recon_impact',
    description: `Analyze the blast radius of changing a code symbol. Returns affected symbols grouped by depth, plus risk assessment.

WHEN TO USE: Before making code changes — especially refactoring, renaming, or modifying shared code. Shows what would break.
AFTER THIS: Review d=1 items (WILL BREAK). Use recon_context({name}) on high-risk symbols.

Depth groups:
- d=1: WILL BREAK (direct callers/importers)
- d=2: LIKELY AFFECTED (indirect)
- d=3: MAY NEED TESTING (transitive)

Risk levels: LOW (0-2 d1), MEDIUM (3-9), HIGH (10-19), CRITICAL (20+ or cross-app)`,
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Name of function, method, struct, or component to analyze (e.g., "Handler.GetGuild", "Button", "Middleware")',
        },
        direction: {
          type: 'string',
          description: 'upstream = what depends on this (callers/importers); downstream = what this depends on (callees/imports)',
          enum: ['upstream', 'downstream'],
        },
        maxDepth: {
          type: 'number',
          description: 'Max relationship traversal depth (default: 3)',
          default: 3,
        },
        includeTests: {
          type: 'boolean',
          description: 'Include test files in results (default: false)',
          default: false,
        },
        relationTypes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by edge types: CALLS, IMPORTS, HAS_METHOD, IMPLEMENTS, USES_COMPONENT, CALLS_API (default: all)',
        },
        minConfidence: {
          type: 'number',
          description: 'Minimum confidence threshold 0.0-1.0 (default: 0.0)',
          default: 0,
        },
        file: {
          type: 'string',
          description: 'Filter target by file path (substring match) to disambiguate symbols with same name',
        },
        repo: REPO_PROPERTY,
      },
      required: ['target', 'direction'],
    },
  },
  {
    name: 'recon_context',
    description: `360-degree view of a single code symbol. Shows callers, callees, imports, methods, and implementation relationships.

WHEN TO USE: After recon_query or recon_impact to understand a specific symbol in depth. When you need to know all callers, callees, and dependencies.
AFTER THIS: Use recon_impact() if planning changes.`,
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Symbol name (e.g., "Middleware", "Button", "Handler.GetGuild")',
        },
        file: {
          type: 'string',
          description: 'File path to disambiguate when multiple symbols share the same name',
        },
        includeSource: {
          type: 'boolean',
          description: 'Include symbol source code in response (default: false)',
          default: false,
        },
        repo: REPO_PROPERTY,
      },
      required: ['name'],
    },
  },
  {
    name: 'recon_query',
    description: `Search the knowledge graph for symbols by name or pattern. Supports hybrid search (BM25 + semantic vector search) when embeddings are available.

WHEN TO USE: When you need to find a function, struct, or component by name. Complements grep — returns structured results with dependency info. Semantic mode understands meaning, not just keywords.
AFTER THIS: Use recon_context({name}) for 360° view of a result.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Symbol name or substring to search for (case-insensitive)',
        },
        type: {
          type: 'string',
          description: 'Filter by node type',
          enum: ['Function', 'Method', 'Struct', 'Interface', 'Component', 'Type', 'Package', 'Class', 'Enum', 'Trait'],
        },
        package: {
          type: 'string',
          description: 'Filter by package/directory (e.g., "internal/auth" or "src/components/ui")',
        },
        language: {
          type: 'string',
          description: 'Filter by language',
          enum: ['go', 'typescript', 'python', 'rust', 'java', 'c', 'cpp'],
        },
        semantic: {
          type: 'boolean',
          description: 'Enable semantic search (BM25 + vector embeddings). Default: true when embeddings available.',
          default: true,
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default: 20)',
          default: 20,
        },
        repo: REPO_PROPERTY,
      },
      required: ['query'],
    },
  },
  {
    name: 'recon_detect_changes',
    description: `Analyze uncommitted git changes and find affected symbols and their dependents. Maps git diff hunks to indexed symbols, then traces impact through the dependency graph.

WHEN TO USE: Before committing — to understand what your changes affect. Pre-commit review, PR preparation.
AFTER THIS: Review affected symbols. Use recon_context() on high-risk items.`,
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          description: 'What to analyze: "unstaged" (working tree), "staged" (git add), "all" (both), "branch" (compare with base)',
          enum: ['unstaged', 'staged', 'all', 'branch'],
          default: 'all',
        },
        base: {
          type: 'string',
          description: 'Base branch/commit for "branch" scope (default: "main")',
          default: 'main',
        },
        repo: REPO_PROPERTY,
      },
      required: [],
    },
  },
  {
    name: 'recon_api_map',
    description: `Show the full API route map: HTTP endpoint → Go handler → TypeScript consumers. Cross-language traceability.

WHEN TO USE: When you need to understand how frontend calls map to backend handlers, find which TS files call a specific API endpoint, or audit API coverage.
AFTER THIS: Use recon_context({name}) on a specific handler for full dependency info.`,
    inputSchema: {
      type: 'object',
      properties: {
        method: {
          type: 'string',
          description: 'Filter by HTTP method: GET, POST, PUT, PATCH, DELETE',
          enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        },
        pattern: {
          type: 'string',
          description: 'Filter by URL pattern substring (e.g., "guilds", "admin")',
        },
        handler: {
          type: 'string',
          description: 'Filter by handler name substring (e.g., "GetGuild")',
        },
        repo: REPO_PROPERTY,
      },
      required: [],
    },
  },
  {
    name: 'recon_rename',
    description: `Multi-file coordinated rename using the knowledge graph. Finds all references via graph relationships (callers, importers, component users) and generates an edit plan with confidence tags.

WHEN TO USE: Renaming a function, struct, component, or method across the codebase. Safer than find-and-replace because it understands the call graph.
AFTER THIS: Review the edit plan. Run with dry_run: false to apply. Then run recon_detect_changes() to verify.

Each edit is tagged:
- "graph": found via knowledge graph relationship (high confidence, safe to accept)
- "text_search": found via name matching (lower confidence, review carefully)`,
    inputSchema: {
      type: 'object',
      properties: {
        symbol_name: {
          type: 'string',
          description: 'Current name of the symbol to rename',
        },
        new_name: {
          type: 'string',
          description: 'The new name for the symbol',
        },
        file: {
          type: 'string',
          description: 'File path substring to disambiguate when multiple symbols share a name',
        },
        dry_run: {
          type: 'boolean',
          description: 'Preview edits without applying (default: true)',
          default: true,
        },
        repo: REPO_PROPERTY,
      },
      required: ['symbol_name', 'new_name'],
    },
  },
  {
    name: 'recon_query_graph',
    description: `Execute a simplified Cypher query against the Recon knowledge graph. Returns results as a markdown table.

WHEN TO USE: Complex structural queries that recon_query can't answer — e.g., "find all structs with methods", "find all callers of functions in package X", "list classes that extend another class".
AFTER THIS: Use recon_context({name}) on result symbols for deeper context.

SUPPORTED SYNTAX:
  MATCH (n:Type) WHERE n.name = 'X' RETURN n
  MATCH (a)-[:EDGE_TYPE]->(b) WHERE a.name = 'X' RETURN b.name, b.file
  MATCH (s:Struct)-[:HAS_METHOD]->(m:Method) RETURN s.name, m.name

NODE TYPES: Package, File, Function, Method, Struct, Interface, Module, Component, Type, Class, Enum, Trait
EDGE TYPES: CONTAINS, DEFINES, CALLS, IMPORTS, HAS_METHOD, IMPLEMENTS, USES_COMPONENT, CALLS_API, EXTENDS

WHERE operators: =, <>, CONTAINS, STARTS WITH (all case-insensitive)
NODE properties: id, type, name, file, startLine, endLine, language, package, exported, repo

EXAMPLES:
• Find all classes:
  MATCH (c:Class) RETURN c.name, c.file
• Find callers of a function:
  MATCH (a)-[:CALLS]->(b:Function) WHERE b.name = 'main' RETURN a.name, a.file
• Find methods of a struct:
  MATCH (s:Struct)-[:HAS_METHOD]->(m:Method) WHERE s.name = 'Config' RETURN m.name, m.file
• Find class inheritance:
  MATCH (child:Class)-[:EXTENDS]->(parent:Class) RETURN child.name, parent.name
• Find exported functions in a package:
  MATCH (f:Function) WHERE f.package CONTAINS 'auth' AND f.exported = 'true' RETURN f.name, f.file`,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Simplified Cypher query (MATCH...WHERE...RETURN...LIMIT)',
        },
        limit: {
          type: 'number',
          description: 'Max rows to return (default: 50)',
          default: 50,
        },
        repo: REPO_PROPERTY,
      },
      required: ['query'],
    },
  },
  {
    name: 'recon_list_repos',
    description: `List all indexed repositories with their stats (node count, relationship count, index time, git info).

WHEN TO USE: When working with multi-repo setups. Discover which repos are indexed and their sizes.
AFTER THIS: Use any tool with repo parameter to filter by a specific repo.`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'recon_processes',
    description: `Detect and list execution flows by tracing call chains from entry points (HTTP handlers, exported functions). Shows the full call chain with complexity ranking.

WHEN TO USE: When you need to understand execution flows, trace request handling paths, or identify the most complex code paths in the codebase.
AFTER THIS: Use READ recon://process/{name} for a detailed step-by-step trace of a specific flow.`,
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Max processes to return (default: 20)',
          default: 20,
        },
        filter: {
          type: 'string',
          description: 'Filter processes by name (substring match)',
        },
        repo: REPO_PROPERTY,
      },
      required: [],
    },
  },
];
