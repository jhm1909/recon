/**
 * Tree-sitter Symbol Extractor
 *
 * Parses source files with tree-sitter, runs S-expression queries,
 * and produces Recon graph nodes + relationships.
 */

import Parser from 'tree-sitter';
import { NodeType, RelationshipType, Language } from '../../graph/types.js';
import type { Node, Relationship } from '../../graph/types.js';
import type { AnalyzerResult } from '../types.js';
import { LANGUAGE_QUERIES } from './queries.js';
import { setParserLanguage, isLanguageAvailable } from './parser.js';

// ─── ID Prefixes ────────────────────────────────────────────────

const LANG_PREFIX: Record<Language, string> = {
  [Language.Python]: 'py',
  [Language.Rust]: 'rs',
  [Language.Java]: 'java',
  [Language.C]: 'c',
  [Language.Cpp]: 'cpp',
  [Language.Go]: 'go',
  [Language.TypeScript]: 'ts',
  [Language.Ruby]: 'rb',
  [Language.PHP]: 'php',
  [Language.CSharp]: 'cs',
  [Language.Kotlin]: 'kt',
  [Language.Swift]: 'swift',
};

// ─── Capture → NodeType Mapping ─────────────────────────────────

function captureToNodeType(captureMap: Record<string, unknown>): NodeType | null {
  if (captureMap['definition.function']) return NodeType.Function;
  if (captureMap['definition.class']) return NodeType.Class;
  if (captureMap['definition.struct']) return NodeType.Struct;
  if (captureMap['definition.interface']) return NodeType.Interface;
  if (captureMap['definition.method']) return NodeType.Method;
  if (captureMap['definition.constructor']) return NodeType.Method;
  if (captureMap['definition.enum']) return NodeType.Enum;
  if (captureMap['definition.trait']) return NodeType.Trait;
  if (captureMap['definition.impl']) return NodeType.Struct; // impl block → associated struct
  if (captureMap['definition.module']) return NodeType.Module;
  if (captureMap['definition.namespace']) return NodeType.Package;
  if (captureMap['definition.type']) return NodeType.Type;
  if (captureMap['definition.typedef']) return NodeType.Type;
  if (captureMap['definition.const']) return NodeType.Function; // treat as callable
  if (captureMap['definition.static']) return NodeType.Function;
  if (captureMap['definition.macro']) return NodeType.Function;
  if (captureMap['definition.union']) return NodeType.Struct;
  return null;
}

// ─── Export Detection ───────────────────────────────────────────

function isExported(name: string, language: Language, node?: any): boolean {
  switch (language) {
    case Language.Python:
      // Python: not starting with _ is public
      return !name.startsWith('_');
    case Language.Rust:
      // Rust: check for pub keyword in parent
      if (node?.parent?.type === 'visibility_modifier') return true;
      if (node?.parent?.children) {
        for (const child of node.parent.children) {
          if (child.type === 'visibility_modifier') return true;
        }
      }
      // Functions at module level starting with pub
      const parentText = node?.parent?.text?.slice(0, 20) || '';
      return parentText.startsWith('pub ') || parentText.startsWith('pub(');
    case Language.Java:
      // Java: check for public modifier
      if (node?.parent?.children) {
        for (const child of node.parent.children) {
          if (child.type === 'modifiers') {
            return child.text?.includes('public') ?? false;
          }
        }
      }
      return true; // default to exported for classes
    case Language.C:
    case Language.Cpp:
      // C/C++: everything in a header is exported, non-static in .c files
      return true;
    case Language.Ruby:
      // Ruby: methods starting with _ are private by convention
      return !name.startsWith('_');
    case Language.PHP:
      // PHP: check for public/protected/private keywords
      if (node?.parent?.children) {
        for (const child of node.parent.children) {
          if (child.type === 'visibility_modifier') {
            return child.text === 'public';
          }
        }
      }
      return true; // default to exported
    case Language.CSharp:
      // C#: check for public modifier
      if (node?.parent?.children) {
        for (const child of node.parent.children) {
          if (child.type === 'modifier') {
            if (child.text === 'private' || child.text === 'internal') return false;
          }
        }
      }
      return true;
    case Language.Kotlin:
      // Kotlin: check for private/internal modifiers
      if (node?.parent?.children) {
        for (const child of node.parent.children) {
          if (child.type === 'visibility_modifier') {
            return child.text === 'public' || child.text === undefined;
          }
        }
      }
      return true; // default public in Kotlin
    case Language.Swift:
      // Swift: check for access modifiers
      if (node?.parent?.children) {
        for (const child of node.parent.children) {
          if (child.type === 'modifiers') {
            if (child.text?.includes('private') || child.text?.includes('fileprivate')) return false;
          }
        }
      }
      return true;
    default:
      return true;
  }
}

// ─── Package/Directory Detection ────────────────────────────────

function getPackage(filePath: string, language: Language): string {
  // Use the directory as the "package"
  const lastSlash = filePath.lastIndexOf('/');
  if (lastSlash === -1) {
    const lastBackslash = filePath.lastIndexOf('\\');
    if (lastBackslash === -1) return '';
    return filePath.slice(0, lastBackslash).replace(/\\/g, '/');
  }
  return filePath.slice(0, lastSlash);
}

// ─── Main Extraction ────────────────────────────────────────────

export interface ExtractedSymbol {
  id: string;
  name: string;
  type: NodeType;
  file: string;
  startLine: number;
  endLine: number;
  language: Language;
  package: string;
  exported: boolean;
}

export interface ExtractedCall {
  callerFile: string;
  calleeName: string;
  line: number;
}

export interface ExtractedImport {
  file: string;
  source: string;
  line: number;
}

export interface ExtractedHeritage {
  childName: string;
  childFile: string;
  parentName: string;
  kind: 'extends' | 'implements' | 'trait';
}

export interface FileExtractionResult {
  symbols: ExtractedSymbol[];
  calls: ExtractedCall[];
  imports: ExtractedImport[];
  heritage: ExtractedHeritage[];
}

/**
 * Extract symbols, calls, imports, and heritage from a single file.
 */
export function extractFromFile(
  filePath: string,
  content: string,
  language: Language,
): FileExtractionResult {
  if (!isLanguageAvailable(language)) {
    return { symbols: [], calls: [], imports: [], heritage: [] };
  }

  const queryString = LANGUAGE_QUERIES[language];
  if (!queryString) {
    return { symbols: [], calls: [], imports: [], heritage: [] };
  }

  const parser = setParserLanguage(language);
  const tree = parser.parse(content);

  let query: Parser.Query;
  let matches: Parser.QueryMatch[];
  try {
    query = new Parser.Query(parser.getLanguage(), queryString);
    matches = query.matches(tree.rootNode);
  } catch {
    return { symbols: [], calls: [], imports: [], heritage: [] };
  }

  const prefix = LANG_PREFIX[language] || language;
  const pkg = getPackage(filePath, language);
  const symbols: ExtractedSymbol[] = [];
  const calls: ExtractedCall[] = [];
  const imports: ExtractedImport[] = [];
  const heritage: ExtractedHeritage[] = [];
  const seenDefs = new Set<string>();
  const seenHeritage = new Set<string>();

  for (const match of matches) {
    const captureMap: Record<string, any> = {};
    for (const c of match.captures) {
      captureMap[c.name] = c.node;
    }

    // ── Imports ──
    if (captureMap['import'] && captureMap['import.source']) {
      const sourceNode = captureMap['import.source'];
      imports.push({
        file: filePath,
        source: sourceNode.text.replace(/['"]/g, ''),
        line: sourceNode.startPosition.row + 1,
      });
      continue;
    }

    // ── Calls ──
    if (captureMap['call'] && captureMap['call.name'] && !captureMap['name']) {
      const callNode = captureMap['call.name'];
      calls.push({
        callerFile: filePath,
        calleeName: callNode.text,
        line: callNode.startPosition.row + 1,
      });
      continue;
    }

    // ── Heritage ──
    if (captureMap['heritage.class'] && (captureMap['heritage.extends'] || captureMap['heritage.implements'] || captureMap['heritage.trait'])) {
      const childName = captureMap['heritage.class'].text;
      if (captureMap['heritage.extends']) {
        const hKey = `${childName}:extends:${captureMap['heritage.extends'].text}`;
        if (!seenHeritage.has(hKey)) {
          seenHeritage.add(hKey);
          heritage.push({
            childName,
            childFile: filePath,
            parentName: captureMap['heritage.extends'].text,
            kind: 'extends',
          });
        }
      }
      if (captureMap['heritage.implements']) {
        const hKey = `${childName}:implements:${captureMap['heritage.implements'].text}`;
        if (!seenHeritage.has(hKey)) {
          seenHeritage.add(hKey);
          heritage.push({
            childName,
            childFile: filePath,
            parentName: captureMap['heritage.implements'].text,
            kind: 'implements',
          });
        }
      }
      if (captureMap['heritage.trait']) {
        const hKey = `${childName}:trait:${captureMap['heritage.trait'].text}`;
        if (!seenHeritage.has(hKey)) {
          seenHeritage.add(hKey);
          heritage.push({
            childName,
            childFile: filePath,
            parentName: captureMap['heritage.trait'].text,
            kind: 'trait',
          });
        }
      }
      // Heritage match may also define the symbol — fall through if @name exists
      if (!captureMap['name']) continue;
    }

    // ── Definitions ──
    const nameNode = captureMap['name'];
    if (!nameNode) continue;

    const nodeType = captureToNodeType(captureMap);
    if (!nodeType) continue;

    const name = nameNode.text;
    const defNode = getDefinitionNode(captureMap);
    const startLine = defNode ? defNode.startPosition.row + 1 : nameNode.startPosition.row + 1;
    const endLine = defNode ? defNode.endPosition.row + 1 : startLine;

    // Deduplicate (same name+line can match multiple query patterns)
    const dedupKey = `${name}:${startLine}`;
    if (seenDefs.has(dedupKey)) continue;
    seenDefs.add(dedupKey);

    const id = `${prefix}:${nodeTypeToIdSegment(nodeType)}:${filePath}:${name}:${startLine}`;

    symbols.push({
      id,
      name,
      type: nodeType,
      file: filePath,
      startLine,
      endLine,
      language,
      package: pkg,
      exported: isExported(name, language, defNode || nameNode),
    });
  }

  return { symbols, calls, imports, heritage };
}

/**
 * Build graph nodes and relationships from extracted file data.
 */
export function buildGraphFromExtractions(
  files: Map<string, FileExtractionResult>,
): AnalyzerResult {
  const nodes: Node[] = [];
  const relationships: Relationship[] = [];
  const symbolsByName = new Map<string, ExtractedSymbol[]>();

  // Pass 1: Create nodes and build name index
  for (const [filePath, result] of files) {
    for (const sym of result.symbols) {
      nodes.push({
        id: sym.id,
        type: sym.type,
        name: sym.name,
        file: sym.file,
        startLine: sym.startLine,
        endLine: sym.endLine,
        language: sym.language,
        package: sym.package,
        exported: sym.exported,
      });

      if (!symbolsByName.has(sym.name)) {
        symbolsByName.set(sym.name, []);
      }
      symbolsByName.get(sym.name)!.push(sym);
    }
  }

  // Pass 2: Resolve calls to CALLS relationships
  for (const [filePath, result] of files) {
    // Find caller symbols in this file
    const fileSymbols = result.symbols;

    for (const call of result.calls) {
      const targets = symbolsByName.get(call.calleeName);
      if (!targets || targets.length === 0) continue;

      // Find the enclosing function for this call
      const caller = findEnclosingSymbol(fileSymbols, call.line);
      if (!caller) continue;

      // Pick the best target (prefer different file, then first match)
      const target = targets.find(t => t.file !== filePath) || targets[0];
      if (target.id === caller.id) continue; // skip self-calls

      const relId = `${caller.id}-CALLS-${target.id}`;
      relationships.push({
        id: relId,
        type: RelationshipType.CALLS,
        sourceId: caller.id,
        targetId: target.id,
        confidence: 0.7, // tree-sitter name-based resolution
      });
    }
  }

  // Pass 3: Heritage → EXTENDS / IMPLEMENTS relationships
  for (const [, result] of files) {
    for (const h of result.heritage) {
      const children = symbolsByName.get(h.childName);
      const parents = symbolsByName.get(h.parentName);
      if (!children || !parents) continue;

      const child = children.find(s => s.file === h.childFile) || children[0];
      const parent = parents[0];

      const relType = h.kind === 'extends'
        ? RelationshipType.EXTENDS
        : RelationshipType.IMPLEMENTS;

      relationships.push({
        id: `${child.id}-${relType}-${parent.id}`,
        type: relType,
        sourceId: child.id,
        targetId: parent.id,
        confidence: 0.9,
      });
    }
  }

  // Pass 4: Method → Class HAS_METHOD relationships
  for (const [, result] of files) {
    const methods = result.symbols.filter(
      s => s.type === NodeType.Method,
    );
    const classes = result.symbols.filter(
      s => s.type === NodeType.Class || s.type === NodeType.Struct || s.type === NodeType.Trait,
    );

    if (classes.length === 0 || methods.length === 0) continue;

    for (const method of methods) {
      // Find the closest enclosing class (the class whose range contains this method)
      const enclosing = classes.find(
        c => c.startLine <= method.startLine && c.endLine >= method.endLine,
      );
      if (!enclosing) continue;

      relationships.push({
        id: `${enclosing.id}-HAS_METHOD-${method.id}`,
        type: RelationshipType.HAS_METHOD,
        sourceId: enclosing.id,
        targetId: method.id,
        confidence: 1.0,
      });
    }
  }

  return { nodes, relationships };
}

// ─── Helpers ────────────────────────────────────────────────────

function getDefinitionNode(captureMap: Record<string, any>): any | null {
  const defKeys = [
    'definition.function', 'definition.class', 'definition.struct',
    'definition.interface', 'definition.method', 'definition.constructor',
    'definition.enum', 'definition.trait', 'definition.impl',
    'definition.module', 'definition.namespace', 'definition.type',
    'definition.typedef', 'definition.const', 'definition.static',
    'definition.macro', 'definition.union',
  ];
  for (const key of defKeys) {
    if (captureMap[key]) return captureMap[key];
  }
  return null;
}

function nodeTypeToIdSegment(type: NodeType): string {
  switch (type) {
    case NodeType.Function: return 'func';
    case NodeType.Method: return 'method';
    case NodeType.Class: return 'class';
    case NodeType.Struct: return 'struct';
    case NodeType.Interface: return 'iface';
    case NodeType.Enum: return 'enum';
    case NodeType.Trait: return 'trait';
    case NodeType.Module: return 'mod';
    case NodeType.Package: return 'pkg';
    case NodeType.Type: return 'type';
    default: return 'sym';
  }
}

function findEnclosingSymbol(
  symbols: ExtractedSymbol[],
  line: number,
): ExtractedSymbol | null {
  // Find the narrowest function/method containing this line
  let best: ExtractedSymbol | null = null;
  for (const sym of symbols) {
    if (sym.type !== NodeType.Function && sym.type !== NodeType.Method) continue;
    if (sym.startLine <= line && sym.endLine >= line) {
      if (!best || (sym.endLine - sym.startLine) < (best.endLine - best.startLine)) {
        best = sym;
      }
    }
  }
  return best;
}
