import type { PolicyGraph, PolicyIssue, Rule } from '@/types';
import { formatPorts, intersectRanges, protocolsOverlap } from './ports';
import { serverName } from './graph';
import { effectivePorts } from './duplicates';

function label(graph: PolicyGraph | null, serverId: string): string {
  return graph ? serverName(graph, serverId) : serverId;
}

/**
 * Detect rules that target the same traffic with opposing actions.
 *
 * Which rule wins depends on precedence information that this dataset does not
 * carry, so the finding deliberately stops short of declaring a winner.
 */
export function findConflicts(rules: Rule[], graph: PolicyGraph | null = null): PolicyIssue[] {
  const active = rules.filter((rule) => !rule.disabled);
  const issues: PolicyIssue[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < active.length; i += 1) {
    const a = active[i];
    for (let j = i + 1; j < active.length; j += 1) {
      const b = active[j];
      if (a.action === b.action) continue;
      if (a.source !== b.source || a.destination !== b.destination) continue;
      if (!protocolsOverlap(a.protocol, b.protocol)) continue;

      const shared = intersectRanges(effectivePorts(a), effectivePorts(b));
      if (shared.length === 0) continue;

      const pairKey = [a.id, b.id].sort().join('~');
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      const allow = a.action === 'ALLOW' ? a : b;
      const deny = a.action === 'DENY' ? a : b;
      const sourceName = label(graph, a.source);
      const destinationName = label(graph, a.destination);

      issues.push({
        id: `conflict:${pairKey}`,
        category: 'ALLOW_DENY_CONFLICT',
        severity: 'high',
        title: `ALLOW / DENY conflict: ${sourceName} → ${destinationName}`,
        explanation: `One rule permits and another blocks the same traffic from ${sourceName} to ${destinationName} on ${formatPorts(shared)}. These rules appear to target the same traffic with different actions. Rule precedence must be checked — this application cannot determine which rule takes effect.`,
        ruleIds: [allow.id, deny.id],
        serverIds: [a.source, a.destination],
        evidence: [
          `ALLOW — ${allow.id} "${allow.name}": ${allow.protocol} ${formatPorts(effectivePorts(allow))}`,
          `DENY — ${deny.id} "${deny.name}": ${deny.protocol} ${formatPorts(effectivePorts(deny))}`,
          `Traffic targeted by both: ${formatPorts(shared)}`,
        ],
      });
    }
  }
  return issues;
}

/** Conflicts involving one specific candidate rule (used live in the Rule Builder). */
export function findConflictsOf(candidate: Rule, rules: Rule[]): Rule[] {
  const candidatePorts = effectivePorts(candidate);
  return rules.filter((rule) => {
    if (rule.id === candidate.id || rule.disabled) return false;
    if (rule.action === candidate.action) return false;
    if (rule.source !== candidate.source || rule.destination !== candidate.destination) return false;
    if (!protocolsOverlap(rule.protocol, candidate.protocol)) return false;
    return intersectRanges(effectivePorts(rule), candidatePorts).length > 0;
  });
}
