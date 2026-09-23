import type {
  Connection,
  NetworkPath,
  PathHop,
  PathQueryOptions,
  PolicyGraph,
  PortRange,
  Rule,
} from '@/types';
import { formatPorts, intersectRanges, protocolCovers, rangesCover } from './ports';
import { outboundOf, serverName } from './graph';

const DEFAULT_MAX_HOPS = 4;
const DEFAULT_MAX_RESULTS = 50;

function hopFrom(connection: Connection): PathHop {
  return {
    from: connection.source,
    to: connection.destination,
    ruleId: connection.ruleId,
    protocol: connection.protocol,
    ports: connection.ports,
    action: connection.action,
  };
}

/**
 * Enumerate simple (loop-free) paths between two servers.
 *
 * Depth-first with a visited set, bounded by `maxHops` and `maxResults` so the
 * search stays predictable on large datasets. Each hop is a distinct rule, so
 * two servers connected by three rules yield three one-hop paths — the rule,
 * protocol and ports are part of the answer, not incidental detail.
 */
export function findAllowedPaths(
  graph: PolicyGraph,
  sourceId: string,
  destinationId: string,
  options: PathQueryOptions = {},
): NetworkPath[] {
  const { maxHops = DEFAULT_MAX_HOPS, allowedRulesOnly = true, maxResults = DEFAULT_MAX_RESULTS } = options;

  if (sourceId === destinationId) return [];
  if (!graph.nodes.has(sourceId) || !graph.nodes.has(destinationId)) return [];

  const results: NetworkPath[] = [];
  const visited = new Set<string>([sourceId]);
  const hops: PathHop[] = [];

  const walk = (current: string): void => {
    if (results.length >= maxResults) return;
    if (hops.length >= maxHops) return;

    for (const connection of outboundOf(graph, current)) {
      if (results.length >= maxResults) return;
      if (allowedRulesOnly && connection.action !== 'ALLOW') continue;
      if (connection.destination === connection.source) continue; // ignore self-loops
      if (visited.has(connection.destination) && connection.destination !== destinationId) continue;

      hops.push(hopFrom(connection));

      if (connection.destination === destinationId) {
        results.push(materialise(sourceId, hops));
      } else {
        visited.add(connection.destination);
        walk(connection.destination);
        visited.delete(connection.destination);
      }

      hops.pop();
    }
  };

  walk(sourceId);
  return results.sort((a, b) => a.hopCount - b.hopCount);
}

function materialise(sourceId: string, hops: PathHop[]): NetworkPath {
  const nodes = [sourceId, ...hops.map((hop) => hop.to)];
  return {
    nodes,
    hops: hops.map((hop) => ({ ...hop })),
    hopCount: hops.length,
    permitted: hops.every((hop) => hop.action === 'ALLOW'),
  };
}

/** Every permitted path that traverses a given connection, dataset-wide. */
export function pathsUsingConnection(
  graph: PolicyGraph,
  connection: Connection,
  options: { maxHops?: number; maxResults?: number } = {},
): NetworkPath[] {
  const { maxHops = 3, maxResults = 25 } = options;
  if (connection.action !== 'ALLOW') return [];

  const results: NetworkPath[] = [];
  const upstream = pathsEndingAt(graph, connection.source, maxHops - 1, 12);
  const downstream = pathsStartingAt(graph, connection.destination, maxHops - 1, 12);

  for (const before of upstream) {
    for (const after of downstream) {
      if (results.length >= maxResults) return results;
      // `before` ends at the connection's source and `after` starts at its
      // destination, so the two node lists concatenate without overlap.
      const nodes = [...before.nodes, ...after.nodes];
      // Skip paths that revisit a server.
      if (new Set(nodes).size !== nodes.length) continue;
      const hops = [...before.hops, hopFrom(connection), ...after.hops];
      if (hops.length < 2) continue; // a single hop is the connection itself
      if (hops.length > maxHops) continue;
      results.push({
        nodes,
        hops,
        hopCount: hops.length,
        permitted: hops.every((hop) => hop.action === 'ALLOW'),
      });
    }
  }
  return results.sort((a, b) => a.hopCount - b.hopCount).slice(0, maxResults);
}

/** Permitted partial paths of up to `depth` hops ending at `serverId`. */
function pathsEndingAt(graph: PolicyGraph, serverId: string, depth: number, limit: number): NetworkPath[] {
  const results: NetworkPath[] = [{ nodes: [serverId], hops: [], hopCount: 0, permitted: true }];
  if (depth <= 0) return results;

  const expand = (path: NetworkPath): void => {
    if (results.length >= limit) return;
    const head = path.nodes[0];
    for (const connection of graph.byDestination.get(head) ?? []) {
      if (results.length >= limit) return;
      if (connection.action !== 'ALLOW') continue;
      if (connection.source === head) continue;
      if (path.nodes.includes(connection.source)) continue;
      const next: NetworkPath = {
        nodes: [connection.source, ...path.nodes],
        hops: [hopFrom(connection), ...path.hops],
        hopCount: path.hopCount + 1,
        permitted: true,
      };
      results.push(next);
      if (next.hopCount < depth) expand(next);
    }
  };
  expand(results[0]);
  return results;
}

/** Permitted partial paths of up to `depth` hops starting at `serverId`. */
function pathsStartingAt(graph: PolicyGraph, serverId: string, depth: number, limit: number): NetworkPath[] {
  const results: NetworkPath[] = [{ nodes: [serverId], hops: [], hopCount: 0, permitted: true }];
  if (depth <= 0) return results;

  const expand = (path: NetworkPath): void => {
    if (results.length >= limit) return;
    const tail = path.nodes[path.nodes.length - 1];
    for (const connection of outboundOf(graph, tail)) {
      if (results.length >= limit) return;
      if (connection.action !== 'ALLOW') continue;
      if (connection.destination === tail) continue;
      if (path.nodes.includes(connection.destination)) continue;
      const next: NetworkPath = {
        nodes: [...path.nodes, connection.destination],
        hops: [...path.hops, hopFrom(connection)],
        hopCount: path.hopCount + 1,
        permitted: true,
      };
      results.push(next);
      if (next.hopCount < depth) expand(next);
    }
  };
  expand(results[0]);
  return results;
}

/* ------------------------------------------------------------------ *
 * Alternative connectivity
 * ------------------------------------------------------------------ */

export interface AlternativeConnectivity {
  /** Rules that still permit the same protocol and ports between the same pair. */
  equivalentRuleIds: string[];
  /** True when the remaining rules cover every port of the original. */
  fullyEquivalent: boolean;
  /** Ports that would no longer be permitted directly. */
  lostPorts: PortRange[];
  /** Permitted indirect routes between the same two servers, if any. */
  indirectPaths: NetworkPath[];
  summary: string;
}

/**
 * When a connection is being removed, determine whether equivalent connectivity
 * still exists — either through another rule that permits the same traffic, or
 * through an indirect permitted route.
 */
export function findAlternativePaths(
  graph: PolicyGraph,
  removed: { source: string; destination: string; protocol: string; ports: PortRange[] },
  remainingRules: Rule[],
  options: { maxHops?: number } = {},
): AlternativeConnectivity {
  const { maxHops = 3 } = options;
  const target = removed.ports.length === 0 ? [{ from: 0, to: 65535 }] : removed.ports;

  const equivalent = remainingRules.filter((rule) => {
    if (rule.disabled) return false;
    if (rule.action !== 'ALLOW') return false;
    if (rule.source !== removed.source || rule.destination !== removed.destination) return false;
    if (!protocolCovers(rule.protocol, removed.protocol)) return false;
    const rulePorts = rule.ports.length === 0 ? [{ from: 0, to: 65535 }] : rule.ports;
    return intersectRanges(rulePorts, target).length > 0;
  });

  const combinedPorts = equivalent.flatMap((rule) =>
    rule.ports.length === 0 ? [{ from: 0, to: 65535 }] : rule.ports,
  );
  const fullyEquivalent = equivalent.length > 0 && rangesCover(combinedPorts, target);
  const lostPorts = fullyEquivalent ? [] : subtract(target, combinedPorts);

  const indirectPaths = findAllowedPaths(graph, removed.source, removed.destination, {
    maxHops,
    allowedRulesOnly: true,
    maxResults: 10,
  }).filter((path) => path.hopCount > 1);

  const sourceLabel = serverName(graph, removed.source);
  const destinationLabel = serverName(graph, removed.destination);

  let summary: string;
  if (fullyEquivalent) {
    const names = equivalent.map((rule) => `"${rule.name}"`).slice(0, 2).join(' and ');
    summary = `Connectivity remains available through another rule. ${names} still permit${equivalent.length === 1 ? 's' : ''} ${removed.protocol} ${formatPorts(target)} from ${sourceLabel} to ${destinationLabel}.`;
  } else if (equivalent.length > 0) {
    summary = `Partial connectivity remains: other rules still permit some of this traffic, but ${formatPorts(lostPorts)} would no longer be permitted directly between ${sourceLabel} and ${destinationLabel}.`;
  } else if (indirectPaths.length > 0) {
    summary = `No direct rule would remain between ${sourceLabel} and ${destinationLabel}, but ${indirectPaths.length} indirect permitted route${indirectPaths.length === 1 ? '' : 's'} exist${indirectPaths.length === 1 ? 's' : ''} through other servers. Whether that route carries the same traffic depends on the application.`;
  } else {
    summary = `No alternative network path detected. After this change no rule would permit ${removed.protocol} ${formatPorts(target)} from ${sourceLabel} to ${destinationLabel}.`;
  }

  return {
    equivalentRuleIds: equivalent.map((rule) => rule.id),
    fullyEquivalent,
    lostPorts,
    indirectPaths,
    summary,
  };
}

function subtract(target: PortRange[], cover: PortRange[]): PortRange[] {
  if (cover.length === 0) return target;
  let remaining = target;
  for (const range of cover) {
    const next: PortRange[] = [];
    for (const current of remaining) {
      if (current.to < range.from || current.from > range.to) {
        next.push(current);
        continue;
      }
      if (current.from < range.from) next.push({ from: current.from, to: range.from - 1 });
      if (current.to > range.to) next.push({ from: range.to + 1, to: current.to });
    }
    remaining = next;
  }
  return remaining;
}

/** Human-readable rendering of a path, e.g. "web-srv-01 → app-srv-03 → db-srv-02". */
export function describePath(graph: PolicyGraph, path: NetworkPath): string {
  return path.nodes.map((id) => serverName(graph, id)).join(' → ');
}

export function describePathDetail(graph: PolicyGraph, path: NetworkPath): string[] {
  return path.hops.map((hop) => {
    const rule = graph.rulesById.get(hop.ruleId);
    return `${serverName(graph, hop.from)} → ${serverName(graph, hop.to)} on ${hop.protocol} ${formatPorts(hop.ports)} (${hop.action}${rule ? `, rule "${rule.name}"` : ''})`;
  });
}
