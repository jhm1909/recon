/**
 * MCP Tool Handlers (v6)
 *
 * Dispatches 8 tool calls to their respective modules:
 *   recon_map, recon_find, recon_explain, recon_impact,
 *   recon_changes, recon_rename, recon_export, recon_rules
 */

import { KnowledgeGraph } from '../graph/graph.js';
import { NodeType, RelationshipType, Language } from '../graph/types.js';
import type { Node, Relationship } from '../graph/types.js';
import { VectorStore } from '../search/vector-store.js';
import { executeFind, formatFindResults } from './find.js';
import type { FindOptions } from './find.js';
import { runRule, formatRuleResult } from './rules.js';
import type { RuleName } from './rules.js';
import { symbolNotFound, ambiguousSymbol, invalidParameter, emptyGraph } from './errors.js';
import { planRename, formatRenameResult } from './rename.js';
import { exportGraph } from '../export/exporter.js';
import type { ExportOptions } from '../export/exporter.js';
import { analyzeChanges, formatReview } from '../review/reviewer.js';
import { detectProcesses } from '../graph/process.js';

// ─── Helpers ───────────────────────────────────────────────────

/**
 * Resolve a symbol name to a single node, with optional file disambiguator.
 * Returns { node } on success, or { error } on failure.
 */
function resolveSymbol(
  graph: KnowledgeGraph,
  name: string,
  fileFilter?: string,
): { node: Node; error?: undefined } | { node?: undefined; error: string } {
  let matches = graph.findByName(name);

  if (fileFilter) {
    matches = matches.filter(n => n.file.includes(fileFilter));
  }

  if (matches.length === 0) {
    // Collect similar names for suggestion
    const similar = findSimilarNames(graph, name);
    return { error: symbolNotFound(name, similar).toJSON() };
  }

  // Disambiguate: prefer exact case match
  if (matches.length > 1) {
    const exact = matches.filter(n => n.name === name);
    if (exact.length > 0) matches = exact;
  }
  // Disambiguate: prefer exported symbols
  if (matches.length > 1) {
    const exported = matches.filter(n => n.exported);
    if (exported.length > 0) matches = exported;
  }

  if (matches.length > 1) {
    return { error: ambiguousSymbol(
      name,
      matches.map(m => ({ name: m.name, file: m.file })),
    ).toJSON() };
  }

  return { node: matches[0] };
}

/**
 * Find similar symbol names for "did you mean?" suggestions.
 */
function findSimilarNames(graph: KnowledgeGraph, name: string): string[] {
  const lower = name.toLowerCase();
  const similar: string[] = [];
  const seen = new Set<string>();

  for (const node of graph.nodes.values()) {
    if (node.type === NodeType.Package || node.type === NodeType.File) continue;
    const nodeLower = node.name.toLowerCase();
    if (seen.has(nodeLower)) continue;

    if (nodeLower.includes(lower) || lower.includes(nodeLower)) {
      seen.add(nodeLower);
      similar.push(node.name);
      if (similar.length >= 5) break;
    }
  }

  return similar;
}

function refFromRel(
  graph: KnowledgeGraph,
  rel: Relationship,
  side: 'source' | 'target',
): { name: string; file: string; line: number; edgeType: string } {
  const id = side === 'source' ? rel.sourceId : rel.targetId;
  const node = graph.getNode(id);
  return {
    name: node?.name || id,
    file: node?.file || '',
    line: node?.startLine || 0,
    edgeType: rel.type,
  };
}

function isTestFile(file: string): boolean {
  return /[._]test\.|[._]spec\.|__tests__|test\/|tests\/|_test\.go$/i.test(file);
}

function findProjectRoot(): string {
  try {
    const { execSync } = require('node:child_process');
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
  } catch {
    return process.cwd();
  }
}

// ─── Main Dispatcher ──────────────────────────────────────────

/**
 * Handle a tool call and return formatted text result.
 */
export async function handleToolCall(
  name: string,
  args: Record<string, unknown> | undefined,
  graph: KnowledgeGraph,
  projectRoot?: string,
  vectorStore?: VectorStore | null,
): Promise<string> {
  const a = args ?? {};
  // Check for empty graph (except recon_map which should show empty state)
  if (name !== 'recon_map' && graph.nodeCount === 0) {
    return emptyGraph().toJSON();
  }

  switch (name) {
    case 'recon_map':
      return handleMap(a, graph);

    case 'recon_find':
      return handleFind(a, graph);

    case 'recon_explain':
      return handleExplain(a, graph);

    case 'recon_impact':
      return handleImpact(a, graph);

    case 'recon_changes':
      return handleChanges(a, graph, projectRoot);

    case 'recon_rename':
      return handleRename(a, graph);

    case 'recon_export':
      return handleExport(a, graph);

    case 'recon_rules':
      return handleRules(a, graph);

    default:
      return JSON.stringify({ error: 'unknown_tool', tool: name });
  }
}

// ─── recon_map ────────────────────────────────────────────────

function handleMap(
  args: Record<string, unknown>,
  graph: KnowledgeGraph,
): string {
  const langFilter = (args?.language as string) || 'all';

  // Collect package nodes
  const packages: Node[] = [];
  for (const node of graph.nodes.values()) {
    if (node.type !== NodeType.Package) continue;

    if (langFilter === 'go' && node.language !== Language.Go) continue;
    if (langFilter === 'typescript' && node.language !== Language.TypeScript) continue;

    packages.push(node);
  }

  packages.sort((a, b) => a.package.localeCompare(b.package));

  // Count nodes by language
  const langCounts = new Map<string, number>();
  for (const node of graph.nodes.values()) {
    if (node.type === NodeType.Package || node.type === NodeType.File) continue;
    const lang = node.language || 'unknown';
    langCounts.set(lang, (langCounts.get(lang) || 0) + 1);
  }

  // Build importedBy for each package
  const importedByMap = new Map<string, string[]>();
  for (const node of packages) {
    const incoming = graph.getIncoming(node.id, RelationshipType.IMPORTS);
    const importers = incoming.map((r) => {
      const src = graph.getNode(r.sourceId);
      return src?.package || r.sourceId;
    });
    importedByMap.set(node.id, importers);
  }

  const totalRels = graph.relationshipCount;

  // Format output
  const lines: string[] = [
    '# Recon -- Package Overview',
    '',
    `**Stats:** ${packages.length} packages, ${graph.nodeCount} nodes, ${totalRels} relationships`,
  ];

  // Language breakdown
  if (langCounts.size > 0) {
    const langSummary = Array.from(langCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([lang, count]) => `${lang}: ${count}`)
      .join(', ');
    lines.push(`**Languages:** ${langSummary}`);
  }

  lines.push('');

  for (const pkg of packages) {
    const fileCount = pkg.files?.length || 0;
    const imports = pkg.imports || [];
    const importedBy = importedByMap.get(pkg.id) || [];

    lines.push(`## ${pkg.package}`);
    if (pkg.importPath) lines.push(`Import: \`${pkg.importPath}\``);
    lines.push(`Language: ${pkg.language} | Files: ${fileCount}`);

    if (imports.length > 0) {
      lines.push(`Imports: ${imports.join(', ')}`);
    }
    if (importedBy.length > 0) {
      lines.push(`Imported by: ${importedBy.join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── recon_find ───────────────────────────────────────────────

function handleFind(
  args: Record<string, unknown>,
  graph: KnowledgeGraph,
): string {
  const query = args?.query as string;
  if (!query) {
    return invalidParameter('query', '', ['<search term>']).toJSON();
  }

  const options: FindOptions = {};
  if (args?.type) options.type = args.type as NodeType;
  if (args?.limit) options.limit = args.limit as number;

  // Apply language and package filters via post-filtering
  let results = executeFind(graph, query, options);

  // Fallback: if exact search found nothing, retry with wildcard pattern
  if (results.length === 0 && !query.includes('*') && !query.includes('?')) {
    results = executeFind(graph, `*${query}*`, options);
  }

  // Apply additional filters not handled by executeFind
  let filtered = results;
  if (args?.language) {
    const langFilter = (args.language as string).toLowerCase();
    filtered = filtered.filter(r => {
      const node = graph.getNode(r.id);
      return node && node.language.toLowerCase() === langFilter;
    });
  }
  if (args?.package) {
    const pkgFilter = args.package as string;
    filtered = filtered.filter(r => r.package.includes(pkgFilter));
  }

  return formatFindResults(filtered);
}

// ─── recon_explain ────────────────────────────────────────────

function handleExplain(
  args: Record<string, unknown>,
  graph: KnowledgeGraph,
): string {
  const name = args?.name as string;
  const fileFilter = args?.file as string;

  if (!name) {
    return invalidParameter('name', '', ['<symbol name>']).toJSON();
  }

  const resolved = resolveSymbol(graph, name, fileFilter);
  if (resolved.error) return resolved.error;
  const node = resolved.node!;

  const incoming = graph.getIncoming(node.id);
  const outgoing = graph.getOutgoing(node.id);

  const callers = incoming
    .filter(r => r.type === RelationshipType.CALLS || r.type === RelationshipType.CALLS_API)
    .map(r => refFromRel(graph, r, 'source'));

  const callees = outgoing
    .filter(r => r.type === RelationshipType.CALLS || r.type === RelationshipType.CALLS_API)
    .map(r => refFromRel(graph, r, 'target'));

  const importedBy = incoming
    .filter(r => r.type === RelationshipType.IMPORTS)
    .map(r => refFromRel(graph, r, 'source'));

  const imports = outgoing
    .filter(r => r.type === RelationshipType.IMPORTS)
    .map(r => refFromRel(graph, r, 'target'));

  const methods = outgoing
    .filter(r => r.type === RelationshipType.HAS_METHOD)
    .map(r => refFromRel(graph, r, 'target'));

  const implementedBy = incoming
    .filter(r => r.type === RelationshipType.IMPLEMENTS)
    .map(r => refFromRel(graph, r, 'source'));

  const usedBy = incoming
    .filter(r => r.type === RelationshipType.USES_COMPONENT)
    .map(r => refFromRel(graph, r, 'source'));

  // Test references: find test nodes that call this symbol
  const testRefs = incoming
    .filter(r => {
      const src = graph.getNode(r.sourceId);
      return src && src.isTest;
    })
    .map(r => refFromRel(graph, r, 'source'));

  // Format
  const lines: string[] = [
    `# Context: ${node.name}`,
    '',
    `**Type:** ${node.type}`,
    `**File:** \`${node.file}:${node.startLine}-${node.endLine}\``,
    `**Language:** ${node.language}`,
    `**Package:** ${node.package}`,
    `**Exported:** ${node.exported}`,
    ...(node.community ? [`**Community:** ${node.community}`] : []),
    '',
  ];

  const sections: [string, ReturnType<typeof refFromRel>[]][] = [
    ['Callers', callers],
    ['Callees', callees],
    ['Imported By', importedBy],
    ['Imports', imports],
    ['Methods', methods],
    ['Implemented By', implementedBy],
    ['Used By (Components)', usedBy],
  ];

  for (const [title, refs] of sections) {
    lines.push(`### ${title} (${refs.length})`);
    if (refs.length === 0) {
      lines.push('_none_');
    } else {
      for (const ref of refs) {
        lines.push(`- ${ref.name} -- \`${ref.file}:${ref.line}\` [${ref.edgeType}]`);
      }
    }
    lines.push('');
  }

  // Test references
  if (testRefs.length > 0) {
    lines.push(`### Test References (${testRefs.length})`);
    for (const ref of testRefs) {
      lines.push(`- ${ref.name} -- \`${ref.file}:${ref.line}\` [${ref.edgeType}]`);
    }
    lines.push('');
  }

  // Process participation -- show which execution flows this symbol is in
  try {
    const allProcesses = detectProcesses(graph, { limit: 50 });
    const participating: Array<{ processName: string; stepIndex: number; totalSteps: number }> = [];
    for (const proc of allProcesses) {
      if (proc.entryPoint.name === node.name && proc.entryPoint.file === node.file) {
        participating.push({ processName: proc.name, stepIndex: 0, totalSteps: proc.steps.length });
        continue;
      }
      for (let i = 0; i < proc.steps.length; i++) {
        if (proc.steps[i].name === node.name && proc.steps[i].file === node.file) {
          participating.push({ processName: proc.name, stepIndex: i + 1, totalSteps: proc.steps.length });
          break;
        }
      }
    }

    lines.push(`### Execution Flows (${participating.length})`);
    if (participating.length === 0) {
      lines.push('_none_');
    } else {
      for (const p of participating) {
        const role = p.stepIndex === 0 ? 'entry point' : `step ${p.stepIndex}/${p.totalSteps}`;
        lines.push(`- **${p.processName}** (${role})`);
      }
    }
    lines.push('');
  } catch {
    // Skip flow detection on error
  }

  return lines.join('\n');
}

// ─── recon_impact ─────────────────────────────────────────────

function handleImpact(
  args: Record<string, unknown>,
  graph: KnowledgeGraph,
): string {
  const target = args?.target as string;
  const direction = (args?.direction as string) || 'upstream';
  const fileFilter = args?.file as string;

  if (!target) {
    return invalidParameter('target', '', ['<symbol name>']).toJSON();
  }

  if (!['upstream', 'downstream'].includes(direction)) {
    return invalidParameter('direction', direction, ['upstream', 'downstream']).toJSON();
  }

  const maxDepth = (args?.maxDepth as number) || 3;

  const resolved = resolveSymbol(graph, target, fileFilter);
  if (resolved.error) return resolved.error;
  const targetNode = resolved.node!;

  // BFS traversal
  const visited = new Set<string>([targetNode.id]);
  let frontier = [targetNode.id];
  const byDepth: Array<{
    depth: number;
    label: string;
    symbols: Array<{
      name: string;
      type: string;
      file: string;
      line: number;
      edgeType: string;
      confidence: number;
      isTest: boolean;
    }>;
  }> = [];

  const depthLabels = [
    '',
    'WILL BREAK -- direct callers/importers',
    'LIKELY AFFECTED -- indirect dependents',
    'MAY NEED TESTING -- transitive',
  ];

  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const nextFrontier: string[] = [];
    const symbols: typeof byDepth[0]['symbols'] = [];

    for (const nodeId of frontier) {
      const edges = direction === 'upstream'
        ? graph.getIncoming(nodeId)
        : graph.getOutgoing(nodeId);

      for (const edge of edges) {
        const neighborId = direction === 'upstream' ? edge.sourceId : edge.targetId;
        if (visited.has(neighborId)) continue;

        const neighbor = graph.getNode(neighborId);
        if (!neighbor) continue;

        visited.add(neighborId);
        nextFrontier.push(neighborId);
        symbols.push({
          name: neighbor.name,
          type: neighbor.type,
          file: neighbor.file,
          line: neighbor.startLine,
          edgeType: edge.type,
          confidence: edge.confidence,
          isTest: neighbor.isTest || isTestFile(neighbor.file),
        });
      }
    }

    if (symbols.length > 0) {
      byDepth.push({
        depth,
        label: depthLabels[depth] || `Depth ${depth}`,
        symbols,
      });
    }

    frontier = nextFrontier;
  }

  // Separate test nodes from non-test nodes
  const allSymbols = byDepth.flatMap(d => d.symbols);
  const testNodes = allSymbols.filter(s => s.isTest);
  const nonTestSymbols = allSymbols.filter(s => !s.isTest);

  // Risk calculation based on d=1 non-test count
  const d1NonTest = (byDepth.find(d => d.depth === 1)?.symbols || []).filter(s => !s.isTest);
  const d1Count = d1NonTest.length;

  const crossApp = new Set(nonTestSymbols
    .map(s => s.file.match(/^apps\/([^/]+)/)?.[1])
    .filter(Boolean),
  ).size > 1;

  let risk: string;
  if (d1Count >= 20 || crossApp) risk = 'CRITICAL';
  else if (d1Count >= 10) risk = 'HIGH';
  else if (d1Count >= 3) risk = 'MEDIUM';
  else risk = 'LOW';

  const totalAffected = nonTestSymbols.length;

  // Format
  const lines: string[] = [
    `# Impact Analysis: ${targetNode.name}`,
    '',
    `**Target:** ${targetNode.name} (${targetNode.type}) -- \`${targetNode.file}:${targetNode.startLine}\``,
    `**Direction:** ${direction}`,
    `**Risk:** ${risk}`,
    `**Summary:** ${d1Count} direct ${direction === 'upstream' ? 'callers' : 'callees'}, ${totalAffected} total affected`,
    '',
  ];

  for (const group of byDepth) {
    const groupNonTest = group.symbols.filter(s => !s.isTest);
    if (groupNonTest.length === 0) continue;

    lines.push(`## d=${group.depth}: ${group.label} (${groupNonTest.length})`);
    lines.push('');

    for (const sym of groupNonTest) {
      lines.push(`- **${sym.name}** (${sym.type}) -- \`${sym.file}:${sym.line}\` [${sym.edgeType}]`);
    }
    lines.push('');
  }

  // Affected tests section
  if (testNodes.length > 0) {
    lines.push(`## Affected Tests (${testNodes.length})`);
    lines.push('');
    for (const t of testNodes) {
      lines.push(`- **${t.name}** -- \`${t.file}:${t.line}\``);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── recon_changes ────────────────────────────────────────────

function handleChanges(
  args: Record<string, unknown>,
  graph: KnowledgeGraph,
  projectRoot?: string,
): string {
  const root = projectRoot || findProjectRoot();

  const options = {
    scope: (args?.scope as 'staged' | 'unstaged' | 'branch' | 'all') || 'unstaged',
    base: (args?.base as string) || 'main',
    includeDiagram: (args?.include_diagram as boolean) ?? false,
  };

  const result = analyzeChanges(graph, root, options);
  return formatReview(result, graph, options);
}

// ─── recon_rename ─────────────────────────────────────────────

function handleRename(
  args: Record<string, unknown>,
  graph: KnowledgeGraph,
): string {
  const symbolName = args?.symbol as string;
  const newName = args?.new_name as string;
  const fileFilter = args?.file as string | undefined;
  const dryRun = (args?.dry_run as boolean) ?? true;

  if (!symbolName) {
    return invalidParameter('symbol', '', ['<current symbol name>']).toJSON();
  }
  if (!newName) {
    return invalidParameter('new_name', '', ['<new name>']).toJSON();
  }

  const result = planRename(graph, symbolName, newName, fileFilter, dryRun);

  // If planRename returned a disambiguation string, convert to structured error
  if (typeof result === 'string') {
    // planRename returns a string when ambiguous -- wrap in structured error
    const matches = graph.findByName(symbolName);
    return ambiguousSymbol(
      symbolName,
      matches.map(m => ({ name: m.name, file: m.file })),
    ).toJSON();
  }

  return formatRenameResult(result);
}

// ─── recon_export ─────────────────────────────────────────────

function handleExport(
  args: Record<string, unknown>,
  graph: KnowledgeGraph,
): string {
  const options: ExportOptions = {
    format: 'mermaid',
    symbol: args?.target as string | undefined,
    depth: (args?.depth as number) || 2,
    limit: (args?.limit as number) || 30,
    skipFiles: true,
    direction: (args?.direction as 'TD' | 'LR') || 'TD',
  };

  // Map scope to appropriate option
  const scope = args?.scope as string | undefined;
  if (scope === 'package' && args?.target) {
    options.package = args.target as string;
    options.symbol = undefined; // use package filter, not ego graph
  }

  const output = exportGraph(graph, options);

  const nodeCount = output.split('\n').filter((l: string) => l.includes('[') || l.includes('label=')).length;
  return `# Export (mermaid)\n\n\`\`\`mermaid\n${output}\n\`\`\`\n\n_${nodeCount} nodes rendered._`;
}

// ─── recon_rules ──────────────────────────────────────────────

function handleRules(
  args: Record<string, unknown>,
  graph: KnowledgeGraph,
): string {
  const VALID_RULES: RuleName[] = ['dead_code', 'unused_exports', 'circular_deps', 'large_files', 'orphans'];

  const ruleArg = args?.rule as string | undefined;

  if (ruleArg && !VALID_RULES.includes(ruleArg as RuleName)) {
    return invalidParameter('rule', ruleArg, VALID_RULES).toJSON();
  }

  // If a specific rule is requested, run only that one
  if (ruleArg) {
    const result = runRule(graph, ruleArg as RuleName);
    return formatRuleResult(result);
  }

  // Run all rules and combine output
  const lines: string[] = ['# Code Quality Report', ''];

  let totalIssues = 0;
  for (const rule of VALID_RULES) {
    const result = runRule(graph, rule);
    totalIssues += result.count;
    lines.push(formatRuleResult(result));
    lines.push('');
  }

  lines.unshift(''); // add blank after header
  lines.splice(1, 0, `**Total issues:** ${totalIssues}`);

  return lines.join('\n');
}
