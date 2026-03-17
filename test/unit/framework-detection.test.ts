/**
 * Unit Tests: Framework Detection
 *
 * Tests that path-based and name-based framework detection
 * returns correct multipliers for entry point scoring.
 */
import { describe, it, expect } from 'vitest';
import {
    detectFrameworkFromPath,
    detectFrameworkFromName,
    getEntryPointMultiplier,
} from '../../src/analyzers/framework-detection.js';

// ─── Path-based Detection ────────────────────────────────────────

describe('detectFrameworkFromPath', () => {
    it('detects Next.js API route', () => {
        const hint = detectFrameworkFromPath('src/pages/api/users.ts');
        expect(hint).not.toBeNull();
        expect(hint!.framework).toBe('nextjs');
        expect(hint!.entryPointMultiplier).toBe(2.0);
    });

    it('detects Next.js App Router route', () => {
        const hint = detectFrameworkFromPath('src/app/api/users/route.ts');
        expect(hint).not.toBeNull();
        expect(hint!.framework).toBe('nextjs');
        expect(hint!.entryPointMultiplier).toBe(2.0);
    });

    it('detects Next.js page', () => {
        const hint = detectFrameworkFromPath('src/pages/index.tsx');
        expect(hint).not.toBeNull();
        expect(hint!.framework).toBe('nextjs');
        expect(hint!.entryPointMultiplier).toBe(1.5);
    });

    it('detects Express route', () => {
        const hint = detectFrameworkFromPath('src/routes/auth.ts');
        expect(hint).not.toBeNull();
        expect(hint!.framework).toBe('express');
        expect(hint!.entryPointMultiplier).toBe(1.8);
    });

    it('detects Express controller', () => {
        const hint = detectFrameworkFromPath('src/controllers/user.ts');
        expect(hint).not.toBeNull();
        expect(hint!.framework).toBe('express');
        expect(hint!.entryPointMultiplier).toBe(1.8);
    });

    it('detects NestJS controller', () => {
        const hint = detectFrameworkFromPath('src/users/users.controller.ts');
        expect(hint).not.toBeNull();
        expect(hint!.framework).toBe('nestjs');
        expect(hint!.entryPointMultiplier).toBe(2.0);
    });

    it('detects NestJS service', () => {
        const hint = detectFrameworkFromPath('src/auth/auth.service.ts');
        expect(hint).not.toBeNull();
        expect(hint!.framework).toBe('nestjs');
        expect(hint!.entryPointMultiplier).toBe(1.5);
    });

    it('detects Django view', () => {
        const hint = detectFrameworkFromPath('app/views.py');
        expect(hint).not.toBeNull();
        expect(hint!.framework).toBe('django');
        expect(hint!.entryPointMultiplier).toBe(2.0);
    });

    it('detects Go CLI entrypoint', () => {
        const hint = detectFrameworkFromPath('cmd/server/main.go');
        expect(hint).not.toBeNull();
        expect(hint!.entryPointMultiplier).toBe(2.0);
    });

    it('detects Go main.go', () => {
        const hint = detectFrameworkFromPath('server/main.go');
        expect(hint).not.toBeNull();
        expect(hint!.framework).toBe('go');
        expect(hint!.entryPointMultiplier).toBe(2.0);
    });

    it('detects Spring controller', () => {
        const hint = detectFrameworkFromPath('com/app/UserController.java');
        expect(hint).not.toBeNull();
        expect(hint!.framework).toBe('spring');
        expect(hint!.entryPointMultiplier).toBe(2.0);
    });

    it('detects Rust main', () => {
        const hint = detectFrameworkFromPath('src/main.rs');
        expect(hint).not.toBeNull();
        expect(hint!.framework).toBe('rust');
        expect(hint!.entryPointMultiplier).toBe(2.0);
    });

    it('detects test files with low multiplier', () => {
        const hint = detectFrameworkFromPath('src/utils.test.ts');
        expect(hint).not.toBeNull();
        expect(hint!.framework).toBe('test');
        expect(hint!.entryPointMultiplier).toBe(0.1);
    });

    it('detects test directory with low multiplier', () => {
        const hint = detectFrameworkFromPath('test/unit/graph.test.ts');
        expect(hint).not.toBeNull();
        expect(hint!.framework).toBe('test');
        expect(hint!.entryPointMultiplier).toBe(0.1);
    });

    it('returns null for unknown paths', () => {
        const hint = detectFrameworkFromPath('src/utils/hash.ts');
        expect(hint).toBeNull();
    });

    it('normalizes Windows backslashes', () => {
        const path = ['src', 'pages', 'api', 'auth.ts'].join('\\');
        const hint = detectFrameworkFromPath(path);
        expect(hint).not.toBeNull();
        expect(hint!.framework).toBe('nextjs');
    });
});

// ─── Name-based Detection ────────────────────────────────────────

describe('detectFrameworkFromName', () => {
    it('detects REST handler (getUser)', () => {
        const hint = detectFrameworkFromName('getUser');
        expect(hint).not.toBeNull();
        expect(hint!.framework).toBe('rest');
        expect(hint!.entryPointMultiplier).toBe(1.5);
    });

    it('detects event handler (handleSubmit)', () => {
        const hint = detectFrameworkFromName('handleSubmit');
        expect(hint).not.toBeNull();
        expect(hint!.framework).toBe('handler');
        expect(hint!.entryPointMultiplier).toBe(1.8);
    });

    it('detects event listener (onClick)', () => {
        const hint = detectFrameworkFromName('onClick');
        expect(hint).not.toBeNull();
        expect(hint!.framework).toBe('event');
        expect(hint!.entryPointMultiplier).toBe(1.5);
    });

    it('detects main function', () => {
        const hint = detectFrameworkFromName('main');
        expect(hint).not.toBeNull();
        expect(hint!.framework).toBe('entry');
        expect(hint!.entryPointMultiplier).toBe(2.0);
    });

    it('detects init/setup/bootstrap', () => {
        for (const name of ['init', 'setup', 'bootstrap', 'start']) {
            const hint = detectFrameworkFromName(name);
            expect(hint).not.toBeNull();
            expect(hint!.framework).toBe('entry');
        }
    });

    it('returns null for unknown names', () => {
        const hint = detectFrameworkFromName('formatDate');
        expect(hint).toBeNull();
    });
});

// ─── Combined Detection ──────────────────────────────────────────

describe('getEntryPointMultiplier', () => {
    it('returns 1.0 for no match', () => {
        const result = getEntryPointMultiplier('src/utils/hash.ts', 'hashFile');
        expect(result.multiplier).toBe(1.0);
    });

    it('uses path hint when no name match', () => {
        const result = getEntryPointMultiplier('src/routes/auth.ts', 'validateToken');
        expect(result.multiplier).toBe(1.8);
        expect(result.framework).toBe('express');
    });

    it('uses name hint when no path match', () => {
        const result = getEntryPointMultiplier('src/utils.ts', 'main');
        expect(result.multiplier).toBe(2.0);
        expect(result.framework).toBe('entry');
    });

    it('uses higher multiplier when both match', () => {
        // Path: NestJS controller (2.0), Name: handler (1.8)
        const result = getEntryPointMultiplier('src/users.controller.ts', 'handleCreate');
        expect(result.multiplier).toBe(2.0);
        expect(result.framework).toBe('nestjs');
    });

    it('picks name over path when name has higher multiplier', () => {
        // Path: express middleware (1.3), Name: main (2.0)
        const result = getEntryPointMultiplier('src/middleware/index.ts', 'main');
        expect(result.multiplier).toBe(2.0);
        expect(result.framework).toBe('entry');
    });
});
