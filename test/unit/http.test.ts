/**
 * Unit Tests: HTTP REST API Server
 *
 * Tests Express routes using supertest with a mock graph.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { KnowledgeGraph } from '../../src/graph/graph.js';
import { NodeType, RelationshipType, Language } from '../../src/graph/types.js';
import type { Node, Relationship } from '../../src/graph/types.js';
import { createApp } from '../../src/server/http.js';
import type { Express } from 'express';

// ─── Helpers ─────────────────────────────────────────────────────

function makeNode(id: string, name: string, overrides?: Partial<Node>): Node {
  return {
    id,
    type: NodeType.Function,
    name,
    file: 'src/main.go',
    startLine: 1,
    endLine: 10,
    language: Language.Go,
    package: 'main',
    exported: true,
    ...overrides,
  };
}

function makeRel(
  sourceId: string,
  targetId: string,
  type: RelationshipType = RelationshipType.CALLS,
): Relationship {
  return {
    id: `${sourceId}-${type}-${targetId}`,
    type,
    sourceId,
    targetId,
    confidence: 1.0,
  };
}

// ─── Setup ──────────────────────────────────────────────────────

let app: Express;
let graph: KnowledgeGraph;

beforeAll(() => {
  graph = new KnowledgeGraph();
  graph.addNode(makeNode('f1', 'GetUser', {
    package: 'handler',
    file: 'handler/user.go',
  }));
  graph.addNode(makeNode('f2', 'FindUser', {
    package: 'service',
    file: 'service/user.go',
  }));
  graph.addNode(makeNode('f3', 'QueryDB', {
    package: 'repo',
    file: 'repo/db.go',
  }));
  graph.addRelationship(makeRel('f1', 'f2'));
  graph.addRelationship(makeRel('f2', 'f3'));

  app = createApp({ port: 0, graph });
});

// ─── Health ─────────────────────────────────────────────────────

describe('GET /api/health', () => {
  it('returns status ok with graph stats', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.nodes).toBe(3);
    expect(res.body.relationships).toBe(2);
    expect(res.body.tools).toBeGreaterThan(0);
  });
});

// ─── Tools List ─────────────────────────────────────────────────

describe('GET /api/tools', () => {
  it('returns list of available tools', async () => {
    const res = await request(app).get('/api/tools');

    expect(res.status).toBe(200);
    expect(res.body.tools).toBeDefined();
    expect(Array.isArray(res.body.tools)).toBe(true);
    expect(res.body.tools.length).toBeGreaterThan(0);

    const names = res.body.tools.map((t: any) => t.name);
    expect(names).toContain('recon_find');
    expect(names).toContain('recon_impact');
    expect(names).toContain('recon_explain');
    expect(names).toContain('recon_export');
  });

  it('each tool has name, description, inputSchema', async () => {
    const res = await request(app).get('/api/tools');

    for (const tool of res.body.tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
    }
  });
});

// ─── Tool Execution ─────────────────────────────────────────────

describe('POST /api/tools/:name', () => {
  it('executes recon_find and returns results', async () => {
    const res = await request(app)
      .post('/api/tools/recon_find')
      .send({ query: 'GetUser' });

    expect(res.status).toBe(200);
    expect(res.body.result).toBeDefined();
    expect(res.body.result).toContain('GetUser');
  });

  it('executes recon_explain and returns symbol info', async () => {
    const res = await request(app)
      .post('/api/tools/recon_explain')
      .send({ name: 'GetUser' });

    expect(res.status).toBe(200);
    expect(res.body.result).toContain('GetUser');
    expect(res.body.result).toContain('handler/user.go');
  });

  it('executes recon_impact and returns blast radius', async () => {
    const res = await request(app)
      .post('/api/tools/recon_impact')
      .send({ target: 'FindUser', direction: 'upstream' });

    expect(res.status).toBe(200);
    expect(res.body.result).toContain('FindUser');
    expect(res.body.result).toContain('GetUser'); // Caller
  });

  it('executes recon_map and returns response', async () => {
    const res = await request(app)
      .post('/api/tools/recon_map')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.result).toBeDefined();
  });

  it('returns structured error for unknown tool', async () => {
    const res = await request(app)
      .post('/api/tools/nonexistent_tool')
      .send({});

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body.result);
    expect(parsed.error).toBe('unknown_tool');
  });

  it('returns structured error for missing required params', async () => {
    const res = await request(app)
      .post('/api/tools/recon_find')
      .send({});

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body.result);
    expect(parsed.error).toBe('invalid_parameter');
  });

  it('returns result without next-step hint', async () => {
    const res = await request(app)
      .post('/api/tools/recon_find')
      .send({ query: 'GetUser' });

    expect(res.body.result).toBeDefined();
    expect(res.body.result).not.toContain('**Next:**');
  });
});

// ─── Resources ──────────────────────────────────────────────────

describe('GET /api/resources', () => {
  it('returns resource definitions and templates', async () => {
    const res = await request(app).get('/api/resources');

    expect(res.status).toBe(200);
    expect(res.body.resources).toBeDefined();
    expect(res.body.templates).toBeDefined();
    expect(Array.isArray(res.body.resources)).toBe(true);
    expect(Array.isArray(res.body.templates)).toBe(true);
    expect(res.body.resources.length).toBeGreaterThan(0);
    expect(res.body.templates.length).toBeGreaterThan(0);
  });
});

describe('GET /api/resources/read?uri=...', () => {
  it('reads recon://stats resource', async () => {
    const res = await request(app).get('/api/resources/read?uri=recon://stats');

    expect(res.status).toBe(200);
    expect(res.body.uri).toBe('recon://stats');
    expect(res.body.content).toContain('total_nodes');
    expect(res.body.content).toContain('total_relationships');
  });

  it('returns 404 for removed recon://packages resource', async () => {
    const res = await request(app).get('/api/resources/read?uri=recon://packages');

    expect(res.status).toBe(404);
  });

  it('reads recon://symbol/{name} resource', async () => {
    const res = await request(app).get('/api/resources/read?uri=recon://symbol/GetUser');

    expect(res.status).toBe(200);
    expect(res.body.content).toContain('GetUser');
  });

  it('returns 404 for unknown resource URI', async () => {
    const res = await request(app).get('/api/resources/read?uri=recon://unknown/thing');

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it('returns 400 when uri param is missing', async () => {
    const res = await request(app).get('/api/resources/read');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Missing');
  });
});

// ─── CORS ───────────────────────────────────────────────────────

describe('CORS', () => {
  it('includes CORS headers', async () => {
    const res = await request(app).get('/api/health');

    expect(res.headers['access-control-allow-origin']).toBeDefined();
  });
});
