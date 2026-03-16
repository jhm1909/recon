/**
 * Next-Step Hints
 *
 * Appended to every tool response to guide agents to the logical next action.
 */

export function getNextStepHint(
  toolName: string,
  args?: Record<string, unknown>,
): string {
  switch (toolName) {
    case 'recon_packages':
      return '\n\n---\n**Next:** Use recon_impact({target: "<package_symbol>", direction: "upstream"}) to check blast radius before editing.';

    case 'recon_impact':
      return '\n\n---\n**Next:** Review d=1 items first (WILL BREAK). Use recon_context({name: "<symbol>"}) for full reference graph.';

    case 'recon_context': {
      const name = (args?.name as string) || '<name>';
      return `\n\n---\n**Next:** If planning changes, use recon_impact({target: "${name}", direction: "upstream"}) to check blast radius.`;
    }

    case 'recon_detect_changes':
      return '\n\n---\n**Next:** Review affected dependents. Use recon_context({name: "<symbol>"}) on high-risk changed symbols.';

    case 'recon_query':
      return '\n\n---\n**Next:** Use recon_context({name: "<symbol>"}) for 360° view of a result.';

    case 'recon_api_map':
      return '\n\n---\n**Next:** Use recon_context({name: "<handler>"}) on a handler for full dependency info, or recon_impact({target: "<handler>", direction: "upstream"}) to check blast radius.';

    default:
      return '';
  }
}
