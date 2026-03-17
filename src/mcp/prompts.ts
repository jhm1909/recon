/**
 * MCP Prompts
 *
 * Pre-built prompt templates that guide AI agents through common workflows.
 * Each prompt returns structured user messages with step-by-step instructions
 * that leverage Recon's tools and resources.
 *
 * Prompts:
 *   detect_impact  — Pre-commit change analysis
 *   generate_map   — Architecture documentation from the knowledge graph
 *   onboard        — Codebase onboarding guide for new developers
 */

export interface ReconPrompt {
    name: string;
    description: string;
    arguments: Array<{
        name: string;
        description: string;
        required: boolean;
    }>;
}

export const RECON_PROMPTS: ReconPrompt[] = [
    {
        name: 'detect_impact',
        description:
            'Analyze the impact of your current changes before committing. ' +
            'Detects changed symbols, maps them to affected processes, and ' +
            'produces a risk report with blast radius analysis.',
        arguments: [
            {
                name: 'scope',
                description:
                    'What to analyze: "unstaged" (working tree), "staged" (git index), ' +
                    '"all" (both), or "compare" (branch diff). Default: all',
                required: false,
            },
            {
                name: 'base_ref',
                description: 'Branch or commit to compare against (only for scope=compare)',
                required: false,
            },
        ],
    },
    {
        name: 'generate_map',
        description:
            'Generate architecture documentation from the knowledge graph. ' +
            'Creates a codebase overview with functional areas, execution flows, ' +
            'and a mermaid architecture diagram.',
        arguments: [],
    },
    {
        name: 'onboard',
        description:
            'Generate a codebase onboarding guide for new developers. ' +
            'Walks through project structure, critical paths, entry points, ' +
            'and suggested reading order for understanding the architecture.',
        arguments: [
            {
                name: 'focus',
                description: 'Optional area to focus on (e.g., "api", "auth", "database")',
                required: false,
            },
        ],
    },
];

/**
 * Get the prompt messages for a given prompt name.
 */
export function getPromptMessages(
    name: string,
    args?: Record<string, string>,
): Array<{ role: 'user'; content: { type: 'text'; text: string } }> {

    if (name === 'detect_impact') {
        const scope = args?.scope || 'all';
        const baseRef = args?.base_ref || '';
        const changesArgs = JSON.stringify({
            scope,
            ...(baseRef ? { base_ref: baseRef } : {}),
        });

        return [{
            role: 'user' as const,
            content: {
                type: 'text' as const,
                text: `Analyze the impact of my current code changes before committing.

Follow these steps:
1. Run \`recon_detect_changes(${changesArgs})\` to find what changed and affected processes
2. For each changed symbol in critical processes, run \`recon_context({name: "<symbol>"})\` to see its full reference graph
3. For any high-risk items (many callers or cross-process), run \`recon_impact({target: "<symbol>", direction: "upstream"})\` for blast radius
4. READ \`recon://processes\` to check which execution flows are affected
5. Summarize as a clear risk report:
   - **Changes**: list of modified symbols
   - **Affected processes**: which execution flows are impacted
   - **Risk level**: LOW / MEDIUM / HIGH / CRITICAL
   - **Recommended actions**: what to test or review`,
            },
        }];
    }

    if (name === 'generate_map') {
        return [{
            role: 'user' as const,
            content: {
                type: 'text' as const,
                text: `Generate architecture documentation for this codebase using the knowledge graph.

Follow these steps:
1. READ \`recon://stats\` for codebase overview (nodes, edges, languages)
2. Run \`recon_packages()\` to see all functional areas / packages
3. Run \`recon_processes({limit: 10})\` to see the top execution flows
4. For the top 3 most important processes, run \`recon_context({name: "<entry_function>"})\` for detailed views
5. Run \`recon_api_map()\` for API endpoint mapping
6. Generate an ARCHITECTURE.md file with:
   - **Overview**: project purpose and tech stack
   - **Structure**: package/module organization
   - **Key Execution Flows**: the top 5 processes with descriptions
   - **API Map**: endpoints and their handlers
   - **Mermaid Diagram**: architecture diagram showing major areas and connections

Use mermaid graph TD syntax for the architecture diagram.`,
            },
        }];
    }

    if (name === 'onboard') {
        const focus = args?.focus || '';
        const focusInstruction = focus
            ? `Pay special attention to the "${focus}" area and its related components.`
            : 'Cover the entire codebase at a high level.';

        return [{
            role: 'user' as const,
            content: {
                type: 'text' as const,
                text: `Create a codebase onboarding guide for a new developer joining this project.
${focusInstruction}

Follow these steps:
1. READ \`recon://stats\` for project overview
2. Run \`recon_packages()\` to understand the module structure
3. Run \`recon_processes({limit: 5})\` to identify the most important execution flows
4. For each key entry point, run \`recon_context({name: "<function>"})\` to see what it connects to${focus ? `\n5. Run \`recon_search({query: "${focus}"})\` to find relevant symbols in the focus area` : ''}

Generate an ONBOARDING.md with:
- **Project Overview**: what this project does
- **Getting Started**: how to run, test, and develop
- **Architecture**: package organization with 1-line descriptions
- **Critical Paths**: the top 5 execution flows explained simply
- **Suggested Reading Order**: files to read first to understand the codebase
- **Common Tasks**: how to add a new feature, fix a bug, run tests`,
            },
        }];
    }

    throw new Error(`Unknown prompt: ${name}`);
}
