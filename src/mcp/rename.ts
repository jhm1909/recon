/**
 * Rename Handler
 *
 * Multi-file coordinated rename using the knowledge graph.
 * Finds all references via graph relationships (callers, importers, etc.)
 * and generates an edit plan with confidence tags.
 */

import { KnowledgeGraph } from '../graph/graph.js';
import { NodeType, RelationshipType } from '../graph/types.js';
import type { Node, Relationship } from '../graph/types.js';

// ─── Types ──────────────────────────────────────────────────────

export interface RenameEdit {
  file: string;
  line: number;
  oldName: string;
  newName: string;
  confidence: 'graph' | 'text_search';
  context: string;  // description of why this ref was found
}

export interface RenameResult {
  oldName: string;
  newName: string;
  definition: { file: string; line: number } | null;
  edits: RenameEdit[];
  filesAffected: number;
  graphEdits: number;
  textSearchEdits: number;
  dryRun: boolean;
}

// ─── Rename Logic ───────────────────────────────────────────────

/**
 * Find all references to a symbol and generate a rename edit plan.
 */
export function planRename(
  graph: KnowledgeGraph,
  symbolName: string,
  newName: string,
  fileFilter?: string,
  dryRun: boolean = true,
): RenameResult | string {
  // Step 1: Find the target symbol
  let matches = graph.findByName(symbolName);

  if (matches.length === 0) {
    throw new Error(
      `Symbol '${symbolName}' not found. Try recon_query({query: "${symbolName}"}) to search.`,
    );
  }

  if (fileFilter) {
    matches = matches.filter(n => n.file.includes(fileFilter));
    if (matches.length === 0) {
      throw new Error(
        `Symbol '${symbolName}' not found in file matching '${fileFilter}'.`,
      );
    }
  }

  // Disambiguation
  if (matches.length > 1) {
    const exact = matches.filter(n => n.name === symbolName);
    if (exact.length > 0) matches = exact;
  }
  if (matches.length > 1) {
    const exported = matches.filter(n => n.exported);
    if (exported.length > 0) matches = exported;
  }

  if (matches.length > 1) {
    return formatDisambiguation(symbolName, matches);
  }

  const target = matches[0];

  if (target.name === newName) {
    throw new Error('New name is the same as the current name.');
  }

  // Step 2: Collect edits from graph relationships
  const edits: RenameEdit[] = [];
  const seenLocations = new Set<string>();

  const addEdit = (
    file: string,
    line: number,
    confidence: RenameEdit['confidence'],
    context: string,
  ) => {
    const key = `${file}:${line}`;
    if (seenLocations.has(key)) return;
    seenLocations.add(key);
    edits.push({
      file,
      line,
      oldName: target.name,
      newName,
      confidence,
      context,
    });
  };

  // The definition itself
  if (target.file && target.startLine > 0) {
    addEdit(target.file, target.startLine, 'graph', 'definition');
  }

  // All incoming relationships (callers, importers, etc.)
  const incoming = graph.getIncoming(target.id);
  for (const rel of incoming) {
    const source = graph.getNode(rel.sourceId);
    if (!source || !source.file) continue;
    addEdit(
      source.file,
      source.startLine,
      'graph',
      `${describeRelationship(rel.type)} by ${source.name}`,
    );
  }

  // Outgoing HAS_METHOD: if renaming a struct, its methods reference it
  if (target.type === NodeType.Struct || target.type === NodeType.Interface) {
    const outgoing = graph.getOutgoing(target.id, RelationshipType.HAS_METHOD);
    for (const rel of outgoing) {
      const method = graph.getNode(rel.targetId);
      if (!method || !method.file) continue;
      addEdit(
        method.file,
        method.startLine,
        'graph',
        `method ${method.name} on ${target.name}`,
      );
    }
  }

  // Outgoing IMPLEMENTS: if renaming an interface, implementers reference it
  if (target.type === NodeType.Interface) {
    const implementors = graph.getIncoming(target.id, RelationshipType.IMPLEMENTS);
    for (const rel of implementors) {
      const impl = graph.getNode(rel.sourceId);
      if (!impl || !impl.file) continue;
      addEdit(
        impl.file,
        impl.startLine,
        'graph',
        `implements ${target.name}`,
      );
    }
  }

  // Text search: find other nodes whose name contains the old name
  // (catches references the graph edges might miss)
  for (const node of graph.nodes.values()) {
    if (node.id === target.id) continue;
    if (node.type === NodeType.File || node.type === NodeType.Package) continue;
    if (!node.file || node.startLine <= 0) continue;

    // Check if this node's name references the target
    // e.g., a function called "validateUserToken" contains "User" if we're renaming User
    if (node.name !== target.name) continue;

    const key = `${node.file}:${node.startLine}`;
    if (seenLocations.has(key)) continue;

    addEdit(
      node.file,
      node.startLine,
      'text_search',
      `same-name symbol in ${node.package}`,
    );
  }

  // Sort edits: definition first, then by file and line
  edits.sort((a, b) => {
    if (a.context === 'definition') return -1;
    if (b.context === 'definition') return 1;
    return a.file.localeCompare(b.file) || a.line - b.line;
  });

  const filesAffected = new Set(edits.map(e => e.file)).size;
  const graphEdits = edits.filter(e => e.confidence === 'graph').length;
  const textSearchEdits = edits.filter(e => e.confidence === 'text_search').length;

  return {
    oldName: target.name,
    newName,
    definition: target.file && target.startLine > 0
      ? { file: target.file, line: target.startLine }
      : null,
    edits,
    filesAffected,
    graphEdits,
    textSearchEdits,
    dryRun,
  };
}

/**
 * Format a RenameResult as markdown for display.
 */
export function formatRenameResult(result: RenameResult): string {
  const lines: string[] = [
    `# Rename: ${result.oldName} → ${result.newName}`,
    '',
    `**Status:** ${result.dryRun ? 'DRY RUN (preview only)' : 'APPLIED'}`,
    `**Files affected:** ${result.filesAffected}`,
    `**Total edits:** ${result.edits.length} (${result.graphEdits} graph, ${result.textSearchEdits} text_search)`,
    '',
  ];

  if (result.edits.length === 0) {
    lines.push('_No references found in the graph._');
    return lines.join('\n');
  }

  // Group edits by file
  const byFile = new Map<string, RenameEdit[]>();
  for (const edit of result.edits) {
    if (!byFile.has(edit.file)) {
      byFile.set(edit.file, []);
    }
    byFile.get(edit.file)!.push(edit);
  }

  lines.push('## Edit Plan');
  lines.push('');

  for (const [file, fileEdits] of byFile) {
    lines.push(`### \`${file}\``);
    lines.push('');

    for (const edit of fileEdits) {
      const tag = edit.confidence === 'graph' ? 'graph' : 'text_search';
      lines.push(
        `- **Line ${edit.line}:** \`${edit.oldName}\` → \`${edit.newName}\` [${tag}] — ${edit.context}`,
      );
    }
    lines.push('');
  }

  if (result.dryRun) {
    lines.push('---');
    lines.push(`**To apply:** Call recon_rename({symbol_name: "${result.oldName}", new_name: "${result.newName}", dry_run: false})`);
  }

  return lines.join('\n');
}

// ─── Helpers ────────────────────────────────────────────────────

function describeRelationship(type: RelationshipType): string {
  switch (type) {
    case RelationshipType.CALLS: return 'called';
    case RelationshipType.IMPORTS: return 'imported';
    case RelationshipType.HAS_METHOD: return 'has method';
    case RelationshipType.IMPLEMENTS: return 'implemented';
    case RelationshipType.USES_COMPONENT: return 'used';
    case RelationshipType.CALLS_API: return 'API-called';
    case RelationshipType.CONTAINS: return 'contained';
    case RelationshipType.DEFINES: return 'defined';
    default: return 'referenced';
  }
}

function formatDisambiguation(name: string, matches: Node[]): string {
  const lines = [
    `Multiple symbols found for "${name}". Specify file to disambiguate.`,
    '',
    '**Candidates:**',
    '',
  ];

  for (const m of matches) {
    lines.push(`- **${m.name}** (${m.type}) — \`${m.file}:${m.startLine}\` [${m.package}]`);
  }

  lines.push('');
  lines.push(`**Hint:** Call recon_rename({symbol_name: "${name}", new_name: "<new>", file: "${matches[0].file}"}) to select one.`);

  return lines.join('\n');
}
