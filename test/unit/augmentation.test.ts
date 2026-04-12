/**
 * Unit Tests: MCP Prompts
 *
 * Tests the MCP prompt templates:
 * - RECON_PROMPTS + getPromptMessages(): MCP prompt templates
 */
import { describe, it, expect } from 'vitest';
import { RECON_PROMPTS, getPromptMessages } from '../../src/mcp/prompts.js';

// ─── MCP Prompts ─────────────────────────────────────────────────

describe('RECON_PROMPTS', () => {
    it('exports 3 prompts', () => {
        expect(RECON_PROMPTS).toHaveLength(3);
    });

    it('has pre_commit prompt', () => {
        const p = RECON_PROMPTS.find(p => p.name === 'pre_commit');
        expect(p).toBeDefined();
        expect(p!.description).toContain('impact');
        expect(p!.arguments.length).toBeGreaterThanOrEqual(1);
    });

    it('has architecture prompt', () => {
        const p = RECON_PROMPTS.find(p => p.name === 'architecture');
        expect(p).toBeDefined();
        expect(p!.description).toContain('architecture');
    });

    it('has onboard prompt', () => {
        const p = RECON_PROMPTS.find(p => p.name === 'onboard');
        expect(p).toBeDefined();
        expect(p!.description).toContain('onboard');
    });
});

describe('getPromptMessages', () => {
    it('returns pre_commit messages', () => {
        const messages = getPromptMessages('pre_commit');
        expect(messages).toHaveLength(1);
        expect(messages[0].role).toBe('user');
        expect(messages[0].content.type).toBe('text');
        expect(messages[0].content.text).toContain('recon_changes');
        expect(messages[0].content.text).toContain('recon_impact');
    });

    it('pre_commit accepts scope param', () => {
        const messages = getPromptMessages('pre_commit', { scope: 'staged' });
        expect(messages[0].content.text).toContain('"staged"');
    });

    it('returns architecture messages', () => {
        const messages = getPromptMessages('architecture');
        expect(messages).toHaveLength(1);
        expect(messages[0].content.text).toContain('recon://stats');
        expect(messages[0].content.text).toContain('recon_map');
        expect(messages[0].content.text).toContain('ARCHITECTURE.md');
    });

    it('returns onboard messages', () => {
        const messages = getPromptMessages('onboard');
        expect(messages).toHaveLength(1);
        expect(messages[0].content.text).toContain('onboarding');
        expect(messages[0].content.text).toContain('ONBOARDING.md');
    });

    it('onboard covers entire codebase', () => {
        const messages = getPromptMessages('onboard');
        expect(messages[0].content.text).toContain('entire codebase');
    });

    it('throws on unknown prompt', () => {
        expect(() => getPromptMessages('nonexistent')).toThrowError('Unknown prompt');
    });
});
