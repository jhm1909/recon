/**
 * HTTP REST API Server
 *
 * Express server that wraps MCP tool handlers and resources as REST endpoints.
 * Also serves the interactive web dashboard at the root path.
 *
 *   GET  /                    — web dashboard
 *   GET  /api/health          — health check + index stats
 *   GET  /api/tools           — list available tools
 *   POST /api/tools/:name     — execute a tool (body = params)
 *   GET  /api/resources       — list MCP resources + templates
 *   GET  /api/resources/read  — read a resource (?uri=...)
 *   GET  /api/graph           — graph data for vis-network
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
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

const __dirname = dirname(fileURLToPath(import.meta.url));

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

  // ─── Static dashboard ───────────────────────────────────────

  const dashboardDir = join(__dirname, '..', 'dashboard');
  if (existsSync(dashboardDir)) {
    app.use(express.static(dashboardDir));
  }

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

  // ─── GET /api/graph ─────────────────────────────────────────
  // Returns nodes + edges formatted for vis-network visualization.

  app.get('/api/graph', (req, res) => {
    const limit = Math.min(
      parseInt(req.query.limit as string, 10) || 300,
      2000,
    );
    const typeFilter = req.query.type as string | undefined;
    const pkgFilter = req.query.package as string | undefined;

    // Structural edge types to skip (clutter the visualization)
    // Note: DEFINES is kept because for TS-only projects it may be the only edge type
    const SKIP_EDGE_TYPES = new Set(['CONTAINS']);

    // Compute degree for each node (non-structural edges only)
    const degrees = new Map<string, number>();
    for (const rel of graph.allRelationships()) {
      if (SKIP_EDGE_TYPES.has(rel.type)) continue;
      degrees.set(rel.sourceId, (degrees.get(rel.sourceId) || 0) + 1);
      degrees.set(rel.targetId, (degrees.get(rel.targetId) || 0) + 1);
    }

    // Filter nodes
    let candidates = [...graph.nodes.values()];
    if (typeFilter) {
      candidates = candidates.filter(n => n.type === typeFilter);
    }
    if (pkgFilter) {
      candidates = candidates.filter(n => n.package?.includes(pkgFilter));
    }

    // Sort by degree (most connected first) for interesting subgraph
    candidates.sort((a, b) =>
      (degrees.get(b.id) || 0) - (degrees.get(a.id) || 0),
    );

    const selected = candidates.slice(0, limit);
    const nodeIds = new Set(selected.map(n => n.id));

    // Format nodes for vis-network
    const nodes = selected.map(n => ({
      id: n.id,
      label: n.name,
      group: n.type,
      value: degrees.get(n.id) || 1,
      language: n.language,
      file: n.file,
      startLine: n.startLine,
      endLine: n.endLine,
      package: n.package,
      exported: n.exported,
      community: n.community,
    }));

    // Edges: only where both endpoints are visible, skip structural
    const edges: Array<{
      from: string;
      to: string;
      label: string;
    }> = [];

    for (const rel of graph.allRelationships()) {
      if (SKIP_EDGE_TYPES.has(rel.type)) continue;
      if (nodeIds.has(rel.sourceId) && nodeIds.has(rel.targetId)) {
        edges.push({
          from: rel.sourceId,
          to: rel.targetId,
          label: rel.type,
        });
      }
    }

    res.json({
      nodes,
      edges,
      stats: {
        totalNodes: graph.nodeCount,
        totalEdges: graph.relationshipCount,
        shownNodes: nodes.length,
        shownEdges: edges.length,
      },
    });
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
      console.error(`[recon] HTTP server listening on http://localhost:${port}`);
      console.error(`[recon] Dashboard: http://localhost:${port}/`);
      console.error(`[recon] API:       http://localhost:${port}/api/health`);
      resolve();
    });
  });
}
