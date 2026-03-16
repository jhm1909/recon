/**
 * MCP Server
 *
 * Creates and configures the CodeMap MCP server with stdio transport.
 * Pattern from GitNexus's server.ts.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { KnowledgeGraph } from '../graph/graph.js';
import { CODEMAP_TOOLS } from './tools.js';
import { handleToolCall } from './handlers.js';
import { getNextStepHint } from './hints.js';

const VERSION = '1.0.0';

/**
 * Create a configured MCP Server with all handlers registered.
 */
export function createServer(graph: KnowledgeGraph): Server {
  const server = new Server(
    { name: 'codemap', version: VERSION },
    { capabilities: { tools: {}, prompts: {} } },
  );

  // ─── ListTools ──────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: CODEMAP_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  // ─── CallTool ───────────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const result = await handleToolCall(
        name,
        args as Record<string, unknown> | undefined,
        graph,
      );
      const hint = getNextStepHint(name, args as Record<string, unknown>);

      return {
        content: [{ type: 'text', text: result + hint }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Start the MCP server on stdio transport.
 */
export async function startServer(graph: KnowledgeGraph): Promise<void> {
  const server = createServer(graph);
  const transport = new StdioServerTransport();

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await server.close();
    } catch {
      // Ignore close errors
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.stdin.on('end', shutdown);
  process.stdout.on('error', shutdown);

  await server.connect(transport);
}
