/**
 * Framework Detection
 *
 * Detects frameworks from file paths and provides entry point
 * multipliers for process scoring.
 */

// ─── Types ──────────────────────────────────────────────────────

export interface FrameworkHint {
    framework: string;
    entryPointMultiplier: number;
    reason: string;
}

// ─── Path-based Detection ───────────────────────────────────────

interface PathPattern {
    regex: RegExp;
    framework: string;
    multiplier: number;
    reason: string;
}

const PATH_PATTERNS: PathPattern[] = [
    // ─── Next.js / React
    { regex: /\/pages\/api\//, framework: 'nextjs', multiplier: 2.0, reason: 'Next.js API route' },
    { regex: /\/app\/.*\/route\.(ts|js)$/, framework: 'nextjs', multiplier: 2.0, reason: 'Next.js App Router' },
    { regex: /\/pages\/.*\.(tsx|jsx)$/, framework: 'nextjs', multiplier: 1.5, reason: 'Next.js page' },
    { regex: /\/app\/.*\/page\.(tsx|jsx)$/, framework: 'nextjs', multiplier: 1.5, reason: 'Next.js App page' },

    // ─── Express / Fastify
    { regex: /\/routes?\//, framework: 'express', multiplier: 1.8, reason: 'Express/Fastify route' },
    { regex: /\/middleware\//, framework: 'express', multiplier: 1.3, reason: 'Middleware' },
    { regex: /\/controllers?\//, framework: 'express', multiplier: 1.8, reason: 'Controller' },

    // ─── NestJS
    { regex: /\.controller\.(ts|js)$/, framework: 'nestjs', multiplier: 2.0, reason: 'NestJS controller' },
    { regex: /\.service\.(ts|js)$/, framework: 'nestjs', multiplier: 1.5, reason: 'NestJS service' },
    { regex: /\.module\.(ts|js)$/, framework: 'nestjs', multiplier: 1.2, reason: 'NestJS module' },
    { regex: /\.guard\.(ts|js)$/, framework: 'nestjs', multiplier: 1.3, reason: 'NestJS guard' },

    // ─── Python Django
    { regex: /\/views?\.(py)$/, framework: 'django', multiplier: 2.0, reason: 'Django view' },
    { regex: /\/urls?\.(py)$/, framework: 'django', multiplier: 1.5, reason: 'Django URL config' },
    { regex: /\/models?\.(py)$/, framework: 'django', multiplier: 1.3, reason: 'Django model' },
    { regex: /\/serializers?\.(py)$/, framework: 'django', multiplier: 1.5, reason: 'Django serializer' },

    // ─── Python Flask / FastAPI
    { regex: /\/app\.(py)$/, framework: 'flask', multiplier: 2.0, reason: 'Flask/FastAPI app' },
    { regex: /\/routers?\//, framework: 'fastapi', multiplier: 1.8, reason: 'FastAPI router' },

    // ─── Go
    { regex: /\/handlers?\//, framework: 'go-http', multiplier: 1.8, reason: 'HTTP handler' },
    { regex: /\/cmd\//, framework: 'go-cli', multiplier: 2.0, reason: 'Go CLI entrypoint' },
    { regex: /main\.go$/, framework: 'go', multiplier: 2.0, reason: 'Go main' },

    // ─── Java Spring
    { regex: /Controller\.(java|kt)$/, framework: 'spring', multiplier: 2.0, reason: 'Spring controller' },
    { regex: /Service\.(java|kt)$/, framework: 'spring', multiplier: 1.5, reason: 'Spring service' },
    { regex: /Repository\.(java|kt)$/, framework: 'spring', multiplier: 1.3, reason: 'Spring repository' },

    // ─── Rust
    { regex: /main\.rs$/, framework: 'rust', multiplier: 2.0, reason: 'Rust main' },
    { regex: /lib\.rs$/, framework: 'rust', multiplier: 1.5, reason: 'Rust lib entry' },
    { regex: /\/handlers?\.rs$/, framework: 'rust', multiplier: 1.8, reason: 'Rust handler' },

    // ─── Tests (negative)
    { regex: /\.(test|spec|e2e)\.(ts|js|tsx|jsx|py|go|rs|java)$/, framework: 'test', multiplier: 0.1, reason: 'Test file' },
    { regex: /\/tests?\//, framework: 'test', multiplier: 0.1, reason: 'Test directory' },
    { regex: /\/__tests__\//, framework: 'test', multiplier: 0.1, reason: 'Jest test directory' },
];

/**
 * Detect framework from file path.
 * Returns null if no framework pattern matches (uses 1.0 default).
 */
export function detectFrameworkFromPath(filePath: string): FrameworkHint | null {
    const normalized = filePath.replace(/\\/g, '/');

    for (const pattern of PATH_PATTERNS) {
        if (pattern.regex.test(normalized)) {
            return {
                framework: pattern.framework,
                entryPointMultiplier: pattern.multiplier,
                reason: pattern.reason,
            };
        }
    }

    return null;
}

// ─── Name-based Detection ───────────────────────────────────────

const NAME_PATTERNS: Array<{ regex: RegExp; framework: string; multiplier: number; reason: string }> = [
    // NestJS decorators detected in function names
    { regex: /^(get|post|put|delete|patch)[A-Z]/, framework: 'rest', multiplier: 1.5, reason: 'REST handler' },
    { regex: /^handle[A-Z]/, framework: 'handler', multiplier: 1.8, reason: 'Event handler' },
    { regex: /^on[A-Z]/, framework: 'event', multiplier: 1.5, reason: 'Event listener' },
    { regex: /^(use|create)[A-Z].*Hook$/, framework: 'react', multiplier: 1.3, reason: 'React hook' },
    { regex: /^main$/, framework: 'entry', multiplier: 2.0, reason: 'Main function' },
    { regex: /^(init|setup|bootstrap|start)$/, framework: 'entry', multiplier: 1.8, reason: 'Initialization function' },
];

/**
 * Detect framework hint from a function/method name.
 * Returns null if no pattern matches.
 */
export function detectFrameworkFromName(name: string): FrameworkHint | null {
    for (const pattern of NAME_PATTERNS) {
        if (pattern.regex.test(name)) {
            return {
                framework: pattern.framework,
                entryPointMultiplier: pattern.multiplier,
                reason: pattern.reason,
            };
        }
    }

    return null;
}

/**
 * Get combined entry point multiplier from both path and name.
 * Returns 1.0 if no patterns match.
 */
export function getEntryPointMultiplier(filePath: string, name: string): { multiplier: number; framework: string; reason: string } {
    const pathHint = detectFrameworkFromPath(filePath);
    const nameHint = detectFrameworkFromName(name);

    // Use the higher multiplier
    if (pathHint && nameHint) {
        return pathHint.entryPointMultiplier >= nameHint.entryPointMultiplier
            ? { multiplier: pathHint.entryPointMultiplier, framework: pathHint.framework, reason: pathHint.reason }
            : { multiplier: nameHint.entryPointMultiplier, framework: nameHint.framework, reason: nameHint.reason };
    }

    if (pathHint) return { multiplier: pathHint.entryPointMultiplier, framework: pathHint.framework, reason: pathHint.reason };
    if (nameHint) return { multiplier: nameHint.entryPointMultiplier, framework: nameHint.framework, reason: nameHint.reason };

    return { multiplier: 1.0, framework: 'unknown', reason: '' };
}
