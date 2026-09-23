import type { AffectedServer, ImpactLevel, PolicyGraph, Rule } from '@/types';
import { formatPorts } from './ports';
import { neighboursOf, serverName } from './graph';

const LEVEL_ORDER: Record<ImpactLevel, number> = {
  DIRECT: 0,
  ONE_HOP: 1,
  TWO_HOP: 2,
  DOWNSTREAM: 3,
};

/**
 * Servers directly named by a change: the source and destination of the rule
 * being added, modified, removed or disabled.
 */
export function calculateAffectedServers(
  graph: PolicyGraph,
  original: Rule | null,
  proposed: Rule | null,
): AffectedServer[] {
  const map = new Map<string, AffectedServer>();

  const add = (serverId: string, reason: string): void => {
    const existing = map.get(serverId);
    if (existing) {
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
      return;
    }
    map.set(serverId, { serverId, level: 'DIRECT', reasons: [reason] });
  };

  if (original && proposed) {
    const changes: string[] = [];
    if (original.protocol !== proposed.protocol) {
      changes.push(`protocol changes from ${original.protocol} to ${proposed.protocol}`);
    }
    if (formatPorts(original.ports) !== formatPorts(proposed.ports)) {
      changes.push(`ports change from ${formatPorts(original.ports)} to ${formatPorts(proposed.ports)}`);
    }
    if (original.action !== proposed.action) {
      changes.push(`action changes from ${original.action} to ${proposed.action}`);
    }
    if (original.source !== proposed.source) {
      changes.push(`source changes from ${serverName(graph, original.source)} to ${serverName(graph, proposed.source)}`);
    }
    if (original.destination !== proposed.destination) {
      changes.push(
        `destination changes from ${serverName(graph, original.destination)} to ${serverName(graph, proposed.destination)}`,
      );
    }
    if (original.disabled !== proposed.disabled) {
      changes.push(proposed.disabled ? 'rule is being disabled' : 'rule is being enabled');
    }
    const summary = changes.length > 0 ? changes.join('; ') : 'rule is being edited';

    for (const id of new Set([original.source, original.destination, proposed.source, proposed.destination])) {
      add(id, `Named directly by the rule being changed (${summary}).`);
    }
  } else if (proposed) {
    add(proposed.source, `Named as the source of the new rule "${proposed.name}".`);
    add(proposed.destination, `Named as the destination of the new rule "${proposed.name}".`);
  } else if (original) {
    add(original.source, `Named as the source of the rule being removed ("${original.name}").`);
    add(original.destination, `Named as the destination of the rule being removed ("${original.name}").`);
  }

  return [...map.values()];
}

export interface BlastRadiusOptions {
  /** How far to expand beyond the directly affected servers. */
  maxDepth?: number;
  /** When true, only ALLOW connections are followed when expanding outward. */
  allowedOnly?: boolean;
  /** Hard cap so very dense graphs stay readable. */
  maxServers?: number;
}

/**
 * Expand the directly affected servers outward through existing connectivity.
 *
 * The result is a reachability estimate, not a prediction of failure: a server
 * appearing at "2 hops" means it is two permitted network hops away from a
 * server named in the change, and every entry carries the reason it is listed.
 */
export function calculateBlastRadius(
  graph: PolicyGraph,
  seeds: AffectedServer[],
  options: BlastRadiusOptions = {},
): AffectedServer[] {
  const { maxDepth = 3, allowedOnly = true, maxServers = 250 } = options;

  const result = new Map<string, AffectedServer>();
  for (const seed of seeds) {
    if (!graph.nodes.has(seed.serverId)) continue;
    result.set(seed.serverId, { ...seed, level: 'DIRECT', reasons: [...seed.reasons] });
  }

  let frontier = [...result.keys()];
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const level: ImpactLevel = depth === 1 ? 'ONE_HOP' : depth === 2 ? 'TWO_HOP' : 'DOWNSTREAM';
    const next: string[] = [];

    for (const serverId of frontier) {
      const fromName = serverName(graph, serverId);
      for (const neighbour of neighboursOf(graph, serverId, { allowedOnly })) {
        if (result.size >= maxServers) break;
        const existing = result.get(neighbour);
        const reason = `${describeLink(graph, serverId, neighbour)} — ${depth === 1 ? 'one' : depth === 2 ? 'two' : `${depth}`} network hop${depth === 1 ? '' : 's'} from ${fromName}, which is directly affected by this change.`;

        if (existing) {
          // Keep the closest level found, but record additional reasoning.
          if (LEVEL_ORDER[level] < LEVEL_ORDER[existing.level]) existing.level = level;
          continue;
        }
        result.set(neighbour, { serverId: neighbour, level, reasons: [reason] });
        next.push(neighbour);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  return [...result.values()].sort(
    (a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.serverId.localeCompare(b.serverId),
  );
}

function describeLink(graph: PolicyGraph, from: string, to: string): string {
  const connection = (graph.bySource.get(from) ?? []).find(
    (candidate) => candidate.destination === to && candidate.action === 'ALLOW',
  );
  if (connection) {
    return `${serverName(graph, to)} has a permitted ${connection.protocol} ${formatPorts(connection.ports)} connection from ${serverName(graph, from)}`;
  }
  const reverse = (graph.bySource.get(to) ?? []).find(
    (candidate) => candidate.destination === from && candidate.action === 'ALLOW',
  );
  if (reverse) {
    return `${serverName(graph, to)} has a permitted ${reverse.protocol} ${formatPorts(reverse.ports)} connection to ${serverName(graph, from)}`;
  }
  return `${serverName(graph, to)} is connected to ${serverName(graph, from)}`;
}

export function groupByLevel(servers: AffectedServer[]): Record<ImpactLevel, AffectedServer[]> {
  const grouped: Record<ImpactLevel, AffectedServer[]> = {
    DIRECT: [],
    ONE_HOP: [],
    TWO_HOP: [],
    DOWNSTREAM: [],
  };
  for (const server of servers) grouped[server.level].push(server);
  return grouped;
}

export const IMPACT_LEVEL_LABEL: Record<ImpactLevel, string> = {
  DIRECT: 'Direct impact',
  ONE_HOP: '1 hop impact',
  TWO_HOP: '2 hop impact',
  DOWNSTREAM: 'Downstream impact',
};

export const IMPACT_LEVEL_DESCRIPTION: Record<ImpactLevel, string> = {
  DIRECT: 'Named explicitly in the rule being changed.',
  ONE_HOP: 'One permitted network hop from a directly affected server.',
  TWO_HOP: 'Two permitted network hops from a directly affected server.',
  DOWNSTREAM: 'Three or more permitted hops away, reachable through the affected servers.',
};
