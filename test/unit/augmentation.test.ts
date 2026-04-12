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
