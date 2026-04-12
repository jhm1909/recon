/**
 * Unit Tests: recon_rules
 *
 * Tests all 5 rules:
 *   dead_code, unused_exports, circular_deps, large_files, orphans
 *
 * Graph layout helpers follow the same makeNode/makeRel pattern used throughout
 * the test suite (see graph.test.ts, rename.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { KnowledgeGraph } from '../../src/graph/index.js';
import { NodeType, RelationshipType, Language } from '../../src/graph/index.js';
import type { Node, Relationship } from '../../src/graph/index.js';
import {
  runRule,
  findCircularDeps,
  formatRuleResult,
} from '../../src/mcp/rules.js';
import type { RuleResult } from '../../src/mcp/rules.js';

// ─── Helpers ────────────────────────────────────────────────────

function makeNode(id: string, name: string, overrides?: Partial<Node>): Node {
  return {
    id,
    type: NodeType.Function,
    name,
    file: 'src/test.ts',
    startLine: 1,
    endLine: 10,
    language: Language.TypeScript,
    package: 'src',
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

// ─── dead_code ──────────────────────────────────────────────────

describe('dead_code rule', () => {
  it('finds exported functions with no incoming edges', () => {
    const g = new KnowledgeGraph();
    // used: has an incoming CALLS edge from another node
    g.addNode(makeNode('fn:A', 'UsedFn', { file: 'src/a.ts', exported: true }));
    g.addNode(makeNode('fn:B', 'CallerFn', { file: 'src/b.ts', exported: true }));
    // unused: no incoming edges
    g.addNode(makeNode('fn:C', 'UnusedFn', { file: 'src/c.ts', exported: true }));

    g.addRelationship(makeRel('fn:B', 'fn:A', RelationshipType.CALLS));

    const result = runRule(g, 'dead_code') as RuleResult;
    expect(result.rule).toBe('dead_code');
    const names = result.items.map(i => i.name);
    expect(names).not.toContain('UsedFn');
    expect(names).toContain('UnusedFn');
    // CallerFn has no incoming edges either — also dead code
    expect(names).toContain('CallerFn');
  });

  it('excludes non-exported symbols', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('fn:A', 'InternalFn', { file: 'src/a.ts', exported: false }));
    g.addNode(makeNode('fn:B', 'ExportedUnused', { file: 'src/b.ts', exported: true }));

    const result = runRule(g, 'dead_code') as RuleResult;
    const names = result.items.map(i => i.name);
    expect(names).not.toContain('InternalFn');
    expect(names).toContain('ExportedUnused');
  });

  it('excludes Package, File, Module type nodes', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('pkg:A', 'mypkg', { type: NodeType.Package, exported: true }));
    g.addNode(makeNode('file:A', 'myfile.ts', { type: NodeType.File, exported: true }));
    g.addNode(makeNode('mod:A', 'mymod', { type: NodeType.Module, exported: true }));
    g.addNode(makeNode('fn:X', 'RealExport', { exported: true }));

    const result = runRule(g, 'dead_code') as RuleResult;
    const names = result.items.map(i => i.name);
    expect(names).not.toContain('mypkg');
    expect(names).not.toContain('myfile.ts');
    expect(names).not.toContain('mymod');
    expect(names).toContain('RealExport');
  });

  it('excludes test nodes (isTest=true)', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('fn:test', 'TestSomething', {
      exported: true,
      isTest: true,
      file: 'src/foo_test.ts',
    }));
    g.addNode(makeNode('fn:real', 'RealFn', { exported: true }));

    const result = runRule(g, 'dead_code') as RuleResult;
    const names = result.items.map(i => i.name);
    expect(names).not.toContain('TestSomething');
    expect(names).toContain('RealFn');
  });

  it('excludes self-calls (self-referential edges)', () => {
    const g = new KnowledgeGraph();
    // Recursive function: calls itself
    g.addNode(makeNode('fn:recur', 'RecursiveFn', { file: 'src/r.ts', exported: true }));
    g.addRelationship(makeRel('fn:recur', 'fn:recur', RelationshipType.CALLS));

    const result = runRule(g, 'dead_code') as RuleResult;
    // Self-call doesn't count as "used" — still dead code
    const names = result.items.map(i => i.name);
    expect(names).toContain('RecursiveFn');
  });

  it('result has correct count', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('fn:A', 'FnA', { exported: true }));
    g.addNode(makeNode('fn:B', 'FnB', { exported: true }));
    g.addNode(makeNode('fn:C', 'FnC', { exported: true }));
    // B calls A (A is used)
    g.addRelationship(makeRel('fn:B', 'fn:A'));

    const result = runRule(g, 'dead_code') as RuleResult;
    expect(result.count).toBe(result.items.length);
    // B and C have no incoming edges
    expect(result.count).toBe(2);
  });
});

// ─── unused_exports ─────────────────────────────────────────────

describe('unused_exports rule', () => {
  it('flags exports used only within their own file', () => {
    const g = new KnowledgeGraph();
    // ExportedHelper defined in src/a.ts, only called by InternalCaller also in src/a.ts
    g.addNode(makeNode('fn:helper', 'ExportedHelper', { file: 'src/a.ts', exported: true }));
    g.addNode(makeNode('fn:internal', 'InternalCaller', { file: 'src/a.ts', exported: false }));
    g.addRelationship(makeRel('fn:internal', 'fn:helper', RelationshipType.CALLS));

    const result = runRule(g, 'unused_exports') as RuleResult;
    const names = result.items.map(i => i.name);
    expect(names).toContain('ExportedHelper');
  });

  it('does not flag exports used from a different file', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('fn:helper', 'ExportedHelper', { file: 'src/a.ts', exported: true }));
    g.addNode(makeNode('fn:caller', 'CrossFileCaller', { file: 'src/b.ts', exported: false }));
    g.addRelationship(makeRel('fn:caller', 'fn:helper', RelationshipType.CALLS));

    const result = runRule(g, 'unused_exports') as RuleResult;
    const names = result.items.map(i => i.name);
    expect(names).not.toContain('ExportedHelper');
  });

  it('flags exports with zero incoming edges (also unused)', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('fn:isolated', 'IsolatedExport', { file: 'src/a.ts', exported: true }));

    const result = runRule(g, 'unused_exports') as RuleResult;
    const names = result.items.map(i => i.name);
    expect(names).toContain('IsolatedExport');
  });

  it('excludes non-exported symbols', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('fn:priv', 'privateHelper', { file: 'src/a.ts', exported: false }));

    const result = runRule(g, 'unused_exports') as RuleResult;
    expect(result.items.map(i => i.name)).not.toContain('privateHelper');
  });

  it('excludes Package, File, Module nodes', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('pkg:x', 'mypkg', { type: NodeType.Package, exported: true, file: 'src/a.ts' }));
    g.addNode(makeNode('file:x', 'myfile.ts', { type: NodeType.File, exported: true, file: 'src/a.ts' }));

    const result = runRule(g, 'unused_exports') as RuleResult;
    const names = result.items.map(i => i.name);
    expect(names).not.toContain('mypkg');
    expect(names).not.toContain('myfile.ts');
  });

  it('mixed: some intra-file, some cross-file callers', () => {
    const g = new KnowledgeGraph();
    // fn:shared is called by both a same-file node and a cross-file node
    g.addNode(makeNode('fn:shared', 'SharedFn', { file: 'src/shared.ts', exported: true }));
    g.addNode(makeNode('fn:intra', 'IntraFn', { file: 'src/shared.ts', exported: false }));
    g.addNode(makeNode('fn:cross', 'CrossFn', { file: 'src/other.ts', exported: false }));
    g.addRelationship(makeRel('fn:intra', 'fn:shared', RelationshipType.CALLS));
    g.addRelationship(makeRel('fn:cross', 'fn:shared', RelationshipType.CALLS));

    const result = runRule(g, 'unused_exports') as RuleResult;
    // SharedFn has a cross-file caller, so it's NOT unused
    expect(result.items.map(i => i.name)).not.toContain('SharedFn');
  });
});

// ─── circular_deps ──────────────────────────────────────────────

describe('circular_deps rule', () => {
  it('detects A→B→C→A cycle', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('pkg:A', 'pkgA', { type: NodeType.Package, package: 'pkgA', file: 'a/a.go' }));
    g.addNode(makeNode('pkg:B', 'pkgB', { type: NodeType.Package, package: 'pkgB', file: 'b/b.go' }));
    g.addNode(makeNode('pkg:C', 'pkgC', { type: NodeType.Package, package: 'pkgC', file: 'c/c.go' }));

    // A imports B, B imports C, C imports A — circular
    g.addRelationship(makeRel('pkg:A', 'pkg:B', RelationshipType.IMPORTS));
    g.addRelationship(makeRel('pkg:B', 'pkg:C', RelationshipType.IMPORTS));
    g.addRelationship(makeRel('pkg:C', 'pkg:A', RelationshipType.IMPORTS));

    const cycles = findCircularDeps(g);
    expect(cycles.length).toBeGreaterThan(0);
    // All three packages should appear in the detected cycle
    const cycleFlat = cycles.flat();
    expect(cycleFlat).toContain('pkgA');
    expect(cycleFlat).toContain('pkgB');
    expect(cycleFlat).toContain('pkgC');
  });

  it('returns empty array for acyclic graph', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('pkg:A', 'pkgA', { type: NodeType.Package, package: 'pkgA', file: 'a/a.go' }));
    g.addNode(makeNode('pkg:B', 'pkgB', { type: NodeType.Package, package: 'pkgB', file: 'b/b.go' }));
    g.addNode(makeNode('pkg:C', 'pkgC', { type: NodeType.Package, package: 'pkgC', file: 'c/c.go' }));

    // A→B→C, no cycle
    g.addRelationship(makeRel('pkg:A', 'pkg:B', RelationshipType.IMPORTS));
    g.addRelationship(makeRel('pkg:B', 'pkg:C', RelationshipType.IMPORTS));

    const cycles = findCircularDeps(g);
    expect(cycles).toHaveLength(0);
  });

  it('detects self-import as cycle', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('pkg:A', 'pkgA', { type: NodeType.Package, package: 'pkgA', file: 'a/a.go' }));
    g.addRelationship(makeRel('pkg:A', 'pkg:A', RelationshipType.IMPORTS));

    const cycles = findCircularDeps(g);
    expect(cycles.length).toBeGreaterThan(0);
  });

  it('detects cycle via runRule', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('pkg:X', 'pkgX', { type: NodeType.Package, package: 'pkgX', file: 'x/x.go' }));
    g.addNode(makeNode('pkg:Y', 'pkgY', { type: NodeType.Package, package: 'pkgY', file: 'y/y.go' }));
    g.addRelationship(makeRel('pkg:X', 'pkg:Y', RelationshipType.IMPORTS));
    g.addRelationship(makeRel('pkg:Y', 'pkg:X', RelationshipType.IMPORTS));

    const result = runRule(g, 'circular_deps') as RuleResult;
    expect(result.rule).toBe('circular_deps');
    expect(result.count).toBeGreaterThan(0);
    const details = result.items.map(i => i.detail ?? '');
    expect(details.some(d => d.includes('pkgX') || d.includes('pkgY'))).toBe(true);
  });
});

// ─── large_files ────────────────────────────────────────────────

describe('large_files rule', () => {
  it('flags files with more symbols than threshold (default 30)', () => {
    const g = new KnowledgeGraph();
    const bigFile = 'src/big.ts';
    // Add 31 function nodes in bigFile
    for (let i = 0; i < 31; i++) {
      g.addNode(makeNode(`fn:big:${i}`, `BigFn${i}`, { file: bigFile, exported: false }));
    }

    const result = runRule(g, 'large_files') as RuleResult;
    const flaggedFiles = result.items.map(i => i.file);
    expect(flaggedFiles).toContain(bigFile);
  });

  it('does not flag files at or below threshold', () => {
    const g = new KnowledgeGraph();
    const smallFile = 'src/small.ts';
    // Add exactly 10 nodes — well below 30
    for (let i = 0; i < 10; i++) {
      g.addNode(makeNode(`fn:sm:${i}`, `SmallFn${i}`, { file: smallFile, exported: false }));
    }

    const result = runRule(g, 'large_files') as RuleResult;
    const flaggedFiles = result.items.map(i => i.file);
    expect(flaggedFiles).not.toContain(smallFile);
  });

  it('excludes File, Package, Module nodes from symbol count', () => {
    const g = new KnowledgeGraph();
    const file = 'src/mixed.ts';
    // Add 31 File/Package/Module nodes — should not count toward threshold
    for (let i = 0; i < 31; i++) {
      g.addNode(makeNode(`file:m:${i}`, `FileMeta${i}`, {
        type: NodeType.File,
        file,
        exported: false,
      }));
    }
    // Add only 1 real symbol
    g.addNode(makeNode('fn:real', 'RealFn', { file, exported: false }));

    const result = runRule(g, 'large_files') as RuleResult;
    // Only 1 real symbol — should NOT be flagged
    const flaggedFiles = result.items.map(i => i.file);
    expect(flaggedFiles).not.toContain(file);
  });

  it('respects custom threshold option', () => {
    const g = new KnowledgeGraph();
    const file = 'src/medium.ts';
    // Add 5 function nodes
    for (let i = 0; i < 5; i++) {
      g.addNode(makeNode(`fn:med:${i}`, `MedFn${i}`, { file, exported: false }));
    }

    // With threshold of 3, 5 symbols should trigger
    const result = runRule(g, 'large_files', { threshold: 3 }) as RuleResult;
    expect(result.items.map(i => i.file)).toContain(file);

    // With threshold of 10, 5 symbols should NOT trigger
    const result2 = runRule(g, 'large_files', { threshold: 10 }) as RuleResult;
    expect(result2.items.map(i => i.file)).not.toContain(file);
  });

  it('items include symbol count in detail', () => {
    const g = new KnowledgeGraph();
    const file = 'src/fat.ts';
    for (let i = 0; i < 35; i++) {
      g.addNode(makeNode(`fn:fat:${i}`, `FatFn${i}`, { file, exported: false }));
    }

    const result = runRule(g, 'large_files') as RuleResult;
    const item = result.items.find(i => i.file === file);
    expect(item).toBeDefined();
    expect(item!.detail).toMatch(/35/);
  });
});

// ─── orphans ────────────────────────────────────────────────────

describe('orphans rule', () => {
  it('flags File nodes with zero incoming AND zero outgoing relationships', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('file:orphan', 'orphan.ts', {
      type: NodeType.File,
      file: 'src/orphan.ts',
    }));

    const result = runRule(g, 'orphans') as RuleResult;
    const names = result.items.map(i => i.name);
    expect(names).toContain('orphan.ts');
  });

  it('does not flag File nodes with outgoing relationships', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('file:active', 'active.ts', {
      type: NodeType.File,
      file: 'src/active.ts',
    }));
    g.addNode(makeNode('fn:x', 'SomeFn', { file: 'src/other.ts' }));
    // active.ts defines SomeFn
    g.addRelationship(makeRel('file:active', 'fn:x', RelationshipType.DEFINES));

    const result = runRule(g, 'orphans') as RuleResult;
    const names = result.items.map(i => i.name);
    expect(names).not.toContain('active.ts');
  });

  it('does not flag File nodes with incoming relationships', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('pkg:root', 'root', {
      type: NodeType.Package,
      file: 'src',
    }));
    g.addNode(makeNode('file:child', 'child.ts', {
      type: NodeType.File,
      file: 'src/child.ts',
    }));
    // Package contains file
    g.addRelationship(makeRel('pkg:root', 'file:child', RelationshipType.CONTAINS));

    const result = runRule(g, 'orphans') as RuleResult;
    const names = result.items.map(i => i.name);
    expect(names).not.toContain('child.ts');
  });

  it('only considers File-type nodes', () => {
    const g = new KnowledgeGraph();
    // A Function with no edges — NOT an orphan under this rule
    g.addNode(makeNode('fn:lonely', 'LonelyFn', { file: 'src/a.ts' }));
    // A File with no edges — IS an orphan
    g.addNode(makeNode('file:empty', 'empty.ts', {
      type: NodeType.File,
      file: 'src/empty.ts',
    }));

    const result = runRule(g, 'orphans') as RuleResult;
    const names = result.items.map(i => i.name);
    expect(names).not.toContain('LonelyFn');
    expect(names).toContain('empty.ts');
  });

  it('result count matches items length', () => {
    const g = new KnowledgeGraph();
    for (let i = 0; i < 3; i++) {
      g.addNode(makeNode(`file:o:${i}`, `orphan${i}.ts`, {
        type: NodeType.File,
        file: `src/orphan${i}.ts`,
      }));
    }

    const result = runRule(g, 'orphans') as RuleResult;
    expect(result.count).toBe(3);
    expect(result.items).toHaveLength(3);
  });
});

// ─── formatRuleResult ───────────────────────────────────────────

describe('formatRuleResult', () => {
  it('includes rule name in output', () => {
    const g = new KnowledgeGraph();
    const result = runRule(g, 'dead_code') as RuleResult;
    const text = formatRuleResult(result);
    expect(text).toContain('dead_code');
  });

  it('shows count', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('fn:A', 'UnusedA', { exported: true }));
    const result = runRule(g, 'dead_code') as RuleResult;
    const text = formatRuleResult(result);
    expect(text).toMatch(/1/);
  });

  it('shows "No issues found" when count is zero', () => {
    const g = new KnowledgeGraph();
    // No files → no orphans
    const result = runRule(g, 'orphans') as RuleResult;
    const text = formatRuleResult(result);
    expect(text).toContain('No issues');
  });

  it('lists item names', () => {
    const g = new KnowledgeGraph();
    g.addNode(makeNode('fn:dead', 'DeadFn', { exported: true }));
    const result = runRule(g, 'dead_code') as RuleResult;
    const text = formatRuleResult(result);
    expect(text).toContain('DeadFn');
  });
});
