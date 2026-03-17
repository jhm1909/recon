/**
 * Unit Tests: Augmentation Engine + Staleness Check + MCP Prompts
 *
 * Tests the new features added to Recon:
 * - augment(): compact context injection for agent search
 * - checkStaleness(): git commit comparison for index freshness
 * - RECON_PROMPTS + getPromptMessages(): MCP prompt templates
 */
import { describe, it, expect } from 'vitest';
import { KnowledgeGraph } from '../../src/graph/graph.js';
import { NodeType, RelationshipType, Language } from '../../src/graph/types.js';
import type { Node, Relationship } from '../../src/graph/types.js';
import { augment } from '../../src/mcp/augmentation.js';
import { checkStaleness } from '../../src/mcp/staleness.js';
import { RECON_PROMPTS, getPromptMessages } from '../../src/mcp/prompts.js';

// ─── Helpers ─────────────────────────────────────────────────────

function makeNode(id: string, name: string, overrides?: Partial<Node>): Node {
    return {
        id,
        type: NodeType.Function,
        name,
        file: 'src/main.ts',
        startLine: 1,
        endLine: 10,
        language: Language.TypeScript,
        package: 'core',
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

// ─── Augmentation ────────────────────────────────────────────────

describe('augment', () => {
    it('returns empty string for empty pattern', () => {
        const g = new KnowledgeGraph();
        expect(augment('', g)).toBe('');
    });

    it('returns empty string for short pattern', () => {
        const g = new KnowledgeGraph();
        expect(augment('a', g)).toBe('');
    });

    it('returns empty string when no matches', () => {
        const g = new KnowledgeGraph();
        g.addNode(makeNode('f1', 'Foo'));
        expect(augment('NonExistent', g)).toBe('');
    });

    it('returns identity line for simple match', () => {
        const g = new KnowledgeGraph();
        g.addNode(makeNode('f1', 'Foo'));
        const result = augment('Foo', g);
        expect(result).toContain('📍 **Foo**');
        expect(result).toContain('Function');
        expect(result).toContain('src/main.ts');
    });

    it('includes callers', () => {
        const g = new KnowledgeGraph();
        g.addNode(makeNode('f1', 'Caller'));
        g.addNode(makeNode('f2', 'Target'));
        g.addRelationship(makeRel('f1', 'f2'));

        const result = augment('Target', g);
        expect(result).toContain('⬆️ Called by: Caller');
    });

    it('includes callees', () => {
        const g = new KnowledgeGraph();
        g.addNode(makeNode('f1', 'Caller'));
        g.addNode(makeNode('f2', 'Target'));
        g.addRelationship(makeRel('f1', 'f2'));

        const result = augment('Caller', g);
        expect(result).toContain('⬇️ Calls: Target');
    });

    it('includes community', () => {
        const g = new KnowledgeGraph();
        g.addNode(makeNode('f1', 'Foo', { community: 'auth-module' }));

        const result = augment('Foo', g);
        expect(result).toContain('📦 Community: auth-module');
    });

    it('shows blast radius warning for many callers', () => {
        const g = new KnowledgeGraph();
        g.addNode(makeNode('target', 'SharedUtil'));
        for (let i = 0; i < 6; i++) {
            g.addNode(makeNode(`c${i}`, `Caller${i}`));
            g.addRelationship(makeRel(`c${i}`, 'target'));
        }

        const result = augment('SharedUtil', g);
        expect(result).toContain('⚠️ High blast radius');
        expect(result).toContain('6 callers');
    });

    it('truncates callers to 5', () => {
        const g = new KnowledgeGraph();
        g.addNode(makeNode('target', 'Util'));
        for (let i = 0; i < 8; i++) {
            g.addNode(makeNode(`c${i}`, `Caller${i}`));
            g.addRelationship(makeRel(`c${i}`, 'target'));
        }

        const result = augment('Util', g);
        expect(result).toContain('+3 more');
    });

    it('prefers exact exported name match', () => {
        const g = new KnowledgeGraph();
        g.addNode(makeNode('f1', 'Foo', { file: 'a.ts', exported: false }));
        g.addNode(makeNode('f2', 'Foo', { file: 'b.ts', exported: true }));

        const result = augment('Foo', g);
        // Should prefer the exported one
        expect(result).toContain('b.ts');
    });

    it('handles errors gracefully', () => {
        const g = new KnowledgeGraph();
        g.addNode(makeNode('f1', 'Test'));
        g.addRelationship({
            id: 'broken',
            type: RelationshipType.CALLS,
            sourceId: 'nonexistent',
            targetId: 'f1',
            confidence: 1.0,
        });

        // Should not throw
        const result = augment('Test', g);
        expect(typeof result).toBe('string');
    });
});

// ─── Staleness Check ─────────────────────────────────────────────

describe('checkStaleness', () => {
    it('returns not stale for empty lastCommit', () => {
        const info = checkStaleness('.', '');
        expect(info.isStale).toBe(false);
        expect(info.commitsBehind).toBe(0);
        expect(info.hint).toBeUndefined();
    });

    it('returns not stale for invalid commit (fail-open)', () => {
        const info = checkStaleness('.', 'not-a-real-commit-hash');
        expect(info.isStale).toBe(false);
        expect(info.commitsBehind).toBe(0);
    });

    it('returns not stale for non-git directory (fail-open)', () => {
        const info = checkStaleness('C:\\Windows\\Temp', 'abc123');
        expect(info.isStale).toBe(false);
        expect(info.commitsBehind).toBe(0);
    });
});

// ─── MCP Prompts ─────────────────────────────────────────────────

describe('RECON_PROMPTS', () => {
    it('exports 3 prompts', () => {
        expect(RECON_PROMPTS).toHaveLength(3);
    });

    it('has detect_impact prompt', () => {
        const p = RECON_PROMPTS.find(p => p.name === 'detect_impact');
        expect(p).toBeDefined();
        expect(p!.description).toContain('impact');
        expect(p!.arguments.length).toBeGreaterThanOrEqual(1);
    });

    it('has generate_map prompt', () => {
        const p = RECON_PROMPTS.find(p => p.name === 'generate_map');
        expect(p).toBeDefined();
        expect(p!.description).toContain('architecture');
    });

    it('has onboard prompt', () => {
        const p = RECON_PROMPTS.find(p => p.name === 'onboard');
        expect(p).toBeDefined();
        expect(p!.description).toContain('onboarding');
    });
});

describe('getPromptMessages', () => {
    it('returns detect_impact messages', () => {
        const messages = getPromptMessages('detect_impact');
        expect(messages).toHaveLength(1);
        expect(messages[0].role).toBe('user');
        expect(messages[0].content.type).toBe('text');
        expect(messages[0].content.text).toContain('recon_detect_changes');
        expect(messages[0].content.text).toContain('recon_impact');
    });

    it('detect_impact accepts scope param', () => {
        const messages = getPromptMessages('detect_impact', { scope: 'staged' });
        expect(messages[0].content.text).toContain('"staged"');
    });

    it('detect_impact accepts base_ref param', () => {
        const messages = getPromptMessages('detect_impact', { scope: 'compare', base_ref: 'main' });
        expect(messages[0].content.text).toContain('"compare"');
        expect(messages[0].content.text).toContain('"base_ref"');
    });

    it('returns generate_map messages', () => {
        const messages = getPromptMessages('generate_map');
        expect(messages).toHaveLength(1);
        expect(messages[0].content.text).toContain('recon://stats');
        expect(messages[0].content.text).toContain('recon_packages');
        expect(messages[0].content.text).toContain('ARCHITECTURE.md');
    });

    it('returns onboard messages', () => {
        const messages = getPromptMessages('onboard');
        expect(messages).toHaveLength(1);
        expect(messages[0].content.text).toContain('onboarding');
        expect(messages[0].content.text).toContain('ONBOARDING.md');
    });

    it('onboard accepts focus param', () => {
        const messages = getPromptMessages('onboard', { focus: 'auth' });
        expect(messages[0].content.text).toContain('"auth"');
        expect(messages[0].content.text).toContain('recon_search');
    });

    it('onboard without focus covers entire codebase', () => {
        const messages = getPromptMessages('onboard');
        expect(messages[0].content.text).toContain('entire codebase');
    });

    it('throws on unknown prompt', () => {
        expect(() => getPromptMessages('nonexistent')).toThrowError('Unknown prompt');
    });
});

// ─── Integration: recon_augment handler ──────────────────────────

describe('recon_augment handler', () => {
    it('calls augment and returns result', async () => {
        const { handleToolCall } = await import('../../src/mcp/handlers.js');

        const g = new KnowledgeGraph();
        g.addNode(makeNode('f1', 'MyFunc'));

        const result = await handleToolCall('recon_augment', { pattern: 'MyFunc' }, g);
        expect(result).toContain('MyFunc');
    });

    it('returns fallback message when no match', async () => {
        const { handleToolCall } = await import('../../src/mcp/handlers.js');

        const g = new KnowledgeGraph();
        g.addNode(makeNode('f1', 'Foo'));

        const result = await handleToolCall('recon_augment', { pattern: 'NonExistent' }, g);
        expect(result).toContain('No graph context');
    });
});
