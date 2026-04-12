import { describe, it, expect } from 'vitest';
import { symbolNotFound, ambiguousSymbol, invalidParameter, indexStale, emptyGraph } from '../../src/mcp/errors.js';

describe('ReconToolError', () => {
  it('creates symbol_not_found with suggestions', () => {
    const err = symbolNotFound('getUserById', ['getUser', 'getUserByEmail']);
    expect(err.error).toBe('symbol_not_found');
    expect(err.symbol).toBe('getUserById');
    expect(err.suggestion.tool).toBe('recon_find');
    expect(err.similar).toContain('getUser');
  });

  it('creates ambiguous_symbol with matches', () => {
    const err = ambiguousSymbol('parse', [
      { name: 'parse', file: 'src/a.ts' },
      { name: 'parse', file: 'src/b.ts' },
    ]);
    expect(err.error).toBe('ambiguous_symbol');
    expect(err.matches).toHaveLength(2);
  });

  it('creates invalid_parameter with expected values', () => {
    const err = invalidParameter('direction', 'sideways', ['upstream', 'downstream']);
    expect(err.error).toBe('invalid_parameter');
    expect(err.expected).toContain('upstream');
  });

  it('creates index_stale with timestamp', () => {
    const err = indexStale('2026-01-01T00:00:00Z');
    expect(err.error).toBe('index_stale');
    expect(err.suggestion.tool).toBe('recon_map');
  });

  it('creates empty_graph error', () => {
    const err = emptyGraph();
    expect(err.error).toBe('empty_graph');
    expect(err.suggestion.reason).toContain('npx recon index');
  });

  it('formats error as JSON string', () => {
    const err = symbolNotFound('foo', []);
    const json = JSON.parse(err.toJSON());
    expect(json.error).toBe('symbol_not_found');
  });
});
