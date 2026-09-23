import type { Connection, Dataset, PolicyGraph, Rule, Server } from '@/types';
import { formatPorts, mergeRanges } from './ports';

/**
 * Deterministic identity for a connection: the 5-tuple plus the originating
 * rule. Two rules producing the same 5-tuple yield different connection ids
 * (they are duplicates, not one connection) but the same `flowKey`.
 */
export function connectionId(rule: Rule): string {
  return `${flowKey(rule)}|${rule.id}`;
}

/** SOURCE -> DESTINATION -> PROTOCOL -> PORTS -> ACTION, ignoring which rule said so. */
export function flowKey(rule: Pick<Rule, 'source' | 'destination' | 'protocol' | 'ports' | 'action'>): string {
  const ports = mergeRanges(rule.ports)
    .map((range) => `${range.from}-${range.to}`)
    .join(',');
  return `${rule.source}|${rule.destination}|${rule.protocol}|${ports}|${rule.action}`;
}

export function connectionFromRule(rule: Rule): Connection {
  return {
    id: connectionId(rule),
    ruleId: rule.id,
    source: rule.source,
    destination: rule.destination,
    protocol: rule.protocol,
    ports: mergeRanges(rule.ports),
    action: rule.action,
  };
}

/**
 * Build the policy graph. Disabled rules are retained in `rulesById` (so the UI
 * can show them) but contribute no connections, because a disabled rule grants
 * and denies nothing.
 */
export function buildGraph(dataset: Dataset): PolicyGraph {
  const serversById = new Map<string, Server>();
  for (const server of dataset.servers) serversById.set(server.id, server);

  const rulesById = new Map<string, Rule>();
  for (const rule of dataset.rules) rulesById.set(rule.id, rule);

  const nodes = new Map<string, PolicyGraph['nodes'] extends Map<string, infer T> ? T : never>();
  for (const server of dataset.servers) {
    nodes.set(server.id, { id: server.id, server, inbound: [], outbound: [], degree: 0 });
  }

  const connections: Connection[] = [];
  const bySource = new Map<string, Connection[]>();
  const byDestination = new Map<string, Connection[]>();

  for (const rule of dataset.rules) {
    if (rule.disabled) continue;
    if (!serversById.has(rule.source) || !serversById.has(rule.destination)) continue;

    const connection = connectionFromRule(rule);
    connections.push(connection);

    push(bySource, connection.source, connection);
    push(byDestination, connection.destination, connection);

    const sourceNode = nodes.get(connection.source);
    const destinationNode = nodes.get(connection.destination);
    if (sourceNode) {
      sourceNode.outbound.push(connection.id);
      sourceNode.degree += 1;
    }
    if (destinationNode) {
      destinationNode.inbound.push(connection.id);
      destinationNode.degree += 1;
    }
  }

  return { nodes, connections, bySource, byDestination, rulesById, serversById };
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/* ------------------------------------------------------------------ *
 * Convenience accessors
 * ------------------------------------------------------------------ */

export function outboundOf(graph: PolicyGraph, serverId: string): Connection[] {
  return graph.bySource.get(serverId) ?? [];
}

export function inboundOf(graph: PolicyGraph, serverId: string): Connection[] {
  return graph.byDestination.get(serverId) ?? [];
}

export function connectionsTouching(graph: PolicyGraph, serverId: string): Connection[] {
  return [...outboundOf(graph, serverId), ...inboundOf(graph, serverId)];
}

/** Servers with no connections at all in either direction. */
export function isolatedServers(graph: PolicyGraph): string[] {
  const isolated: string[] = [];
  for (const [id, node] of graph.nodes) {
    if (node.degree === 0) isolated.push(id);
  }
  return isolated;
}

/** Immediate neighbours, optionally restricted to permitted traffic. */
export function neighboursOf(
  graph: PolicyGraph,
  serverId: string,
  options: { allowedOnly?: boolean; direction?: 'both' | 'out' | 'in' } = {},
): Set<string> {
  const { allowedOnly = false, direction = 'both' } = options;
  const result = new Set<string>();
  const accept = (connection: Connection): boolean => !allowedOnly || connection.action === 'ALLOW';

  if (direction === 'both' || direction === 'out') {
    for (const connection of outboundOf(graph, serverId)) {
      if (accept(connection) && connection.destination !== serverId) result.add(connection.destination);
    }
  }
  if (direction === 'both' || direction === 'in') {
    for (const connection of inboundOf(graph, serverId)) {
      if (accept(connection) && connection.source !== serverId) result.add(connection.source);
    }
  }
  return result;
}

export function describeConnection(graph: PolicyGraph, connection: Connection): string {
  const source = graph.serversById.get(connection.source)?.name ?? connection.source;
  const destination = graph.serversById.get(connection.destination)?.name ?? connection.destination;
  const verb = connection.action === 'ALLOW' ? 'may connect to' : 'is blocked from connecting to';
  return `${source} ${verb} ${destination} on ${connection.protocol} ${formatPorts(connection.ports)}`;
}

export function serverName(graph: PolicyGraph, serverId: string): string {
  return graph.serversById.get(serverId)?.name ?? serverId;
}

/** Apply a set of rule mutations to a dataset without mutating the original. */
export function applyRules(dataset: Dataset, rules: Rule[]): Dataset {
  return { ...dataset, rules };
}
