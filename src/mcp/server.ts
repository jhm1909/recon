/**
 * MCP Server
 *
 * Creates and configures the Recon MCP server with stdio transport.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { KnowledgeGraph } from '../graph/graph.js';
import type { VectorStore } from '../search/vector-store.js';
import { RECON_TOOLS } from './tools.js';
import { handleToolCall } from './handlers.js';
import { getNextStepHint } from './hints.js';
import { RECON_INSTRUCTIONS } from './instructions.js';
import {
  getResourceDefinitions,
  getResourceTemplates,
  readResource,
} from './resources.js';
import { RECON_PROMPTS, getPromptMessages } from './prompts.js';

const VERSION = '1.0.0';

/**
 * Create a configured MCP Server with all handlers registered.
 */
export function createServer(
  graph: KnowledgeGraph,
  projectRoot?: string,
  vectorStore?: VectorStore | null,
): Server {
  const server = new Server(
    { name: 'recon', version: VERSION },
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
      instructions: RECON_INSTRUCTIONS,
    },
  );

  // ─── ListResources ────────────────────────────────────────────

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: getResourceDefinitions().map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    })),
  }));

  // ─── ListResourceTemplates ───────────────────────────────────

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: getResourceTemplates().map((t) => ({
      uriTemplate: t.uriTemplate,
      name: t.name,
      description: t.description,
      mimeType: t.mimeType,
    })),
  }));

  // ─── ReadResource ────────────────────────────────────────────

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    try {
      const content = readResource(uri, graph);
      return {
        contents: [{ uri, mimeType: 'text/yaml', text: content }],
      };
    } catch (err) {
      return {
        contents: [{
          uri,
          mimeType: 'text/plain',
          text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        }],
      };
    }
  });

  // ─── ListTools ──────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: RECON_TOOLS.map((t) => ({
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
        projectRoot,
        vectorStore,
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

  // ─── ListPrompts ─────────────────────────────────────────────

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: RECON_PROMPTS.map((p) => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments,
    })),
  }));

  // ─── GetPrompt ──────────────────────────────────────────────

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const messages = getPromptMessages(name, args as Record<string, string>);
    return { messages };
  });

  return server;
}

/**
 * Start the MCP server on stdio transport.
 */
export async function startServer(
  graph: KnowledgeGraph,
  projectRoot?: string,
  vectorStore?: VectorStore | null,
): Promise<void> {
  const server = createServer(graph, projectRoot, vectorStore);
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
