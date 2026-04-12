export interface ToolSuggestion {
  tool: string;
  params: Record<string, unknown>;
  reason: string;
}

export class ReconToolError {
  constructor(
    public error: string,
    public symbol?: string,
    public suggestion: ToolSuggestion = { tool: '', params: {}, reason: '' },
    public similar?: string[],
    public matches?: { name: string; file: string }[],
    public expected?: string[],
    public parameter?: string,
    public lastIndexed?: string,
  ) {}

  toJSON(): string {
    const obj: Record<string, unknown> = { error: this.error };
    if (this.symbol) obj.symbol = this.symbol;
    if (this.suggestion.tool) obj.suggestion = this.suggestion;
    if (this.similar?.length) obj.similar = this.similar;
    if (this.matches?.length) obj.matches = this.matches;
    if (this.expected?.length) obj.expected = this.expected;
    if (this.parameter) obj.parameter = this.parameter;
    if (this.lastIndexed) obj.lastIndexed = this.lastIndexed;
    return JSON.stringify(obj, null, 2);
  }
}

export function symbolNotFound(name: string, similar: string[]): ReconToolError {
  return new ReconToolError('symbol_not_found', name, {
    tool: 'recon_find', params: { query: name },
    reason: 'No exact match. Use recon_find for fuzzy search.',
  }, similar);
}

export function ambiguousSymbol(name: string, matches: { name: string; file: string }[]): ReconToolError {
  return new ReconToolError('ambiguous_symbol', name, {
    tool: 'recon_explain', params: { name },
    reason: "Multiple matches. Add 'file' parameter to disambiguate.",
  }, undefined, matches);
}

export function invalidParameter(param: string, received: string, expected: string[]): ReconToolError {
  return new ReconToolError('invalid_parameter', undefined, {
    tool: '', params: {},
    reason: `Parameter '${param}' received '${received}'. Expected: ${expected.join(', ')}`,
  }, undefined, undefined, expected, param);
}

export function indexStale(lastIndexed: string): ReconToolError {
  return new ReconToolError('index_stale', undefined, {
    tool: 'recon_map', params: {},
    reason: `Index was last built at ${lastIndexed}. Re-index to update.`,
  }, undefined, undefined, undefined, undefined, lastIndexed);
}

export function emptyGraph(): ReconToolError {
  return new ReconToolError('empty_graph', undefined, {
    tool: '', params: {},
    reason: 'No index found. Run: npx recon index',
  });
}
