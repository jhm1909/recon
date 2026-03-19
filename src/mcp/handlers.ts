/**
 * MCP Tool Handlers
 *
 * Dispatches tool calls to the appropriate query functions.
 */

import { execSync } from 'node:child_process';
import { KnowledgeGraph } from '../graph/graph.js';
import { NodeType, RelationshipType, Language } from '../graph/types.js';
import type { Node, Relationship } from '../graph/types.js';
import { BM25Index } from '../search/bm25.js';
import { VectorStore } from '../search/vector-store.js';
import { mergeWithRRF } from '../search/hybrid-search.js';
import type { HybridSearchResult } from '../search/hybrid-search.js';
import { embedText, isEmbedderReady } from '../search/embedder.js';
import { planRename, formatRenameResult } from './rename.js';
import type { RenameResult } from './rename.js';
import { executeQuery as executeCypherQuery, formatResultAsMarkdown } from '../query/index.js';
import { listRepos } from '../storage/store.js';
import { detectProcesses, type Process } from '../graph/process.js';
import { augment } from './augmentation.js';
import { watcherStatus } from '../watcher/watcher.js';

/**
 * Filter a graph to only include nodes belonging to a specific repo.
 * Returns a new graph with only matching nodes and their relationships.
 */
function filterGraphByRepo(graph: KnowledgeGraph, repo: string): KnowledgeGraph {
  const filtered = new KnowledgeGraph();

  for (const node of graph.nodes.values()) {
    if (node.repo === repo) {
      filtered.addNode(node);
    }
  }

  for (const rel of graph.relationships.values()) {
    if (filtered.getNode(rel.sourceId) && filtered.getNode(rel.targetId)) {
      filtered.addRelationship(rel);
    }
  }

  return filtered;
}

/**
 * Apply repo filter if specified in args.
 */
function maybeFilterByRepo(
  args: Record<string, unknown> | undefined,
  graph: KnowledgeGraph,
): KnowledgeGraph {
  const repo = args?.repo as string | undefined;
  if (repo) {
    return filterGraphByRepo(graph, repo);
  }
  return graph;
}

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
  switch (name) {
    case 'recon_packages':
      return handlePackages(args, graph);

    case 'recon_impact':
      return handleImpact(args, graph);

    case 'recon_context':
      return handleContext(args, graph);

    case 'recon_query':
      return handleQuery(args, graph, vectorStore ?? null);

    case 'recon_detect_changes':
      return handleDetectChanges(args, graph);

    case 'recon_api_map':
      return handleApiMap(args, graph);

    case 'recon_rename':
      return handleRename(args, graph);

    case 'recon_query_graph':
      return handleQueryGraph(args, graph);

    case 'recon_list_repos':
      return handleListRepos(projectRoot);

    case 'recon_processes':
      return handleProcesses(args, graph);

    case 'recon_augment':
      return handleAugment(args, graph);

    case 'recon_watcher_status':
      return formatWatcherStatus();

    case 'recon_export':
      return handleExport(args, graph);

    case 'recon_pr_review':
      return handlePRReview(args, graph);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ??? recon_packages ????????????????????????????????????????????

function handlePackages(
  args: Record<string, unknown> | undefined,
  graph: KnowledgeGraph,
): string {
  const langFilter = (args?.language as string) || 'all';
  graph = maybeFilterByRepo(args, graph);

  // Collect package nodes
  const packages: Node[] = [];
  for (const node of graph.nodes.values()) {
    if (node.type !== NodeType.Package) continue;

    if (langFilter === 'go' && node.language !== Language.Go) continue;
    if (langFilter === 'typescript' && node.language !== Language.TypeScript) continue;

    packages.push(node);
  }

  // Sort by package path
  packages.sort((a, b) => a.package.localeCompare(b.package));

  // Count total relationships
  const totalRels = graph.relationshipCount;

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

  // Format output
  const lines: string[] = [
    `# Recon ??Package Overview`,
    '',
    `**Stats:** ${packages.length} packages, ${totalRels} relationships`,
    '',
  ];

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

// ??? recon_impact ??????????????????????????????????????????????

function handleImpact(
  args: Record<string, unknown> | undefined,
  graph: KnowledgeGraph,
): string {
  const target = args?.target as string;
  const direction = args?.direction as string;

  if (!target) throw new Error("Symbol 'target' is required.");
  if (!direction || !['upstream', 'downstream'].includes(direction)) {
    throw new Error("Invalid direction. Use 'upstream' or 'downstream'.");
  }

  graph = maybeFilterByRepo(args, graph);

  const maxDepth = (args?.maxDepth as number) || 3;
  const includeTests = (args?.includeTests as boolean) || false;
  const minConfidence = (args?.minConfidence as number) || 0;
  const relationTypes = args?.relationTypes as string[] | undefined;
  const fileFilter = args?.file as string;

  // Find target node
  let matches = graph.findByName(target);
  if (matches.length === 0) {
    throw new Error(`Symbol '${target}' not found. Try recon_query({query: "${target}"}) to search.`);
  }

  // Apply file filter if provided
  if (fileFilter) {
    matches = matches.filter(n => n.file.includes(fileFilter));
    if (matches.length === 0) {
      throw new Error(`Symbol '${target}' not found in file matching '${fileFilter}'.`);
    }
  }

  // If still ambiguous, prefer exact case match + exported symbols
  if (matches.length > 1) {
    const exact = matches.filter(n => n.name === target);
    if (exact.length > 0) matches = exact;
  }
  if (matches.length > 1) {
    const exported = matches.filter(n => n.exported);
    if (exported.length > 0) matches = exported;
  }

  if (matches.length > 1) {
    return formatDisambiguation(target, matches);
  }

  const targetNode = matches[0];

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
    }>;
  }> = [];

  const depthLabels = [
    '',
    'WILL BREAK ??direct callers/importers',
    'LIKELY AFFECTED ??indirect dependents',
    'MAY NEED TESTING ??transitive',
  ];

  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const nextFrontier: string[] = [];
    const symbols: typeof byDepth[0]['symbols'] = [];

    for (const nodeId of frontier) {
      const edges = direction === 'upstream'
        ? graph.getIncoming(nodeId)
        : graph.getOutgoing(nodeId);

      for (const edge of edges) {
        if (relationTypes && !relationTypes.includes(edge.type)) continue;
        if (edge.confidence < minConfidence) continue;

        const neighborId = direction === 'upstream' ? edge.sourceId : edge.targetId;
        if (visited.has(neighborId)) continue;

        const neighbor = graph.getNode(neighborId);
        if (!neighbor) continue;
        if (!includeTests && isTestFile(neighbor.file)) continue;

        visited.add(neighborId);
        nextFrontier.push(neighborId);
        symbols.push({
          name: neighbor.name,
          type: neighbor.type,
          file: neighbor.file,
          line: neighbor.startLine,
          edgeType: edge.type,
          confidence: edge.confidence,
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

  // Risk calculation
  // Risk calculation — weighted by confidence
  const d1Count = byDepth.find(d => d.depth === 1)?.symbols.length || 0;
  const allSymbols = byDepth.flatMap(d => d.symbols);
  const crossApp = new Set(allSymbols
    .map(s => s.file.match(/^apps\/([^/]+)/)?.[1])
    .filter(Boolean)
  ).size > 1;

  // Confidence breakdown
  const highConf = allSymbols.filter(s => s.confidence >= 0.9);
  const medConf = allSymbols.filter(s => s.confidence >= 0.7 && s.confidence < 0.9);
  const lowConf = allSymbols.filter(s => s.confidence < 0.7);

  // Risk = weighted by confidence (high-confidence direct deps are riskier)
  const d1HighConf = byDepth.find(d => d.depth === 1)?.symbols
    .filter(s => s.confidence >= 0.9).length || 0;

  let risk: string;
  if (d1HighConf >= 20 || crossApp) risk = '🔴 CRITICAL';
  else if (d1HighConf >= 10 || d1Count >= 20) risk = '🟠 HIGH';
  else if (d1Count >= 3) risk = '🟡 MEDIUM';
  else risk = '🟢 LOW';

  const totalAffected = allSymbols.length;

  // Collect affected communities
  const affectedCommunities = new Set<string>();
  if (targetNode.community) affectedCommunities.add(targetNode.community);
  for (const sym of allSymbols) {
    for (const node of graph.nodes.values()) {
      if (node.name === sym.name && node.file === sym.file && node.community) {
        affectedCommunities.add(node.community);
      }
    }
  }

  // Confidence tier label
  const confLabel = (c: number) =>
    c >= 0.9 ? '🔴' : c >= 0.7 ? '🟡' : '🟢';
  const confTier = (c: number) =>
    c >= 0.9 ? 'CERTAIN' : c >= 0.7 ? 'LIKELY' : 'POSSIBLE';

  // Format
  const lines: string[] = [
    `# Impact Analysis: ${targetNode.name}`,
    '',
    `**Target:** ${targetNode.name} (${targetNode.type}) →\`${targetNode.file}:${targetNode.startLine}\``,
    `**Direction:** ${direction}`,
    `**Risk:** ${risk}`,
    `**Summary:** ${d1Count} direct ${direction === 'upstream' ? 'callers' : 'callees'}, ${totalAffected} total affected`,
    `**Confidence:** 🔴 ${highConf.length} certain, 🟡 ${medConf.length} likely, 🟢 ${lowConf.length} possible`,
    ...(affectedCommunities.size > 0
      ? [`**Affected communities:** ${Array.from(affectedCommunities).join(', ')} (${affectedCommunities.size})`]
      : []),
    '',
  ];

  for (const group of byDepth) {
    lines.push(`## d=${group.depth}: ${group.label} (${group.symbols.length})`);
    lines.push('');

    // Sort by confidence descending within each depth group
    const sorted = [...group.symbols].sort((a, b) => b.confidence - a.confidence);
    for (const sym of sorted) {
      lines.push(`- ${confLabel(sym.confidence)} **${sym.name}** (${sym.type}) →\`${sym.file}:${sym.line}\` [${sym.edgeType}, ${confTier(sym.confidence)} ${Math.round(sym.confidence * 100)}%]`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ??? recon_context ?????????????????????????????????????????????

function handleContext(
  args: Record<string, unknown> | undefined,
  graph: KnowledgeGraph,
): string {
  const name = args?.name as string;
  const fileFilter = args?.file as string;

  if (!name) throw new Error("Symbol 'name' is required.");

  graph = maybeFilterByRepo(args, graph);

  let matches = graph.findByName(name);

  if (fileFilter) {
    matches = matches.filter(n => n.file.includes(fileFilter));
  }

  if (matches.length === 0) {
    throw new Error(`Symbol '${name}' not found. Try recon_query({query: "${name}"}) to search.`);
  }

  if (matches.length > 1 && !fileFilter) {
    return formatDisambiguation(name, matches);
  }

  const node = matches[0];
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
        lines.push(`- ${ref.name} ??\`${ref.file}:${ref.line}\` [${ref.edgeType}]`);
      }
    }
    lines.push('');
  }

  // Process participation — show which execution flows this symbol is in
  const allProcesses = detectProcesses(graph, { limit: 50 });
  const participating: Array<{ processName: string; stepIndex: number; totalSteps: number }> = [];
  for (const proc of allProcesses) {
    // Check if entry point matches
    if (proc.entryPoint.name === node.name && proc.entryPoint.file === node.file) {
      participating.push({ processName: proc.name, stepIndex: 0, totalSteps: proc.steps.length });
      continue;
    }
    // Check steps
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

  return lines.join('\n');
}

// ??? recon_query ???????????????????????????????????????????????

// Lazy-initialized BM25 index (rebuilt when graph is mutated)
let _searchIndex: BM25Index | null = null;
let _searchGraphVersion = -1;

function getSearchIndex(graph: KnowledgeGraph): BM25Index {
  if (_searchIndex && _searchGraphVersion === graph.version) {
    return _searchIndex;
  }
  _searchIndex = BM25Index.buildFromGraph(graph);
  _searchGraphVersion = graph.version;
  return _searchIndex;
}

async function handleQuery(
  args: Record<string, unknown> | undefined,
  graph: KnowledgeGraph,
  vectorStore: VectorStore | null,
): Promise<string> {
  const rawQuery = args?.query as string;
  const typeFilter = args?.type as string;
  const pkgFilter = args?.package as string;
  const langFilter = args?.language as string;
  const semanticEnabled = (args?.semantic as boolean) ?? true;
  const limit = (args?.limit as number) || 20;

  if (!rawQuery) throw new Error("'query' parameter is required.");

  graph = maybeFilterByRepo(args, graph);

  const queryLower = rawQuery.toLowerCase();

  // BM25 search
  const searchIndex = getSearchIndex(graph);
  const bm25Hits = searchIndex.search(rawQuery, limit * 3);

  // Attempt hybrid search if vector store is available and semantic enabled
  let hybridResults: HybridSearchResult[] | null = null;
  if (semanticEnabled && vectorStore && vectorStore.size > 0) {
    try {
      const queryEmb = isEmbedderReady()
        ? await embedText(rawQuery)
        : null;

      if (queryEmb) {
        hybridResults = mergeWithRRF(bm25Hits, vectorStore.search(queryEmb, limit * 3), limit * 3);
      }
    } catch {
      // Fall through to BM25-only
    }
  }

  const seen = new Set<string>();
  const matches: Array<{ node: Node; score: number; sources?: ('bm25' | 'semantic')[] }> = [];

  if (hybridResults) {
    // Use hybrid results
    for (const hit of hybridResults) {
      const node = graph.getNode(hit.nodeId);
      if (!node) continue;
      if (node.type === NodeType.File) continue;

      if (typeFilter && node.type !== typeFilter) continue;
      if (pkgFilter && !node.package.includes(pkgFilter)) continue;
      if (langFilter && node.language !== langFilter) continue;

      seen.add(node.id);
      matches.push({ node, score: hit.score, sources: hit.sources });
    }
  } else {
    // BM25-only path
    for (const hit of bm25Hits) {
      const node = graph.getNode(hit.nodeId);
      if (!node) continue;
      if (node.type === NodeType.File) continue;

      if (typeFilter && node.type !== typeFilter) continue;
      if (pkgFilter && !node.package.includes(pkgFilter)) continue;
      if (langFilter && node.language !== langFilter) continue;

      seen.add(node.id);
      matches.push({ node, score: hit.score });
    }
  }

  // Substring fallback for nodes both BM25 and hybrid missed
  for (const node of graph.nodes.values()) {
    if (seen.has(node.id)) continue;
    if (node.type === NodeType.File) continue;

    const nameLower = node.name.toLowerCase();
    if (!nameLower.includes(queryLower)) continue;

    if (typeFilter && node.type !== typeFilter) continue;
    if (pkgFilter && !node.package.includes(pkgFilter)) continue;
    if (langFilter && node.language !== langFilter) continue;

    let score = 0.1;
    if (nameLower === queryLower) score = 0.3;
    else if (nameLower.startsWith(queryLower)) score = 0.2;

    seen.add(node.id);
    matches.push({ node, score });
  }

  // Sort by score desc, then name
  matches.sort((a, b) => b.score - a.score || a.node.name.localeCompare(b.node.name));
  const results = matches.slice(0, limit);

  const searchMode = hybridResults ? 'hybrid (BM25 + semantic)' : 'BM25';

  const lines: string[] = [
    `# Query: "${args?.query}"`,
    '',
    `**Matches:** ${matches.length}${matches.length > limit ? ` (showing ${limit})` : ''}`,
    `**Search:** ${searchMode}`,
    '',
  ];

  for (const { node, sources } of results) {
    const callerCount = graph.getIncoming(node.id, RelationshipType.CALLS).length;
    const calleeCount = graph.getOutgoing(node.id, RelationshipType.CALLS).length;
    const srcTag = sources ? ` [${sources.join('+')}]` : '';

    lines.push(
      `- **${node.name}** (${node.type}) ??\`${node.file}:${node.startLine}\` | ${node.language} | ` +
      `callers: ${callerCount}, callees: ${calleeCount}${node.exported ? '' : ' [unexported]'}${srcTag}`,
    );
  }

  return lines.join('\n');
}

// ??? recon_detect_changes ??????????????????????????????????????

interface DiffHunk {
  file: string;
  startLine: number;
  lineCount: number;
}

function parseGitDiff(projectRoot: string, scope: string, base: string): DiffHunk[] {
  let diffCmd: string;

  switch (scope) {
    case 'staged':
      diffCmd = 'git diff --cached --unified=0';
      break;
    case 'unstaged':
      diffCmd = 'git diff --unified=0';
      break;
    case 'branch':
      diffCmd = `git diff ${base}...HEAD --unified=0`;
      break;
    case 'all':
    default:
      diffCmd = 'git diff HEAD --unified=0';
      break;
  }

  let output: string;
  try {
    output = execSync(diffCmd, { cwd: projectRoot, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
  } catch {
    return [];
  }

  if (!output.trim()) return [];

  const hunks: DiffHunk[] = [];
  let currentFile = '';

  for (const line of output.split('\n')) {
    // Match file header: +++ b/apps/api/handler/guild.go
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch) {
      currentFile = fileMatch[1];
      continue;
    }

    // Match hunk header: @@ -10,5 +10,8 @@
    const hunkMatch = line.match(/^@@ .+ \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch && currentFile) {
      hunks.push({
        file: currentFile,
        startLine: parseInt(hunkMatch[1], 10),
        lineCount: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
      });
    }
  }

  return hunks;
}

function getChangedFiles(projectRoot: string, scope: string, base: string): string[] {
  let cmd: string;

  switch (scope) {
    case 'staged':
      cmd = 'git diff --cached --name-only';
      break;
    case 'unstaged':
      cmd = 'git diff --name-only';
      break;
    case 'branch':
      cmd = `git diff ${base}...HEAD --name-only`;
      break;
    case 'all':
    default:
      cmd = 'git diff HEAD --name-only';
      break;
  }

  try {
    const output = execSync(cmd, { cwd: projectRoot, encoding: 'utf-8' });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function findProjectRoot(): string {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
  } catch {
    return process.cwd();
  }
}

function handleDetectChanges(
  args: Record<string, unknown> | undefined,
  graph: KnowledgeGraph,
): string {
  const scope = (args?.scope as string) || 'all';
  const base = (args?.base as string) || 'main';
  const projectRoot = findProjectRoot();

  graph = maybeFilterByRepo(args, graph);

  // 1. Get changed files and diff hunks
  const changedFiles = getChangedFiles(projectRoot, scope, base);
  if (changedFiles.length === 0) {
    return [
      '# Change Detection',
      '',
      `**Scope:** ${scope}${scope === 'branch' ? ` (base: ${base})` : ''}`,
      '',
      '_No changes detected._',
    ].join('\n');
  }

  const hunks = parseGitDiff(projectRoot, scope, base);

  // 2. Map changed files to graph nodes
  interface ChangedSymbol {
    node: Node;
    reason: 'modified' | 'in_changed_file';
  }

  const changedSymbols: ChangedSymbol[] = [];
  const changedFileSet = new Set(changedFiles);

  for (const node of graph.nodes.values()) {
    if (node.type === NodeType.Package) continue;

    // Check if node's file was changed
    if (!changedFileSet.has(node.file)) continue;

    // Check if specific lines were modified (for symbols with line info)
    if (node.startLine > 0 && node.endLine > 0) {
      const directlyModified = hunks.some(
        h => h.file === node.file &&
          h.startLine <= node.endLine &&
          (h.startLine + h.lineCount - 1) >= node.startLine,
      );

      changedSymbols.push({
        node,
        reason: directlyModified ? 'modified' : 'in_changed_file',
      });
    } else {
      changedSymbols.push({ node, reason: 'in_changed_file' });
    }
  }

  // Deduplicate: prefer 'modified' over 'in_changed_file'
  const symbolMap = new Map<string, ChangedSymbol>();
  for (const cs of changedSymbols) {
    const existing = symbolMap.get(cs.node.id);
    if (!existing || cs.reason === 'modified') {
      symbolMap.set(cs.node.id, cs);
    }
  }

  const uniqueSymbols = Array.from(symbolMap.values());
  const directlyModified = uniqueSymbols.filter(s => s.reason === 'modified');

  // 3. Trace blast radius for directly modified symbols
  interface AffectedSymbol {
    node: Node;
    depth: number;
    edgeType: string;
    via: string; // which changed symbol triggered this
  }

  const affected: AffectedSymbol[] = [];
  const affectedIds = new Set<string>();

  // Add all changed symbols to visited set
  for (const cs of uniqueSymbols) {
    affectedIds.add(cs.node.id);
  }

  for (const cs of directlyModified) {
    // BFS upstream from each modified symbol
    let frontier = [cs.node.id];
    const visited = new Set<string>([cs.node.id]);

    for (let depth = 1; depth <= 2 && frontier.length > 0; depth++) {
      const next: string[] = [];

      for (const nodeId of frontier) {
        const incoming = graph.getIncoming(nodeId);

        for (const edge of incoming) {
          if (visited.has(edge.sourceId)) continue;
          visited.add(edge.sourceId);

          const neighbor = graph.getNode(edge.sourceId);
          if (!neighbor) continue;
          if (isTestFile(neighbor.file)) continue;

          if (!affectedIds.has(neighbor.id)) {
            affectedIds.add(neighbor.id);
            affected.push({
              node: neighbor,
              depth,
              edgeType: edge.type,
              via: cs.node.name,
            });
          }

          next.push(edge.sourceId);
        }
      }

      frontier = next;
    }
  }

  // 4. Risk assessment
  const d1 = affected.filter(a => a.depth === 1);
  const d2 = affected.filter(a => a.depth === 2);

  const allAffectedFiles = new Set([
    ...changedFiles,
    ...affected.map(a => a.node.file),
  ]);
  const affectedApps = new Set(
    Array.from(allAffectedFiles)
      .map(f => f.match(/^apps\/([^/]+)/)?.[1])
      .filter(Boolean),
  );
  const crossApp = affectedApps.size > 1;

  let risk: string;
  if (d1.length >= 20 || crossApp) risk = 'CRITICAL';
  else if (d1.length >= 10) risk = 'HIGH';
  else if (d1.length >= 3) risk = 'MEDIUM';
  else risk = 'LOW';

  // 5. Format output
  const lines: string[] = [
    '# Change Detection',
    '',
    `**Scope:** ${scope}${scope === 'branch' ? ` (base: ${base})` : ''}`,
    `**Risk:** ${risk}`,
    `**Changed files:** ${changedFiles.length}`,
    `**Changed symbols:** ${directlyModified.length} modified, ${uniqueSymbols.length - directlyModified.length} in changed files`,
    `**Affected symbols:** ${d1.length} direct (d=1), ${d2.length} indirect (d=2)`,
    '',
  ];

  // Changed files summary
  lines.push('## Changed Files');
  lines.push('');
  for (const f of changedFiles) {
    const symbolsInFile = uniqueSymbols.filter(s => s.node.file === f);
    const modCount = symbolsInFile.filter(s => s.reason === 'modified').length;
    lines.push(`- \`${f}\` ??${symbolsInFile.length} symbols${modCount > 0 ? ` (${modCount} directly modified)` : ''}`);
  }
  lines.push('');

  // Directly modified symbols
  if (directlyModified.length > 0) {
    lines.push('## Directly Modified Symbols');
    lines.push('');
    for (const cs of directlyModified) {
      const callerCount = graph.getIncoming(cs.node.id, RelationshipType.CALLS).length;
      lines.push(
        `- **${cs.node.name}** (${cs.node.type}) ??\`${cs.node.file}:${cs.node.startLine}\` | ${callerCount} callers`,
      );
    }
    lines.push('');
  }

  // d=1 affected
  if (d1.length > 0) {
    lines.push(`## d=1: WILL BREAK ??direct dependents (${d1.length})`);
    lines.push('');
    for (const a of d1) {
      lines.push(
        `- **${a.node.name}** (${a.node.type}) ??\`${a.node.file}:${a.node.startLine}\` [${a.edgeType} ??${a.via}]`,
      );
    }
    lines.push('');
  }

  // d=2 affected
  if (d2.length > 0) {
    lines.push(`## d=2: LIKELY AFFECTED ??indirect dependents (${d2.length})`);
    lines.push('');
    for (const a of d2) {
      lines.push(
        `- **${a.node.name}** (${a.node.type}) ??\`${a.node.file}:${a.node.startLine}\` [${a.edgeType} ??${a.via}]`,
      );
    }
    lines.push('');
  }

  // Cross-app warning
  if (crossApp) {
    lines.push('## ??Cross-App Impact');
    lines.push('');
    lines.push(`Affected apps: ${Array.from(affectedApps).join(', ')}`);
    lines.push('Changes span multiple applications ??coordinate carefully.');
    lines.push('');
  }

  return lines.join('\n');
}

// ??? recon_api_map ????????????????????????????????????????????

function handleApiMap(
  args: Record<string, unknown> | undefined,
  graph: KnowledgeGraph,
): string {
  const methodFilter = args?.method as string | undefined;
  const patternFilter = args?.pattern as string | undefined;
  const handlerFilter = args?.handler as string | undefined;

  graph = maybeFilterByRepo(args, graph);

  // Collect all CALLS_API edges
  const apiEdges: Array<{
    rel: Relationship;
    source: Node;
    target: Node;
  }> = [];

  for (const rel of graph.relationships.values()) {
    if (rel.type !== RelationshipType.CALLS_API) continue;

    const source = graph.getNode(rel.sourceId);
    const target = graph.getNode(rel.targetId);
    if (!source || !target) continue;

    // Apply filters
    if (methodFilter && rel.metadata?.httpMethod !== methodFilter) continue;
    if (patternFilter && !rel.metadata?.urlPattern?.includes(patternFilter)) continue;
    if (handlerFilter && !target.name.toLowerCase().includes(handlerFilter.toLowerCase())) continue;

    apiEdges.push({ rel, source, target });
  }

  // Also find Go handler methods that have no TS callers (for coverage audit)
  const handlersWithCallers = new Set(apiEdges.map(e => e.target.id));

  const allHandlers: Node[] = [];
  for (const node of graph.nodes.values()) {
    if (node.language !== Language.Go) continue;
    if (node.type !== NodeType.Method && node.type !== NodeType.Function) continue;
    // Heuristic: handler methods are in apps/api/handler/
    if (!node.file.includes('apps/api/handler')) continue;
    if (node.exported) {
      allHandlers.push(node);
    }
  }

  // Group by endpoint pattern
  const byEndpoint = new Map<string, {
    method: string;
    pattern: string;
    handler: Node;
    consumers: Node[];
  }>();

  for (const edge of apiEdges) {
    const key = `${edge.rel.metadata?.httpMethod} ${edge.rel.metadata?.urlPattern}`;
    const existing = byEndpoint.get(key);
    if (existing) {
      if (!existing.consumers.some(c => c.id === edge.source.id)) {
        existing.consumers.push(edge.source);
      }
    } else {
      byEndpoint.set(key, {
        method: edge.rel.metadata?.httpMethod || '?',
        pattern: edge.rel.metadata?.urlPattern || '?',
        handler: edge.target,
        consumers: [edge.source],
      });
    }
  }

  // Sort by pattern
  const endpoints = Array.from(byEndpoint.values())
    .sort((a, b) => a.pattern.localeCompare(b.pattern));

  const uncoveredHandlers = allHandlers.filter(h => !handlersWithCallers.has(h.id));

  // Format output
  const lines: string[] = [
    '# API Route Map',
    '',
    `**Total routes:** ${endpoints.length}`,
    `**Total handlers:** ${allHandlers.length}`,
    `**Handlers with TS consumers:** ${handlersWithCallers.size}`,
    `**Uncovered handlers:** ${uncoveredHandlers.length}`,
    '',
  ];

  if (methodFilter || patternFilter || handlerFilter) {
    const filters: string[] = [];
    if (methodFilter) filters.push(`method=${methodFilter}`);
    if (patternFilter) filters.push(`pattern~"${patternFilter}"`);
    if (handlerFilter) filters.push(`handler~"${handlerFilter}"`);
    lines.push(`**Filters:** ${filters.join(', ')}`);
    lines.push('');
  }

  // Endpoint details
  if (endpoints.length > 0) {
    lines.push('## Routes');
    lines.push('');

    for (const ep of endpoints) {
      lines.push(`### ${ep.method} ${ep.pattern}`);
      lines.push(`Handler: **${ep.handler.name}** ??\`${ep.handler.file}:${ep.handler.startLine}\``);

      if (ep.consumers.length > 0) {
        lines.push(`Consumers (${ep.consumers.length}):`);
        for (const c of ep.consumers) {
          lines.push(`  - ${c.name} ??\`${c.file}:${c.startLine}\``);
        }
      }
      lines.push('');
    }
  }

  // Uncovered handlers
  if (uncoveredHandlers.length > 0 && !methodFilter && !patternFilter && !handlerFilter) {
    lines.push('## Uncovered Handlers (no TS consumer found)');
    lines.push('');
    for (const h of uncoveredHandlers.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`- **${h.name}** ??\`${h.file}:${h.startLine}\``);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ??? Helpers ?????????????????????????????????????????????????????

function formatDisambiguation(name: string, matches: Node[]): string {
  const lines = [
    `Multiple symbols found for "${name}". Specify file to disambiguate.`,
    '',
    '**Candidates:**',
    '',
  ];

  for (const m of matches) {
    lines.push(`- **${m.name}** (${m.type}) ??\`${m.file}:${m.startLine}\` [${m.package}]`);
  }

  lines.push('');
  lines.push(`**Hint:** Call recon_context({name: "${name}", file: "${matches[0].file}"}) to select one.`);

  return lines.join('\n');
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
  return file.endsWith('_test.go') || file.endsWith('.test.ts') || file.endsWith('.test.tsx') || file.endsWith('.spec.ts') || file.endsWith('.spec.tsx');
}

// ─── recon_rename ───────────────────────────────────────────────

function handleRename(
  args: Record<string, unknown> | undefined,
  graph: KnowledgeGraph,
): string {
  const symbolName = args?.symbol_name as string;
  const newName = args?.new_name as string;
  const fileFilter = args?.file as string | undefined;
  const dryRun = (args?.dry_run as boolean) ?? true;

  if (!symbolName) throw new Error("'symbol_name' is required.");
  if (!newName) throw new Error("'new_name' is required.");

  graph = maybeFilterByRepo(args, graph);

  const result = planRename(graph, symbolName, newName, fileFilter, dryRun);

  // If planRename returned a disambiguation string, return it directly
  if (typeof result === 'string') {
    return result;
  }

  return formatRenameResult(result);
}

// ─── recon_query_graph ──────────────────────────────────────────

function handleQueryGraph(
  args: Record<string, unknown> | undefined,
  graph: KnowledgeGraph,
): string {
  const queryStr = args?.query as string;
  const limit = (args?.limit as number) || 50;

  if (!queryStr) throw new Error("'query' parameter is required.");

  graph = maybeFilterByRepo(args, graph);

  const result = executeCypherQuery(queryStr, graph, limit);

  const lines: string[] = [
    `# Graph Query`,
    '',
    `**Query:** \`${queryStr}\``,
    `**Results:** ${result.rowCount}${result.truncated ? ` (truncated at ${limit})` : ''}`,
    '',
    formatResultAsMarkdown(result),
  ];

  return lines.join('\n');
}

// ─── recon_list_repos ────────────────────────────────────────────

async function handleListRepos(projectRoot?: string): Promise<string> {
  if (!projectRoot) {
    projectRoot = findProjectRoot();
  }

  const repos = await listRepos(projectRoot);

  if (repos.length === 0) {
    return [
      '# Indexed Repos',
      '',
      '_No indexed repos found. Run `npx recon index` to index the current codebase._',
    ].join('\n');
  }

  const lines: string[] = [
    '# Indexed Repos',
    '',
    `**Total:** ${repos.length} repo(s)`,
    '',
  ];

  for (const repo of repos) {
    lines.push(`## ${repo.name}`);
    lines.push(`  Nodes: ${repo.nodeCount}`);
    lines.push(`  Relationships: ${repo.relationshipCount}`);
    lines.push(`  Indexed at: ${repo.meta.indexedAt}`);
    lines.push(`  Git: ${repo.meta.gitBranch}@${repo.meta.gitCommit}`);
    lines.push(`  Tree-sitter: ${repo.meta.stats.treeSitterFiles || 0} files, ${repo.meta.stats.treeSitterSymbols || 0} symbols`);
    lines.push(`  TS modules: ${repo.meta.stats.tsModules}, TS symbols: ${repo.meta.stats.tsSymbols}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ─── recon_processes ────────────────────────────────────────────

function handleProcesses(
  args: Record<string, unknown> | undefined,
  graph: KnowledgeGraph,
): string {
  const limit = (args?.limit as number) || 20;
  const filter = args?.filter as string | undefined;

  graph = maybeFilterByRepo(args, graph);

  const processes = detectProcesses(graph, { limit, filter });

  if (processes.length === 0) {
    return [
      '# Execution Flows',
      '',
      '_No execution flows detected._',
    ].join('\n');
  }

  const crossCount = processes.filter(p => p.processType === 'cross_community').length;

  const lines: string[] = [
    '# Execution Flows',
    '',
    `**Detected:** ${processes.length} flow(s)${crossCount > 0 ? ` (${crossCount} cross-community)` : ''}`,
    ...(filter ? [`**Filter:** "${filter}"`] : []),
    '',
    '| # | Flow | Type | Steps | Depth | Complexity |',
    '|---|------|------|-------|-------|------------|',
  ];

  for (let i = 0; i < processes.length; i++) {
    const p = processes[i];
    const tag = p.processType === 'cross_community' ? '🔀' : '📦';
    lines.push(
      `| ${i + 1} | **${p.label}** | ${tag} | ${p.steps.length} | ${p.depth} | ${p.complexity} |`,
    );
  }

  // Step traces for top flows (max 5)
  lines.push('');
  for (let i = 0; i < Math.min(processes.length, 5); i++) {
    const p = processes[i];
    const tag = p.processType === 'cross_community' ? '🔀 cross-community' : '📦 intra-community';
    lines.push(`## ${i + 1}. ${p.label}`);
    lines.push(`${tag} | Entry: \`${p.entryPoint.file}:${p.entryPoint.line}\` (${p.entryPoint.language})`);
    if (p.communities.length > 0) {
      lines.push(`Communities: ${p.communities.join(', ')}`);
    }
    lines.push('');
    lines.push('```');
    lines.push(`${p.entryPoint.name}`);
    for (const step of p.steps) {
      const indent = '  '.repeat(step.depth);
      lines.push(`${indent}→ ${step.name} (${step.file}:${step.line})`);
    }
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

// ─── recon_augment ──────────────────────────────────────────────

function handleAugment(
  args: Record<string, unknown> | undefined,
  graph: KnowledgeGraph,
): string {
  const pattern = args?.pattern as string;
  if (!pattern) throw new Error("'pattern' is required.");

  graph = maybeFilterByRepo(args, graph);

  const result = augment(pattern, graph);
  if (!result) {
    return `No graph context found for "${pattern}". Try recon_query({query: "${pattern}"}) for text search.`;
  }

  return result;
}

// ─── recon_watcher_status ─────────────────────────────────────────

function formatWatcherStatus(): string {
  const s = watcherStatus;

  const statusIcon = s.active ? '✅ Active' : '⏸️ Inactive';
  const uptime = s.startedAt
    ? `since ${s.startedAt}`
    : 'not started';

  const lines: string[] = [
    `## 🔄 Watcher Status`,
    '',
    `**Status:** ${statusIcon} (${uptime})`,
    `**Watching:** ${s.watchDirs.length > 0 ? s.watchDirs.join(', ') : 'none'}`,
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| Total updates | ${s.totalUpdates} |`,
    `| Pending queue | ${s.pendingCount} |`,
    `| Errors | ${s.errors.length} |`,
  ];

  if (s.lastUpdate) {
    lines.push('');
    lines.push(`**Last update:** \`${s.lastUpdate.file}\` (${s.lastUpdate.durationMs}ms) at ${s.lastUpdate.timestamp}`);
  }

  if (s.errors.length > 0) {
    lines.push('');
    lines.push('### Recent Errors');
    for (const err of s.errors.slice(-5)) {
      lines.push(`- \`${err.file}\`: ${err.error} (${err.timestamp})`);
    }
  }

  return lines.join('\n');
}

// ─── Export Handler ──────────────────────────────────────────────

function handleExport(
  args: Record<string, unknown> | undefined,
  graph: KnowledgeGraph,
): string {
  const { exportGraph } = require('../export/exporter.js');

  const format = ((args?.format as string) || 'mermaid') as 'mermaid' | 'dot';

  // Parse type filter
  const typeStr = args?.type as string | undefined;
  const types = typeStr
    ? typeStr.split(',').map(t => t.trim()).filter(t => Object.values(NodeType).includes(t as NodeType)) as NodeType[]
    : undefined;

  // Parse edge filter
  const edgeStr = args?.edges as string | undefined;
  const edges = edgeStr
    ? edgeStr.split(',').map(e => e.trim()).filter(e => Object.values(RelationshipType).includes(e as RelationshipType)) as RelationshipType[]
    : undefined;

  graph = maybeFilterByRepo(args, graph);

  const output = exportGraph(graph, {
    format,
    package: args?.package as string | undefined,
    types,
    symbol: args?.symbol as string | undefined,
    depth: args?.depth as number | undefined,
    edges,
    limit: (args?.limit as number) || 50,
    direction: args?.direction as 'TD' | 'LR' | undefined,
    skipFiles: true,
  });

  const nodeCount = output.split('\n').filter((l: string) => l.includes('[') || l.includes('label=')).length;
  return `# Export (${format})\n\n\`\`\`${format === 'mermaid' ? 'mermaid' : 'dot'}\n${output}\n\`\`\`\n\n_${nodeCount} nodes rendered._`;
}

// ─── PR Review Handler ──────────────────────────────────────────

function handlePRReview(
  args: Record<string, unknown> | undefined,
  graph: KnowledgeGraph,
): string {
  const { analyzeChanges, formatReview } = require('../review/reviewer.js');

  graph = maybeFilterByRepo(args, graph);

  const projectRoot = findProjectRoot();

  const options = {
    scope: (args?.scope as string) || 'all',
    base: (args?.base as string) || 'main',
    includeDiagram: (args?.include_diagram as boolean) ?? true,
    includeTests: (args?.include_tests as boolean) ?? false,
  };

  const result = analyzeChanges(graph, projectRoot, options);
  return formatReview(result, graph, options);
}
