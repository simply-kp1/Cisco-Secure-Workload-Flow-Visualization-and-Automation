import type { Dataset, PolicyGraph, PolicyIssue, ValidationReport } from '@/types';
import { findConflicts } from './conflicts';
import { findDuplicates, findOverlaps, findOverlyBroadRules, findRedundantRules } from './duplicates';
import { isolatedServers, serverName } from './graph';
import { KNOWN_PROTOCOLS } from './ports';

/**
 * Produce the full, automatically generated issues list for the Conflicts page.
 * Every issue carries the rules and servers it concerns so the UI can highlight
 * them on the topology.
 */
export function findAllIssues(
  dataset: Dataset,
  graph: PolicyGraph,
  validation: ValidationReport | null = null,
): PolicyIssue[] {
  const issues: PolicyIssue[] = [
    ...findDuplicates(dataset.rules, graph),
    ...findConflicts(dataset.rules, graph),
    ...findOverlaps(dataset.rules, graph),
    ...findRedundantRules(dataset.rules, graph),
    ...findOverlyBroadRules(dataset.rules, graph),
    ...findMissingServerIssues(dataset, graph),
    ...findInvalidPortIssues(dataset, validation),
    ...findUnknownProtocolIssues(dataset, graph),
    ...findOrphanedRuleIssues(dataset, graph),
    ...findIsolatedServerIssues(graph),
  ];

  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const;
  return issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.title.localeCompare(b.title));
}

/** Rules pointing at endpoints that are not in the server inventory. */
function findMissingServerIssues(dataset: Dataset, graph: PolicyGraph): PolicyIssue[] {
  const byEndpoint = new Map<string, string[]>();
  for (const rule of dataset.rules) {
    for (const endpoint of [rule.source, rule.destination]) {
      const server = graph.serversById.get(endpoint);
      if (!server?.synthetic) continue;
      const list = byEndpoint.get(endpoint) ?? [];
      list.push(rule.id);
      byEndpoint.set(endpoint, list);
    }
  }

  return [...byEndpoint.entries()].map(([endpoint, ruleIds]) => ({
    id: `missing-server:${endpoint}`,
    category: 'MISSING_SERVER' as const,
    severity: 'medium' as const,
    title: `"${endpoint}" is referenced by ${ruleIds.length} rule${ruleIds.length === 1 ? '' : 's'} but is not in the inventory`,
    explanation: `${ruleIds.length} rule${ruleIds.length === 1 ? ' refers' : 's refer'} to "${endpoint}", which does not appear in the server list. It may be an external service, a shared platform endpoint, or a gap in the inventory. Its role, environment and owner cannot be determined from this dataset, so any analysis involving it is incomplete.`,
    ruleIds,
    serverIds: [endpoint],
    evidence: ruleIds.slice(0, 8).map((id) => {
      const rule = graph.rulesById.get(id);
      return rule ? `${id} — "${rule.name}"` : id;
    }),
  }));
}

/** Port values the importer could not read. */
function findInvalidPortIssues(dataset: Dataset, validation: ValidationReport | null): PolicyIssue[] {
  const fromValidation = (validation?.issues ?? []).filter((issue) => issue.code === 'MALFORMED_PORT');
  return fromValidation.map((issue) => {
    const rule = dataset.rules.find((candidate) => candidate.id === issue.entityId);
    return {
      id: `invalid-port:${issue.entityId}`,
      category: 'INVALID_PORT' as const,
      severity: 'medium' as const,
      title: `Rule "${rule?.name ?? issue.entityId}" has port values that could not be read`,
      explanation:
        issue.detail ??
        'One or more port values in this rule could not be interpreted, so they are excluded from connectivity analysis.',
      ruleIds: issue.entityId ? [issue.entityId] : [],
      serverIds: rule ? [rule.source, rule.destination] : [],
      evidence: [issue.message],
    };
  });
}

function findUnknownProtocolIssues(dataset: Dataset, graph: PolicyGraph): PolicyIssue[] {
  const known = new Set<string>(KNOWN_PROTOCOLS);
  const byProtocol = new Map<string, string[]>();
  for (const rule of dataset.rules) {
    if (known.has(rule.protocol)) continue;
    const list = byProtocol.get(rule.protocol) ?? [];
    list.push(rule.id);
    byProtocol.set(rule.protocol, list);
  }

  return [...byProtocol.entries()].map(([protocol, ruleIds]) => ({
    id: `unknown-protocol:${protocol}`,
    category: 'UNKNOWN_PROTOCOL' as const,
    severity: 'low' as const,
    title: `Unrecognised protocol "${protocol}" used by ${ruleIds.length} rule${ruleIds.length === 1 ? '' : 's'}`,
    explanation: `"${protocol}" is not one of TCP, UDP, ICMP or ANY. The rules are kept and matched literally against other rules using the same protocol, but overlap detection with standard protocols is not possible.`,
    ruleIds,
    serverIds: [...new Set(ruleIds.flatMap((id) => {
      const rule = graph.rulesById.get(id);
      return rule ? [rule.source, rule.destination] : [];
    }))],
    evidence: ruleIds.slice(0, 8),
  }));
}

/** Disabled rules, and rules whose endpoints resolve to nothing meaningful. */
function findOrphanedRuleIssues(dataset: Dataset, graph: PolicyGraph): PolicyIssue[] {
  const issues: PolicyIssue[] = [];
  for (const rule of dataset.rules) {
    const sourceMissing = !graph.serversById.has(rule.source);
    const destinationMissing = !graph.serversById.has(rule.destination);
    if (!sourceMissing && !destinationMissing) continue;

    issues.push({
      id: `orphan:${rule.id}`,
      category: 'ORPHANED_RULE',
      severity: 'high',
      title: `Rule "${rule.name}" cannot be placed on the map`,
      explanation: `This rule references ${[sourceMissing ? `a source "${rule.source}"` : null, destinationMissing ? `a destination "${rule.destination}"` : null].filter(Boolean).join(' and ')} that could not be resolved to any endpoint. The rule is excluded from connectivity analysis.`,
      ruleIds: [rule.id],
      serverIds: [],
      evidence: [`${rule.source} → ${rule.destination} ${rule.protocol} ${rule.action}`],
    });
  }
  return issues;
}

function findIsolatedServerIssues(graph: PolicyGraph): PolicyIssue[] {
  const isolated = isolatedServers(graph);
  if (isolated.length === 0) return [];

  return isolated.map((serverId) => ({
    id: `isolated:${serverId}`,
    category: 'ISOLATED_SERVER' as const,
    severity: 'info' as const,
    title: `${serverName(graph, serverId)} has no connections in the policy`,
    explanation: `No rule names ${serverName(graph, serverId)} as either a source or a destination. The server may be genuinely unused, covered by a policy that is not in this export, or missing from the rule set.`,
    ruleIds: [],
    serverIds: [serverId],
    evidence: ['0 inbound connections', '0 outbound connections'],
  }));
}

export const ISSUE_CATEGORY_LABEL: Record<PolicyIssue['category'], string> = {
  EXACT_DUPLICATE: 'Exact duplicate',
  POTENTIAL_DUPLICATE: 'Potential duplicate',
  ALLOW_DENY_CONFLICT: 'ALLOW/DENY conflict',
  PORT_OVERLAP: 'Port overlap',
  REDUNDANT_RULE: 'Redundant rule',
  MISSING_SERVER: 'Missing server',
  INVALID_PORT: 'Invalid port',
  UNKNOWN_PROTOCOL: 'Unknown protocol',
  ORPHANED_RULE: 'Orphaned rule',
  OVERLY_BROAD_RULE: 'Overly broad rule',
  ISOLATED_SERVER: 'Isolated server',
  POTENTIAL_BROKEN_PATH: 'Potential broken path',
};
