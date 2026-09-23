import type { Dataset, PolicyGraph, SearchResult, TopologyFilters } from '@/types';
import { formatPorts, parsePortToken, rangeContains, serviceForPort } from './ports';
import { effectivePorts } from './duplicates';

/**
 * Global search across servers, rules, ports and connections.
 *
 * Understands a handful of shorthand forms that network engineers actually
 * type, so `TCP 1433`, `APP -> DB` and `DENY` all do something sensible.
 */
export function globalSearch(query: string, dataset: Dataset, graph: PolicyGraph, limit = 40): SearchResult[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const lower = trimmed.toLowerCase();
  const results: SearchResult[] = [];

  const parsed = parseQuery(trimmed);

  /* ---- servers ---- */
  for (const server of dataset.servers) {
    let score = 0;
    if (server.name.toLowerCase() === lower) score = 100;
    else if (server.ip.toLowerCase() === lower) score = 95;
    else if (server.name.toLowerCase().includes(lower)) score = 70;
    else if (server.ip.toLowerCase().includes(lower)) score = 65;
    else if (server.id.toLowerCase().includes(lower)) score = 60;
    else if (server.os.toLowerCase().includes(lower)) score = 30;
    else if (server.zone.toLowerCase() === lower) score = 40;
    else if (server.role.toLowerCase() === lower) score = 45;
    else if (server.environment.toLowerCase() === lower) score = 45;
    if (score === 0) continue;

    results.push({
      kind: 'server',
      id: server.id,
      title: server.name,
      subtitle: `${server.role} · ${server.environment} · ${server.ip || 'no IP'}${server.zone ? ` · ${server.zone}` : ''}`,
      badge: server.synthetic ? 'Unresolved' : server.role,
      serverIds: [server.id],
      ruleIds: [],
      score,
    });
  }

  /* ---- rules ---- */
  for (const rule of dataset.rules) {
    const source = graph.serversById.get(rule.source);
    const destination = graph.serversById.get(rule.destination);
    const ports = effectivePorts(rule);
    let score = 0;

    if (rule.id.toLowerCase() === lower) score = 100;
    else if (rule.name.toLowerCase() === lower) score = 95;
    else if (rule.name.toLowerCase().includes(lower)) score = 68;
    else if (rule.id.toLowerCase().includes(lower)) score = 55;
    else if (rule.description.toLowerCase().includes(lower)) score = 35;

    /* Structured query matching. */
    if (parsed.action && rule.action === parsed.action) score = Math.max(score, 50);
    if (parsed.protocol && rule.protocol === parsed.protocol) score = Math.max(score, 45);
    if (parsed.port !== null && rangeContains(ports, parsed.port)) score = Math.max(score, 80);
    if (parsed.protocol && parsed.port !== null) {
      if (rule.protocol === parsed.protocol && rangeContains(ports, parsed.port)) score = 92;
    }
    if (parsed.sourceToken || parsed.destinationToken) {
      const sourceMatch = parsed.sourceToken
        ? matchesEndpoint(parsed.sourceToken, source?.name, source?.role, source?.environment)
        : true;
      const destinationMatch = parsed.destinationToken
        ? matchesEndpoint(parsed.destinationToken, destination?.name, destination?.role, destination?.environment)
        : true;
      if (sourceMatch && destinationMatch) score = Math.max(score, 88);
    }
    if (score === 0) continue;

    results.push({
      kind: 'rule',
      id: rule.id,
      title: rule.name,
      subtitle: `${source?.name ?? rule.source} → ${destination?.name ?? rule.destination} · ${rule.protocol} ${formatPorts(ports)}`,
      badge: rule.action,
      serverIds: [rule.source, rule.destination],
      ruleIds: [rule.id],
      score,
    });
  }

  /* ---- ports ---- */
  if (parsed.port !== null) {
    const matching = dataset.rules.filter(
      (rule) => !rule.disabled && rangeContains(effectivePorts(rule), parsed.port!),
    );
    if (matching.length > 0) {
      const service = serviceForPort(parsed.port);
      results.push({
        kind: 'port',
        id: `port:${parsed.port}`,
        title: service ? `Port ${parsed.port} — ${service.name}` : `Port ${parsed.port}`,
        subtitle: `${matching.length} rule${matching.length === 1 ? '' : 's'} reference this port`,
        badge: 'Port',
        serverIds: [...new Set(matching.flatMap((rule) => [rule.source, rule.destination]))],
        ruleIds: matching.map((rule) => rule.id),
        score: 90,
      });
    }
  }

  return results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}

function matchesEndpoint(token: string, name?: string, role?: string, environment?: string): boolean {
  const lower = token.toLowerCase();
  if (name && name.toLowerCase().includes(lower)) return true;
  if (role && role.toLowerCase() === lower) return true;
  if (environment && environment.toLowerCase() === lower) return true;
  return false;
}

export interface ParsedQuery {
  protocol: string | null;
  port: number | null;
  action: 'ALLOW' | 'DENY' | null;
  sourceToken: string | null;
  destinationToken: string | null;
  text: string;
}

/**
 * Understand shorthand such as:
 *   "TCP 1433"        protocol + port
 *   "APP -> DB"       source role to destination role
 *   "DENY"            action
 *   "443"             bare port
 */
export function parseQuery(query: string): ParsedQuery {
  const result: ParsedQuery = {
    protocol: null,
    port: null,
    action: null,
    sourceToken: null,
    destinationToken: null,
    text: query,
  };

  const arrow = query.match(/^(.+?)\s*(?:->|→|=>|\bto\b)\s*(.+)$/i);
  if (arrow) {
    result.sourceToken = arrow[1].trim();
    result.destinationToken = arrow[2].trim();
  }

  const tokens = query.split(/\s+/);
  for (const token of tokens) {
    const upper = token.toUpperCase();
    if (['TCP', 'UDP', 'ICMP', 'ANY'].includes(upper)) {
      result.protocol = upper;
      continue;
    }
    if (upper === 'ALLOW' || upper === 'PERMIT') {
      result.action = 'ALLOW';
      continue;
    }
    if (upper === 'DENY' || upper === 'BLOCK') {
      result.action = 'DENY';
      continue;
    }
    if (/^\d{1,5}$/.test(token)) {
      const range = parsePortToken(token);
      if (range && range.from === range.to) result.port = range.from;
    }
  }

  return result;
}

/** Turn a search result into the topology filters that isolate it on the map. */
export function filtersForResult(result: SearchResult, base: TopologyFilters): TopologyFilters {
  switch (result.kind) {
    case 'server':
      return { ...base, focusServerId: result.id, serverIds: [] };
    case 'port': {
      const port = result.id.split(':')[1];
      return { ...base, portQuery: port, focusServerId: null };
    }
    case 'rule':
      return { ...base, ruleNameQuery: result.title, focusServerId: null };
    default:
      return base;
  }
}
