import type { Dataset, Environment, PolicyGraph, PolicyIssue, Rule, ServerRole } from '@/types';
import { enumeratePorts, isAnyPort, serviceForPort } from './ports';
import { isolatedServers } from './graph';
import { effectivePorts } from './duplicates';

export interface DashboardStats {
  totalServers: number;
  unresolvedEndpoints: number;
  totalRules: number;
  disabledRules: number;
  allowedConnections: number;
  deniedConnections: number;
  uniquePorts: number;
  potentialConflicts: number;
  duplicateRules: number;
  isolatedServers: number;
  highRiskConnections: number;
}

export interface CountPoint {
  label: string;
  value: number;
  secondary?: number;
  key?: string;
}

export interface PortUsage {
  port: number;
  protocols: string[];
  service: string | null;
  serviceDescription: string | null;
  ruleCount: number;
  serverCount: number;
  allowCount: number;
  denyCount: number;
  ruleIds: string[];
  serverIds: string[];
}

/**
 * A connection is counted as high risk when it permits access that is
 * conventionally treated as sensitive: an administrative port, a database port
 * reaching a database server, or unrestricted port/protocol access.
 */
export function isHighRiskConnection(rule: Rule, graph: PolicyGraph): boolean {
  if (rule.action !== 'ALLOW' || rule.disabled) return false;
  const ports = effectivePorts(rule);
  if (isAnyPort(ports) || rule.protocol === 'ANY') return true;

  const destination = graph.serversById.get(rule.destination);
  const source = graph.serversById.get(rule.source);
  const discrete = enumeratePorts(ports, 256);

  const sensitive = discrete.some((port) => [22, 23, 135, 139, 445, 3389, 5985, 5986].includes(port));
  if (sensitive) return true;

  const databasePort = discrete.some((port) => [1433, 1521, 3306, 5432, 6379, 9200, 27017].includes(port));
  if (databasePort && destination?.role === 'DB') {
    // Web tiers reaching a database directly, or cross-environment database
    // access, are the cases worth flagging.
    if (source?.role === 'WEB') return true;
    if (source && destination && source.environment !== destination.environment) return true;
  }
  return false;
}

export function calculateStats(
  dataset: Dataset,
  graph: PolicyGraph,
  issues: PolicyIssue[],
): DashboardStats {
  const allowRules = dataset.rules.filter((rule) => rule.action === 'ALLOW' && !rule.disabled);
  const denyRules = dataset.rules.filter((rule) => rule.action === 'DENY' && !rule.disabled);

  const ports = new Set<number>();
  let anyPortSeen = false;
  for (const rule of dataset.rules) {
    if (rule.disabled) continue;
    if (isAnyPort(rule.ports)) {
      anyPortSeen = true;
      continue;
    }
    for (const port of enumeratePorts(rule.ports, 256)) ports.add(port);
  }

  return {
    totalServers: dataset.servers.filter((server) => !server.synthetic).length,
    unresolvedEndpoints: dataset.servers.filter((server) => server.synthetic).length,
    totalRules: dataset.rules.length,
    disabledRules: dataset.rules.filter((rule) => rule.disabled).length,
    allowedConnections: allowRules.length,
    deniedConnections: denyRules.length,
    uniquePorts: ports.size + (anyPortSeen ? 1 : 0),
    potentialConflicts: issues.filter((issue) => issue.category === 'ALLOW_DENY_CONFLICT').length,
    duplicateRules: issues
      .filter((issue) => issue.category === 'EXACT_DUPLICATE')
      .reduce((total, issue) => total + Math.max(issue.ruleIds.length - 1, 0), 0),
    isolatedServers: isolatedServers(graph).length,
    highRiskConnections: dataset.rules.filter((rule) => isHighRiskConnection(rule, graph)).length,
  };
}

/* ------------------------------------------------------------------ *
 * Chart series
 * ------------------------------------------------------------------ */

export function connectionsByRole(dataset: Dataset, graph: PolicyGraph): CountPoint[] {
  const counts = new Map<ServerRole, number>();
  for (const rule of dataset.rules) {
    if (rule.disabled) continue;
    const source = graph.serversById.get(rule.source);
    if (!source) continue;
    counts.set(source.role, (counts.get(source.role) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([role, value]) => ({ label: role, value, key: role }))
    .sort((a, b) => b.value - a.value);
}

export function allowVsDeny(dataset: Dataset): CountPoint[] {
  const allow = dataset.rules.filter((rule) => rule.action === 'ALLOW' && !rule.disabled).length;
  const deny = dataset.rules.filter((rule) => rule.action === 'DENY' && !rule.disabled).length;
  return [
    { label: 'ALLOW', value: allow, key: 'ALLOW' },
    { label: 'DENY', value: deny, key: 'DENY' },
  ];
}

export function rulesByProtocol(dataset: Dataset): CountPoint[] {
  const counts = new Map<string, number>();
  for (const rule of dataset.rules) {
    if (rule.disabled) continue;
    counts.set(rule.protocol, (counts.get(rule.protocol) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value, key: label }))
    .sort((a, b) => b.value - a.value);
}

export function environmentDistribution(dataset: Dataset): CountPoint[] {
  const counts = new Map<Environment, number>();
  for (const server of dataset.servers) {
    if (server.synthetic) continue;
    counts.set(server.environment, (counts.get(server.environment) ?? 0) + 1);
  }
  const order: Environment[] = ['PROD', 'UAT', 'DEV', 'UNKNOWN'];
  return order
    .filter((environment) => counts.has(environment))
    .map((environment) => ({ label: environment, value: counts.get(environment) ?? 0, key: environment }));
}

export function topPorts(dataset: Dataset, limit = 8): CountPoint[] {
  const usage = portUsage(dataset, null);
  return usage.slice(0, limit).map((entry) => ({
    label: entry.service ? `${entry.port} ${entry.service}` : String(entry.port),
    value: entry.ruleCount,
    key: String(entry.port),
  }));
}

export function busiestServers(dataset: Dataset, graph: PolicyGraph, limit = 8): CountPoint[] {
  const counts = new Map<string, { inbound: number; outbound: number }>();
  for (const rule of dataset.rules) {
    if (rule.disabled) continue;
    const out = counts.get(rule.source) ?? { inbound: 0, outbound: 0 };
    out.outbound += 1;
    counts.set(rule.source, out);
    const inbound = counts.get(rule.destination) ?? { inbound: 0, outbound: 0 };
    inbound.inbound += 1;
    counts.set(rule.destination, inbound);
  }

  return [...counts.entries()]
    .map(([serverId, entry]) => ({
      label: graph.serversById.get(serverId)?.name ?? serverId,
      value: entry.inbound + entry.outbound,
      secondary: entry.inbound,
      key: serverId,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

/* ------------------------------------------------------------------ *
 * Port explorer
 * ------------------------------------------------------------------ */

/**
 * Port-by-port usage across the policy. Rules covering "any port" are reported
 * separately rather than being expanded into 65,536 rows.
 */
export function portUsage(dataset: Dataset, graph: PolicyGraph | null): PortUsage[] {
  const map = new Map<number, PortUsage>();
  const anyEntry: PortUsage = {
    port: -1,
    protocols: [],
    service: 'ANY',
    serviceDescription: 'Rules that cover every port',
    ruleCount: 0,
    serverCount: 0,
    allowCount: 0,
    denyCount: 0,
    ruleIds: [],
    serverIds: [],
  };
  const anyServers = new Set<string>();
  const perPortServers = new Map<number, Set<string>>();

  for (const rule of dataset.rules) {
    if (rule.disabled) continue;
    const ports = effectivePorts(rule);

    if (isAnyPort(ports)) {
      anyEntry.ruleCount += 1;
      anyEntry.ruleIds.push(rule.id);
      if (rule.action === 'ALLOW') anyEntry.allowCount += 1;
      else anyEntry.denyCount += 1;
      if (!anyEntry.protocols.includes(rule.protocol)) anyEntry.protocols.push(rule.protocol);
      anyServers.add(rule.source);
      anyServers.add(rule.destination);
      continue;
    }

    for (const port of enumeratePorts(ports, 256)) {
      let entry = map.get(port);
      if (!entry) {
        const service = serviceForPort(port);
        entry = {
          port,
          protocols: [],
          service: service?.name ?? null,
          serviceDescription: service?.description ?? null,
          ruleCount: 0,
          serverCount: 0,
          allowCount: 0,
          denyCount: 0,
          ruleIds: [],
          serverIds: [],
        };
        map.set(port, entry);
        perPortServers.set(port, new Set());
      }
      entry.ruleCount += 1;
      entry.ruleIds.push(rule.id);
      if (rule.action === 'ALLOW') entry.allowCount += 1;
      else entry.denyCount += 1;
      if (!entry.protocols.includes(rule.protocol)) entry.protocols.push(rule.protocol);
      const servers = perPortServers.get(port)!;
      servers.add(rule.source);
      servers.add(rule.destination);
    }
  }

  for (const [port, servers] of perPortServers) {
    const entry = map.get(port);
    if (!entry) continue;
    entry.serverCount = servers.size;
    entry.serverIds = [...servers];
  }
  anyEntry.serverCount = anyServers.size;
  anyEntry.serverIds = [...anyServers];

  const result = [...map.values()].sort((a, b) => b.ruleCount - a.ruleCount || a.port - b.port);
  if (anyEntry.ruleCount > 0) result.unshift(anyEntry);
  void graph;
  return result;
}

/* ------------------------------------------------------------------ *
 * Per-server summaries
 * ------------------------------------------------------------------ */

export interface ServerSummary {
  serverId: string;
  inboundRules: number;
  outboundRules: number;
  totalConnections: number;
  allowedConnections: number;
  deniedConnections: number;
  ports: number[];
  anyPort: boolean;
  protocols: string[];
  neighbours: string[];
  ruleIds: string[];
}

export function summariseServer(serverId: string, dataset: Dataset): ServerSummary {
  const inbound = dataset.rules.filter((rule) => rule.destination === serverId && !rule.disabled);
  const outbound = dataset.rules.filter((rule) => rule.source === serverId && !rule.disabled);
  const all = [...inbound, ...outbound];

  const ports = new Set<number>();
  let anyPort = false;
  const protocols = new Set<string>();
  const neighbours = new Set<string>();

  for (const rule of all) {
    const effective = effectivePorts(rule);
    if (isAnyPort(effective)) anyPort = true;
    else for (const port of enumeratePorts(effective, 128)) ports.add(port);
    protocols.add(rule.protocol);
    neighbours.add(rule.source === serverId ? rule.destination : rule.source);
  }
  neighbours.delete(serverId);

  return {
    serverId,
    inboundRules: inbound.length,
    outboundRules: outbound.length,
    totalConnections: all.length,
    allowedConnections: all.filter((rule) => rule.action === 'ALLOW').length,
    deniedConnections: all.filter((rule) => rule.action === 'DENY').length,
    ports: [...ports].sort((a, b) => a - b),
    anyPort,
    protocols: [...protocols],
    neighbours: [...neighbours],
    ruleIds: all.map((rule) => rule.id),
  };
}

export function summariseAllServers(dataset: Dataset): Map<string, ServerSummary> {
  const summaries = new Map<string, ServerSummary>();
  for (const server of dataset.servers) summaries.set(server.id, emptySummary(server.id));

  for (const rule of dataset.rules) {
    if (rule.disabled) continue;
    const source = summaries.get(rule.source);
    const destination = summaries.get(rule.destination);
    const effective = effectivePorts(rule);
    const any = isAnyPort(effective);
    const discrete = any ? [] : enumeratePorts(effective, 128);

    if (source) {
      source.outboundRules += 1;
      source.totalConnections += 1;
      if (rule.action === 'ALLOW') source.allowedConnections += 1;
      else source.deniedConnections += 1;
      source.anyPort ||= any;
      for (const port of discrete) if (!source.ports.includes(port)) source.ports.push(port);
      if (!source.protocols.includes(rule.protocol)) source.protocols.push(rule.protocol);
      if (rule.destination !== rule.source && !source.neighbours.includes(rule.destination)) {
        source.neighbours.push(rule.destination);
      }
      source.ruleIds.push(rule.id);
    }
    if (destination) {
      destination.inboundRules += 1;
      destination.totalConnections += 1;
      if (rule.action === 'ALLOW') destination.allowedConnections += 1;
      else destination.deniedConnections += 1;
      destination.anyPort ||= any;
      for (const port of discrete) if (!destination.ports.includes(port)) destination.ports.push(port);
      if (!destination.protocols.includes(rule.protocol)) destination.protocols.push(rule.protocol);
      if (rule.destination !== rule.source && !destination.neighbours.includes(rule.source)) {
        destination.neighbours.push(rule.source);
      }
      destination.ruleIds.push(rule.id);
    }
  }

  for (const summary of summaries.values()) summary.ports.sort((a, b) => a - b);
  return summaries;
}

function emptySummary(serverId: string): ServerSummary {
  return {
    serverId,
    inboundRules: 0,
    outboundRules: 0,
    totalConnections: 0,
    allowedConnections: 0,
    deniedConnections: 0,
    ports: [],
    anyPort: false,
    protocols: [],
    neighbours: [],
    ruleIds: [],
  };
}
