/**
 * Next-Step Hints
 *
 * Appended to every tool response to guide agents to the logical next action.
 * Pattern from GitNexus's getNextStepHint().
 */

export function getNextStepHint(
  toolName: string,
  args?: Record<string, unknown>,
): string {
  switch (toolName) {
    case 'codemap_packages':
      return '\n\n---\n**Next:** Use codemap_impact({target: "<package_symbol>", direction: "upstream"}) to check blast radius before editing.';

    case 'codemap_impact':
      return '\n\n---\n**Next:** Review d=1 items first (WILL BREAK). Use codemap_context({name: "<symbol>"}) for full reference graph.';

    case 'codemap_context': {
      const name = (args?.name as string) || '<name>';
      return `\n\n---\n**Next:** If planning changes, use codemap_impact({target: "${name}", direction: "upstream"}) to check blast radius.`;
    }

    case 'codemap_detect_changes':
      return '\n\n---\n**Next:** Review affected dependents. Use codemap_context({name: "<symbol>"}) on high-risk changed symbols.';

    case 'codemap_query':
      return '\n\n---\n**Next:** Use codemap_context({name: "<symbol>"}) for 360° view of a result.';

    case 'codemap_api_map':
      return '\n\n---\n**Next:** Use codemap_context({name: "<handler>"}) on a handler for full dependency info, or codemap_impact({target: "<handler>", direction: "upstream"}) to check blast radius.';

    default:
      return '';
  }
}
