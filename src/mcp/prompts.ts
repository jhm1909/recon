/**
 * MCP Prompts
 *
 * Pre-built prompt templates that guide AI agents through common workflows.
 * Each prompt returns structured user messages with step-by-step instructions
 * that leverage Recon's tools and resources.
 *
 * Prompts:
 *   pre_commit   — Pre-commit impact analysis
 *   architecture — Generate architecture documentation
 *   onboard      — Codebase onboarding guide
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
        name: 'pre_commit',
        description: 'Pre-commit impact analysis',
        arguments: [{ name: 'scope', description: 'staged or unstaged', required: false }],
    },
    {
        name: 'architecture',
        description: 'Generate architecture documentation',
        arguments: [],
    },
    {
        name: 'onboard',
        description: 'Codebase onboarding guide',
        arguments: [],
    },
];

/**
 * Get the prompt messages for a given prompt name.
 */
export function getPromptMessages(
    name: string,
    args?: Record<string, string>,
): Array<{ role: 'user'; content: { type: 'text'; text: string } }> {

    if (name === 'pre_commit') {
        const scope = args?.scope || 'unstaged';
        const changesArgs = JSON.stringify({ scope });

        return [{
            role: 'user' as const,
            content: {
                type: 'text' as const,
                text: `Analyze the impact of my current code changes before committing.

Follow these steps:
1. Run \`recon_changes(${changesArgs})\` to find what changed and affected symbols
2. For each changed symbol, run \`recon_explain({name: "<symbol>"})\` to see its full reference graph
3. For any high-risk items (many callers or cross-language), run \`recon_impact({target: "<symbol>", direction: "upstream"})\` for blast radius
4. Summarize as a clear risk report:
   - **Changes**: list of modified symbols
   - **Blast radius**: which callers and tests are affected
   - **Risk level**: LOW / MEDIUM / HIGH / CRITICAL
   - **Recommended actions**: what to test or review`,
            },
        }];
    }

    if (name === 'architecture') {
        return [{
            role: 'user' as const,
            content: {
                type: 'text' as const,
                text: `Generate architecture documentation for this codebase using the knowledge graph.

Follow these steps:
1. READ \`recon://stats\` for codebase overview (nodes, edges, languages)
2. Run \`recon_map()\` to see all functional areas / packages
3. Run \`recon_rules()\` to identify code quality issues and key patterns
4. For the top entry points, run \`recon_explain({name: "<entry_function>"})\` for detailed views
5. Generate an ARCHITECTURE.md file with:
   - **Overview**: project purpose and tech stack
   - **Structure**: package/module organization
   - **Key Entry Points**: main functions and their roles
   - **Code Quality**: issues flagged by rules
   - **Mermaid Diagram**: architecture diagram showing major areas and connections

Use mermaid graph TD syntax for the architecture diagram.`,
            },
        }];
    }

    if (name === 'onboard') {
        return [{
            role: 'user' as const,
            content: {
                type: 'text' as const,
                text: `Create a codebase onboarding guide for a new developer joining this project.
Cover the entire codebase at a high level.

Follow these steps:
1. READ \`recon://stats\` for project overview
2. Run \`recon_map()\` to understand the module structure
3. Run \`recon_find({query: "entry point"})\` to identify the most important entry points
4. For each key entry point, run \`recon_explain({name: "<function>"})\` to see what it connects to

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
