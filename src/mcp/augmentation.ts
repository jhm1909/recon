/**
 * Augmentation Engine
 *
 * Lightweight context injection for agent search patterns.
 * When an agent searches for a symbol, this returns relevant
 * graph context (callers, callees, process participation).
 *
 * Designed to be called from hooks or as an MCP tool.
 */

import type { KnowledgeGraph } from '../graph/graph.js';
import { detectProcesses } from '../graph/process.js';

/**
 * Augment a search pattern with knowledge graph context.
 *
 * 1. Find matching nodes by name
 * 2. For each match, fetch callers/callees
 * 3. Check process participation
 * 4. Format as compact text block
 *
 * Returns empty string if nothing found (graceful).
 */
export function augment(
    pattern: string,
    graph: KnowledgeGraph,
): string {
    if (!pattern || pattern.length < 2) return '';

    try {
        const matches = graph.findByName(pattern);
        if (matches.length === 0) return '';

        // Prefer exact name match, then exported
        let best = matches.find(n => n.name === pattern && n.exported)
            || matches.find(n => n.name === pattern)
            || matches[0];

        const lines: string[] = [];

        // Identity
        lines.push(`📍 **${best.name}** (${best.type}) — \`${best.file}:${best.startLine}\``);

        // Callers
        const incoming = graph.getIncoming(best.id);
        const callers = incoming
            .filter(e => e.type === 'CALLS' || e.type === 'CALLS_API')
            .map(e => {
                const caller = graph.getNode(e.sourceId);
                return caller ? caller.name : null;
            })
            .filter(Boolean);

        if (callers.length > 0) {
            lines.push(`⬆️ Called by: ${callers.slice(0, 5).join(', ')}${callers.length > 5 ? ` (+${callers.length - 5} more)` : ''}`);
        }

        // Callees
        const outgoing = graph.getOutgoing(best.id);
        const callees = outgoing
            .filter(e => e.type === 'CALLS' || e.type === 'CALLS_API')
            .map(e => {
                const callee = graph.getNode(e.targetId);
                return callee ? callee.name : null;
            })
            .filter(Boolean);

        if (callees.length > 0) {
            lines.push(`⬇️ Calls: ${callees.slice(0, 5).join(', ')}${callees.length > 5 ? ` (+${callees.length - 5} more)` : ''}`);
        }

        // Process participation
        const processes = detectProcesses(graph, { limit: 50 });
        const participating = processes.filter(p =>
            p.steps.some(s => s.name === best.name && s.file === best.file),
        );

        if (participating.length > 0) {
            for (const p of participating.slice(0, 3)) {
                const stepIdx = p.steps.findIndex(s => s.name === best.name && s.file === best.file);
                lines.push(`🔄 Flow: **${p.label}** (step ${stepIdx + 1}/${p.steps.length})`);
            }
        }

        // Community
        if (best.community) {
            lines.push(`📦 Community: ${best.community}`);
        }

        // Upstream count for impact hint
        const upstreamCount = callers.length;
        if (upstreamCount >= 5) {
            lines.push(`⚠️ High blast radius: ${upstreamCount} callers. Run \`recon_impact\` before editing.`);
        }

        return lines.join('\n');
    } catch {
        return ''; // Graceful failure
    }
}
