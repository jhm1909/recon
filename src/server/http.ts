/**
 * HTTP REST API Server
 *
 * Express server that wraps MCP tool handlers and resources as REST endpoints.
 *
 *   GET  /api/health          — health check + index stats
 *   GET  /api/tools           — list available tools
 *   POST /api/tools/:name     — execute a tool (body = params)
 *   GET  /api/resources       — list MCP resources + templates
 *   GET  /api/resources/:uri  — read a resource
 */

import express from 'express';
import cors from 'cors';
import type { KnowledgeGraph } from '../graph/graph.js';
import type { VectorStore } from '../search/vector-store.js';
import { RECON_TOOLS } from '../mcp/tools.js';
import { handleToolCall } from '../mcp/handlers.js';
import { getNextStepHint } from '../mcp/hints.js';
import {
  getResourceDefinitions,
  getResourceTemplates,
  readResource,
} from '../mcp/resources.js';

export interface HttpServerOptions {
  port: number;
  graph: KnowledgeGraph;
  projectRoot?: string;
  vectorStore?: VectorStore | null;
}

/**
 * Create the Express app (exported for testing without listen).
 */
export function createApp(options: HttpServerOptions): express.Express {
  const { graph, projectRoot, vectorStore } = options;
  const app = express();

  app.use(cors());
  app.use(express.json());

  // ─── GET /api/health ────────────────────────────────────────

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      nodes: graph.nodeCount,
      relationships: graph.relationshipCount,
      tools: RECON_TOOLS.length,
    });
  });

  // ─── GET /api/tools ─────────────────────────────────────────

  app.get('/api/tools', (_req, res) => {
    res.json({
      tools: RECON_TOOLS.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    });
  });

  // ─── POST /api/tools/:name ──────────────────────────────────

  app.post('/api/tools/:name', async (req, res) => {
    const { name } = req.params;
    const args = req.body as Record<string, unknown> | undefined;

    try {
      const result = await handleToolCall(
        name,
        args,
        graph,
        projectRoot,
        vectorStore,
      );
      const hint = getNextStepHint(name, args as Record<string, unknown>);

      res.json({ result: result + hint });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(400).json({ error: message });
    }
  });

  // ─── GET /api/resources ─────────────────────────────────────

  app.get('/api/resources', (_req, res) => {
    res.json({
      resources: getResourceDefinitions(),
      templates: getResourceTemplates(),
    });
  });

  // ─── GET /api/resources/read?uri=... ─────────────────────────
  // Resource URI passed as query param to avoid path issues with ://

  app.get('/api/resources/read', (req, res) => {
    const uri = req.query.uri as string;

    if (!uri) {
      res.status(400).json({ error: 'Missing ?uri= query parameter' });
      return;
    }

    try {
      const content = readResource(uri, graph);
      res.json({ uri, content });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(404).json({ error: message });
    }
  });

  return app;
}

/**
 * Start the HTTP server.
 */
export async function startHttpServer(options: HttpServerOptions): Promise<void> {
  const app = createApp(options);
  const { port } = options;

  return new Promise((resolve) => {
    app.listen(port, () => {
      console.error(`[recon] HTTP API server listening on http://localhost:${port}`);
      console.error(`[recon] Health: http://localhost:${port}/api/health`);
      console.error(`[recon] Tools:  http://localhost:${port}/api/tools`);
      resolve();
    });
  });
}
