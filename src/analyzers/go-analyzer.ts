/**
 * Go Package Analyzer
 *
 * Discovers Go packages via `go list -json ./...` and builds
 * package-level nodes + import edges for the knowledge graph.
 * Also extracts symbol-level data (functions, methods, structs,
 * interfaces, calls) using the companion Go AST CLI.
 */

import { execSync, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { GoPackage, GoASTResult, AnalyzerResult } from './types.js';
import { NodeType, RelationshipType, Language } from '../graph/types.js';
import type { Node, Relationship } from '../graph/types.js';
import { hashFiles } from '../utils/hash.js';

/**
 * Run `go list -json ./...` and parse NDJSON output.
 * Returns empty array if Go toolchain is not available.
 */
export function runGoList(projectRoot: string): GoPackage[] {
  try {
    const output = execSync('go list -json ./...', {
      cwd: projectRoot,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10MB
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return parseNDJSON(output);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[codemap] Warning: go list failed — ${message.split('\n')[0]}`);
    return [];
  }
}

/**
 * Parse NDJSON (Newline-Delimited JSON) output from `go list -json`.
 * Each JSON object is separated by `}\n{` boundaries.
 */
function parseNDJSON(raw: string): GoPackage[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const results: GoPackage[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '{') depth++;
    if (trimmed[i] === '}') {
      depth--;
      if (depth === 0) {
        const chunk = trimmed.slice(start, i + 1);
        try {
          results.push(JSON.parse(chunk));
        } catch {
          // Skip malformed JSON chunks
        }
        start = i + 1;
        // Skip whitespace/newlines between objects
        while (start < trimmed.length && /\s/.test(trimmed[start])) start++;
      }
    }
  }

  return results;
}

/**
 * Extract Go module path from go.mod.
 */
export function getModulePath(projectRoot: string): string {
  try {
    const output = execSync('go list -m', {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output.trim();
  } catch {
    return 'github.com/Hubdustry/hubdustry';
  }
}

/**
 * Analyze Go packages and produce nodes + relationships.
 */
export function analyzeGoPackages(projectRoot: string): AnalyzerResult {
  const modulePath = getModulePath(projectRoot);
  const packages = runGoList(projectRoot);

  if (packages.length === 0) {
    return { nodes: [], relationships: [] };
  }

  const nodes: Node[] = [];
  const relationships: Relationship[] = [];

  // Filter to internal packages only
  const internalPkgs = packages.filter(
    (pkg) => pkg.ImportPath.startsWith(modulePath + '/'),
  );

  // Set of internal import paths for edge filtering
  const internalPaths = new Set(internalPkgs.map((p) => p.ImportPath));
  let relCounter = 0;

  for (const pkg of internalPkgs) {
    // Relative package path (e.g., "internal/auth")
    const pkgRelPath = pkg.ImportPath.slice(modulePath.length + 1);

    // Create Package node
    const pkgNodeId = `go:pkg:${pkgRelPath}`;
    const goFiles = pkg.GoFiles || [];

    nodes.push({
      id: pkgNodeId,
      type: NodeType.Package,
      name: pkg.Name,
      file: pkgRelPath,
      startLine: 0,
      endLine: 0,
      language: Language.Go,
      package: pkgRelPath,
      exported: true,
      importPath: pkg.ImportPath,
      files: goFiles,
      imports: (pkg.Imports || [])
        .filter((imp) => internalPaths.has(imp))
        .map((imp) => imp.slice(modulePath.length + 1)),
    });

    // Create File nodes + CONTAINS edges
    for (const goFile of goFiles) {
      const fileRelPath = `${pkgRelPath}/${goFile}`;
      const fileNodeId = `go:file:${fileRelPath}`;

      nodes.push({
        id: fileNodeId,
        type: NodeType.File,
        name: goFile,
        file: fileRelPath,
        startLine: 0,
        endLine: 0,
        language: Language.Go,
        package: pkgRelPath,
        exported: true,
      });

      relationships.push({
        id: `rel:${++relCounter}`,
        type: RelationshipType.CONTAINS,
        sourceId: pkgNodeId,
        targetId: fileNodeId,
        confidence: 1.0,
      });
    }

    // Create IMPORTS edges (internal only)
    for (const imp of pkg.Imports || []) {
      if (!internalPaths.has(imp)) continue;

      const impRelPath = imp.slice(modulePath.length + 1);
      const targetId = `go:pkg:${impRelPath}`;

      relationships.push({
        id: `rel:${++relCounter}`,
        type: RelationshipType.IMPORTS,
        sourceId: pkgNodeId,
        targetId,
        confidence: 1.0,
      });
    }
  }

  return { nodes, relationships };
}

// ─── Go AST Symbol Analysis ─────────────────────────────────────

/**
 * Build the Go AST analyzer binary if not already present.
 * Returns the binary path, or null if build fails.
 */
function getAnalyzerBinary(projectRoot: string): string | null {
  const analyzerDir = join(projectRoot, 'tools', 'codemap', 'analyzer');
  const ext = process.platform === 'win32' ? '.exe' : '';
  const binaryPath = join(analyzerDir, `analyzer${ext}`);

  if (!existsSync(join(analyzerDir, 'go.mod'))) {
    console.error('[codemap] Warning: analyzer source not found at tools/codemap/analyzer/');
    return null;
  }

  if (!existsSync(binaryPath)) {
    console.log('[codemap] Building Go AST analyzer...');
    try {
      execSync(`go build -o analyzer${ext} .`, {
        cwd: analyzerDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[codemap] Warning: failed to build analyzer — ${message.split('\\n')[0]}`);
      return null;
    }
  }

  return binaryPath;
}

/**
 * Analyze Go symbols (functions, methods, structs, interfaces, calls)
 * using the Go AST CLI extractor.
 *
 * Supports incremental indexing: packages whose files are unchanged
 * (by SHA-256 hash comparison) are skipped.
 */
export async function analyzeGoSymbols(
  projectRoot: string,
  packages: GoPackage[],
  modulePath: string,
  previousHashes?: Record<string, string>,
): Promise<{
  result: AnalyzerResult;
  fileHashes: Record<string, string>;
  stats: { analyzed: number; skipped: number };
}> {
  const binaryPath = getAnalyzerBinary(projectRoot);
  if (!binaryPath) {
    return {
      result: { nodes: [], relationships: [] },
      fileHashes: {},
      stats: { analyzed: 0, skipped: 0 },
    };
  }

  const internalPkgs = packages.filter(
    (pkg) => pkg.ImportPath.startsWith(modulePath + '/'),
  );

  // Collect all Go file absolute paths for hashing (exclude test files)
  const allGoFiles: string[] = [];
  for (const pkg of internalPkgs) {
    for (const goFile of pkg.GoFiles || []) {
      if (goFile.endsWith('_test.go')) continue;
      allGoFiles.push(join(pkg.Dir, goFile));
    }
  }

  // Hash all files for incremental comparison
  const absoluteHashes = await hashFiles(allGoFiles);

  // Convert to relative path hashes
  const fileHashes: Record<string, string> = {};
  for (const [absPath, hash] of Object.entries(absoluteHashes)) {
    const relPath = relative(projectRoot, absPath).replace(/\\/g, '/');
    fileHashes[relPath] = hash;
  }

  const nodes: Node[] = [];
  const relationships: Relationship[] = [];
  let relCounter = 0;
  let analyzedCount = 0;
  let skippedCount = 0;

  // Build import path → relative path map for cross-package call resolution
  const importPathToRelPath = new Map<string, string>();
  for (const pkg of internalPkgs) {
    const relPath = pkg.ImportPath.slice(modulePath.length + 1);
    importPathToRelPath.set(pkg.ImportPath, relPath);
  }

  for (const pkg of internalPkgs) {
    const pkgRelPath = pkg.ImportPath.slice(modulePath.length + 1);
    const goFiles = (pkg.GoFiles || []).filter((f) => !f.endsWith('_test.go'));

    if (goFiles.length === 0) continue;

    // Check if all files in this package are unchanged
    const pkgFilePaths = goFiles.map(
      (f) => `${pkgRelPath}/${f}`.replace(/\\/g, '/'),
    );
    const allUnchanged =
      previousHashes &&
      pkgFilePaths.length > 0 &&
      pkgFilePaths.every((fp) => fileHashes[fp] === previousHashes[fp]);

    if (allUnchanged) {
      skippedCount++;
      continue;
    }

    // Run analyzer on this package's files
    const absFiles = goFiles.map((f) => join(pkg.Dir, f));

    try {
      const output = execFileSync(binaryPath, ['-pkg', pkgRelPath, ...absFiles], {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const astResult: GoASTResult = JSON.parse(output);

      // Build local symbol sets for call resolution
      const localFuncs = new Set<string>();
      const localMethods = new Map<string, string>(); // "Recv.Method" → nodeId

      // Build import alias map: qualifier name → target package relative path
      const importAliasMap = new Map<string, string>();
      for (const imp of pkg.Imports || []) {
        if (!imp.startsWith(modulePath + '/')) continue;
        const impRelPath = imp.slice(modulePath.length + 1);
        // Use last segment as qualifier (matches Go's default import alias)
        const qualifier = impRelPath.split('/').pop() || '';
        importAliasMap.set(qualifier, impRelPath);
      }

      // First pass: create symbol nodes
      for (const file of astResult.files) {
        const fileRelPath = relative(projectRoot, file.path).replace(/\\/g, '/');
        const fileNodeId = `go:file:${fileRelPath}`;

        // Functions
        for (const fn of file.functions) {
          const funcNodeId = `go:func:${pkgRelPath}.${fn.name}`;
          localFuncs.add(fn.name);

          nodes.push({
            id: funcNodeId,
            type: NodeType.Function,
            name: fn.name,
            file: fileRelPath,
            startLine: fn.startLine,
            endLine: fn.endLine,
            language: Language.Go,
            package: pkgRelPath,
            exported: fn.exported,
            params: fn.params,
            returnType: fn.returns,
          });

          relationships.push({
            id: `rel:sym:${++relCounter}`,
            type: RelationshipType.DEFINES,
            sourceId: fileNodeId,
            targetId: funcNodeId,
            confidence: 1.0,
          });
        }

        // Methods
        for (const method of file.methods) {
          const recv = (method.receiver || 'unknown').replace('*', '');
          const methodNodeId = `go:method:${pkgRelPath}.${recv}.${method.name}`;
          localMethods.set(`${recv}.${method.name}`, methodNodeId);

          nodes.push({
            id: methodNodeId,
            type: NodeType.Method,
            name: method.name,
            file: fileRelPath,
            startLine: method.startLine,
            endLine: method.endLine,
            language: Language.Go,
            package: pkgRelPath,
            exported: method.exported,
            receiver: method.receiver,
            params: method.params,
            returnType: method.returns,
          });

          relationships.push({
            id: `rel:sym:${++relCounter}`,
            type: RelationshipType.DEFINES,
            sourceId: fileNodeId,
            targetId: methodNodeId,
            confidence: 1.0,
          });

          // HAS_METHOD: Struct → Method
          const structNodeId = `go:struct:${pkgRelPath}.${recv}`;
          relationships.push({
            id: `rel:sym:${++relCounter}`,
            type: RelationshipType.HAS_METHOD,
            sourceId: structNodeId,
            targetId: methodNodeId,
            confidence: 0.9,
          });
        }

        // Structs
        for (const st of file.structs) {
          const structNodeId = `go:struct:${pkgRelPath}.${st.name}`;

          nodes.push({
            id: structNodeId,
            type: NodeType.Struct,
            name: st.name,
            file: fileRelPath,
            startLine: st.startLine,
            endLine: st.endLine,
            language: Language.Go,
            package: pkgRelPath,
            exported: st.exported,
            fields: st.fields,
            embeds: st.embeds,
          });

          relationships.push({
            id: `rel:sym:${++relCounter}`,
            type: RelationshipType.DEFINES,
            sourceId: fileNodeId,
            targetId: structNodeId,
            confidence: 1.0,
          });
        }

        // Interfaces
        for (const iface of file.interfaces) {
          const ifaceNodeId = `go:iface:${pkgRelPath}.${iface.name}`;

          nodes.push({
            id: ifaceNodeId,
            type: NodeType.Interface,
            name: iface.name,
            file: fileRelPath,
            startLine: iface.startLine,
            endLine: iface.endLine,
            language: Language.Go,
            package: pkgRelPath,
            exported: iface.exported,
            methodSignatures: iface.methods,
          });

          relationships.push({
            id: `rel:sym:${++relCounter}`,
            type: RelationshipType.DEFINES,
            sourceId: fileNodeId,
            targetId: ifaceNodeId,
            confidence: 1.0,
          });
        }
      }

      // Second pass: resolve call edges
      for (const file of astResult.files) {
        for (const call of file.calls) {
          // Determine caller node ID
          let callerNodeId: string;
          if (call.callerRecv) {
            const recv = call.callerRecv.replace('*', '');
            callerNodeId = `go:method:${pkgRelPath}.${recv}.${call.callerFunc}`;
          } else {
            callerNodeId = `go:func:${pkgRelPath}.${call.callerFunc}`;
          }

          // Determine callee node ID + confidence
          let calleeNodeId: string;
          let confidence = 0.7;

          if (!call.qualifier) {
            // Direct call — same package function
            calleeNodeId = `go:func:${pkgRelPath}.${call.callee}`;
            if (localFuncs.has(call.callee)) {
              confidence = 1.0;
            }
          } else {
            const targetPkgRelPath = importAliasMap.get(call.qualifier);
            if (targetPkgRelPath) {
              // Cross-package call: qualifier matches an imported package
              calleeNodeId = `go:func:${targetPkgRelPath}.${call.callee}`;
              confidence = 0.9;
            } else if (localMethods.has(`${call.qualifier}.${call.callee}`)) {
              // Method call on a local type
              calleeNodeId = localMethods.get(`${call.qualifier}.${call.callee}`)!;
              confidence = 0.9;
            } else {
              // Unknown qualifier — variable method call, external pkg, etc.
              calleeNodeId = `go:func:${pkgRelPath}.${call.qualifier}.${call.callee}`;
              confidence = 0.5;
            }
          }

          relationships.push({
            id: `rel:sym:${++relCounter}`,
            type: RelationshipType.CALLS,
            sourceId: callerNodeId,
            targetId: calleeNodeId,
            confidence,
          });
        }
      }

      analyzedCount++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[codemap] Warning: analyzer failed for ${pkgRelPath} — ${message.split('\\n')[0]}`,
      );
    }
  }

  return {
    result: { nodes, relationships },
    fileHashes,
    stats: { analyzed: analyzedCount, skipped: skippedCount },
  };
}
