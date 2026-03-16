/**
 * Cross-Language Analyzer
 *
 * Links Go API routes to TypeScript consumers via CALLS_API edges.
 * 1. Parses apps/api/router/router.go for route → handler mappings
 * 2. Parses apps/web/src/lib/constants.ts for TS API path patterns
 * 3. Matches TS API calls to Go handlers by normalized URL patterns
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { NodeType, RelationshipType, Language } from '../graph/types.js';
import type { Node, Relationship } from '../graph/types.js';
import type { AnalyzerResult } from './types.js';

// ─── Types ───────────────────────────────────────────────────

export interface APIRoute {
  method: string;       // GET, POST, PUT, PATCH, DELETE
  pattern: string;      // /api/v1/guilds/:id/modules
  handler: string;      // GetModules
  normalized: string;   // guilds/*/modules (for matching)
}

interface TSAPIConstant {
  key: string;          // API.guilds.modules
  pattern: string;      // /api/v1/guilds/${id}/modules
  normalized: string;   // guilds/*/modules
}

// ─── Go Route Extraction ─────────────────────────────────────

const ROUTE_RE = /(\w+)\.(Get|Post|Put|Patch|Delete)\("([^"]+)".*?h\.(\w+)\)/g;
const FUNC_RE = /^func\s+(\w+)\(/;

/**
 * Parse router.go and extract all route registrations.
 */
export function extractGoRoutes(projectRoot: string): APIRoute[] {
  const routerPath = join(projectRoot, 'apps/api/router/router.go');
  if (!existsSync(routerPath)) return [];

  const source = readFileSync(routerPath, 'utf-8');
  const routes: APIRoute[] = [];

  // Track current function context for prefix resolution
  let currentFunc = '';
  const lines = source.split('\n');

  for (const line of lines) {
    const funcMatch = line.match(FUNC_RE);
    if (funcMatch) {
      currentFunc = funcMatch[1];
    }

    // Reset regex state
    ROUTE_RE.lastIndex = 0;
    const routeMatch = ROUTE_RE.exec(line.trim());
    if (!routeMatch) continue;

    const [, variable, method, path, handler] = routeMatch;
    const prefix = resolvePrefix(currentFunc, variable);
    const fullPattern = prefix + path;

    routes.push({
      method: method.toUpperCase(),
      pattern: fullPattern,
      handler,
      normalized: normalizePattern(fullPattern),
    });
  }

  return routes;
}

function resolvePrefix(funcName: string, variable: string): string {
  // Direct app-level routes
  if (funcName === 'Setup' && variable === 'app') return '';
  // v1 group
  if (funcName === 'Setup' && variable === 'v1') return '/api/v1';
  // tools sub-group
  if (funcName === 'Setup' && variable === 'tools') return '/api/v1/tools';
  // Admin routes — the function creates a.Group("/admin")
  if (funcName === 'registerAdminRoutes' && variable === 'a') return '/api/v1/admin';
  // All other register* functions receive the protected/admin router with /api/v1 prefix
  if (funcName.startsWith('register')) return '/api/v1';
  // Fallback
  return '/api/v1';
}

// ─── TS API Constant Extraction ──────────────────────────────

/**
 * Parse constants.ts and extract API path patterns.
 */
export function extractTSAPIConstants(projectRoot: string): TSAPIConstant[] {
  const constPath = join(projectRoot, 'apps/web/src/lib/constants.ts');
  if (!existsSync(constPath)) return [];

  const source = readFileSync(constPath, 'utf-8');
  const constants: TSAPIConstant[] = [];

  // Match string patterns: "/api/v1/guilds"
  const stringRe = /(\w+):\s*"(\/api\/v1\/[^"]+)"/g;
  let m;
  while ((m = stringRe.exec(source)) !== null) {
    constants.push({
      key: m[1],
      pattern: m[2],
      normalized: normalizePattern(m[2]),
    });
  }

  // Match template literal patterns: (id: string) => `/api/v1/guilds/${id}`
  const templateRe = /(\w+):\s*\([^)]*\)\s*=>\s*`(\/api\/v1\/[^`]+)`/g;
  while ((m = templateRe.exec(source)) !== null) {
    constants.push({
      key: m[1],
      pattern: m[2],
      normalized: normalizePattern(m[2]),
    });
  }

  return constants;
}

// ─── Pattern Matching ────────────────────────────────────────

function normalizePattern(path: string): string {
  return path
    .replace(/^\/api\/v1\//, '')       // strip API prefix
    .replace(/:[^/]+/g, '*')           // Go :param → *
    .replace(/\$\{[^}]+\}/g, '*')      // TS ${param} → *
    .replace(/\?.*$/, '')              // strip query params
    .replace(/^\/+|\/+$/g, '');        // trim slashes
}

// ─── Cross-Language Edge Builder ─────────────────────────────

/**
 * Build CALLS_API edges linking TS files/hooks to Go handler methods.
 * Also creates route-annotated nodes for the API map tool.
 */
export function buildCrossLanguageEdges(
  projectRoot: string,
  existingNodeIds: Set<string>,
): { result: AnalyzerResult; routes: APIRoute[] } {
  const routes = extractGoRoutes(projectRoot);
  const tsConstants = extractTSAPIConstants(projectRoot);

  if (routes.length === 0) {
    return { result: { nodes: [], relationships: [] }, routes: [] };
  }

  const nodes: Node[] = [];
  const relationships: Relationship[] = [];
  let relCounter = 0;

  // Build route lookup: normalized pattern → routes
  const routeByPattern = new Map<string, APIRoute[]>();
  for (const route of routes) {
    const existing = routeByPattern.get(route.normalized) || [];
    existing.push(route);
    routeByPattern.set(route.normalized, existing);
  }

  // Match TS constants to Go routes
  for (const tsConst of tsConstants) {
    const matchedRoutes = routeByPattern.get(tsConst.normalized);
    if (!matchedRoutes) continue;

    for (const route of matchedRoutes) {
      // Find Go handler node — try method on Handler first, then plain function
      const handlerNodeId =
        existingNodeIds.has(`go:method:apps/api/handler.Handler.${route.handler}`)
          ? `go:method:apps/api/handler.Handler.${route.handler}`
          : existingNodeIds.has(`go:func:apps/api/handler.${route.handler}`)
            ? `go:func:apps/api/handler.${route.handler}`
            : null;

      if (!handlerNodeId) continue;

      // Find TS consumer — look for files that import API constants
      // For now, create an edge from the constants file to the handler
      const constFileId = 'ts:file:apps/web/src/lib/constants.ts';
      if (!existingNodeIds.has(constFileId)) continue;

      relationships.push({
        id: `rel:api:${++relCounter}`,
        type: RelationshipType.CALLS_API,
        sourceId: constFileId,
        targetId: handlerNodeId,
        confidence: 0.95,
        metadata: {
          httpMethod: route.method,
          urlPattern: route.pattern,
        },
      });
    }
  }

  // Also link TS hooks that use API constants to Go handlers
  // useApi(API.guilds.list) → useGuilds → GetGuilds
  const hookMappings = buildHookMappings(projectRoot, tsConstants, routeByPattern, existingNodeIds);
  for (const mapping of hookMappings) {
    relationships.push({
      id: `rel:api:${++relCounter}`,
      type: RelationshipType.CALLS_API,
      sourceId: mapping.tsNodeId,
      targetId: mapping.goNodeId,
      confidence: 0.85,
      metadata: {
        httpMethod: mapping.method,
        urlPattern: mapping.pattern,
      },
    });
  }

  return { result: { nodes, relationships }, routes };
}

interface HookMapping {
  tsNodeId: string;
  goNodeId: string;
  method: string;
  pattern: string;
}

/**
 * Scan hook files for useApi/api.get/api.post calls that reference API constants.
 */
function buildHookMappings(
  projectRoot: string,
  tsConstants: TSAPIConstant[],
  routeByPattern: Map<string, APIRoute[]>,
  existingNodeIds: Set<string>,
): HookMapping[] {
  const mappings: HookMapping[] = [];

  // Scan common hook/lib files that make API calls
  const apiCallFiles = [
    'apps/web/src/hooks/use-api.ts',
    'apps/web/src/hooks/use-guild.ts',
    'apps/web/src/hooks/use-guilds.ts',
    'apps/web/src/hooks/use-mutation.ts',
    'apps/web/src/hooks/use-guild-settings.ts',
    'apps/web/src/hooks/use-mcp.ts',
    'apps/web/src/hooks/use-user.ts',
    'apps/web/src/lib/api-client.ts',
    'apps/web/src/lib/flow-api.ts',
    'apps/web/src/lib/mcp-api.ts',
    'apps/web/src/lib/embed-builder-api.ts',
    'apps/web/src/lib/analytics-insights-api.ts',
    'apps/web/src/lib/flow-version-api.ts',
  ];

  for (const relPath of apiCallFiles) {
    const absPath = join(projectRoot, relPath);
    if (!existsSync(absPath)) continue;

    const source = readFileSync(absPath, 'utf-8');

    // Find API constant references: API.guilds.list, API.guilds.get(id), etc.
    const apiRefRe = /API\.(\w+)\.(\w+)/g;
    let match;
    while ((match = apiRefRe.exec(source)) !== null) {
      const refKey = match[2]; // e.g., "list", "get", "modules"

      // Find matching constant
      const constant = tsConstants.find((c) => c.key === refKey);
      if (!constant) continue;

      // Find matching Go route
      const matchedRoutes = routeByPattern.get(constant.normalized);
      if (!matchedRoutes) continue;

      for (const route of matchedRoutes) {
        const handlerNodeId =
          existingNodeIds.has(`go:method:apps/api/handler.Handler.${route.handler}`)
            ? `go:method:apps/api/handler.Handler.${route.handler}`
            : null;
        if (!handlerNodeId) continue;

        // Find the TS function node in this file
        const fileId = `ts:file:${relPath}`;
        if (!existingNodeIds.has(fileId)) continue;

        // Find the enclosing function — scan backwards from match position
        const beforeMatch = source.substring(0, match.index);
        const funcMatch = beforeMatch.match(/export\s+(?:async\s+)?function\s+(\w+)/g);
        let tsNodeId = fileId; // fallback to file

        if (funcMatch) {
          const lastFunc = funcMatch[funcMatch.length - 1];
          const funcName = lastFunc.match(/function\s+(\w+)/)?.[1];
          if (funcName) {
            const candidateId = `ts:func:${relPath}:${funcName}`;
            if (existingNodeIds.has(candidateId)) {
              tsNodeId = candidateId;
            }
          }
        }

        // Avoid duplicate edges
        const edgeKey = `${tsNodeId}→${handlerNodeId}`;
        if (!mappings.some((m) => `${m.tsNodeId}→${m.goNodeId}` === edgeKey)) {
          mappings.push({
            tsNodeId,
            goNodeId: handlerNodeId,
            method: route.method,
            pattern: route.pattern,
          });
        }
      }
    }

    // Also match direct path strings: api.get("/api/v1/guilds/...")
    const directPathRe = /api\.(get|post|put|patch|delete)[<(]\s*[^"]*"(\/api\/v1\/[^"]+)"/gi;
    while ((match = directPathRe.exec(source)) !== null) {
      const httpMethod = match[1].toUpperCase();
      const path = match[2];
      const normalized = normalizePattern(path);

      const matchedRoutes = routeByPattern.get(normalized);
      if (!matchedRoutes) continue;

      for (const route of matchedRoutes) {
        if (route.method !== httpMethod) continue;

        const handlerNodeId =
          existingNodeIds.has(`go:method:apps/api/handler.Handler.${route.handler}`)
            ? `go:method:apps/api/handler.Handler.${route.handler}`
            : null;
        if (!handlerNodeId) continue;

        const fileId = `ts:file:${relPath}`;
        if (!existingNodeIds.has(fileId)) continue;

        if (!mappings.some((m) => m.tsNodeId === fileId && m.goNodeId === handlerNodeId)) {
          mappings.push({
            tsNodeId: fileId,
            goNodeId: handlerNodeId,
            method: route.method,
            pattern: route.pattern,
          });
        }
      }
    }
  }

  return mappings;
}
