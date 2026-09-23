import type { Dataset, PolicyGraph, PortRange, Rule, TopologyFilters } from '@/types';
import { intersectRanges, parsePortToken } from './ports';
import { effectivePorts } from './duplicates';

export interface FilteredView {
  serverIds: Set<string>;
  rules: Rule[];
  /** True when no filter is active, so the UI can skip "filtered" messaging. */
  unfiltered: boolean;
}

export function hasActiveFilters(filters: TopologyFilters): boolean {
  return (
    filters.serverIds.length > 0 ||
    filters.roles.length > 0 ||
    filters.environments.length > 0 ||
    filters.zones.length > 0 ||
    filters.protocols.length > 0 ||
    filters.actions.length > 0 ||
    filters.ipQuery.trim() !== '' ||
    filters.portQuery.trim() !== '' ||
    filters.ruleNameQuery.trim() !== '' ||
    filters.direction !== 'ANY' ||
    filters.focusServerId !== null ||
    filters.hideIsolated
  );
}

/** Parse a port filter of the form "443" or "8000-8100". */
export function parsePortFilter(query: string): PortRange | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  return parsePortToken(trimmed);
}

/**
 * Apply the filter panel to the dataset.
 *
 * Servers are kept when they match the server-level criteria; rules are kept
 * when they match the rule-level criteria AND both endpoints survived. With a
 * focus server set, only rules touching that server (and, for second-level
 * context, its neighbours) are kept.
 */
export function applyFilters(dataset: Dataset, graph: PolicyGraph, filters: TopologyFilters): FilteredView {
  const unfiltered = !hasActiveFilters(filters);
  if (unfiltered) {
    return {
      serverIds: new Set(dataset.servers.map((server) => server.id)),
      rules: dataset.rules.filter((rule) => !rule.disabled),
      unfiltered: true,
    };
  }

  const ipQuery = filters.ipQuery.trim().toLowerCase();
  const ruleQuery = filters.ruleNameQuery.trim().toLowerCase();
  const portRange = parsePortFilter(filters.portQuery);

  const serverMatches = (serverId: string): boolean => {
    const server = graph.serversById.get(serverId);
    if (!server) return false;
    if (filters.serverIds.length > 0 && !filters.serverIds.includes(serverId)) return false;
    if (filters.roles.length > 0 && !filters.roles.includes(server.role)) return false;
    if (filters.environments.length > 0 && !filters.environments.includes(server.environment)) return false;
    if (filters.zones.length > 0 && !filters.zones.includes(server.zone)) return false;
    if (ipQuery && !server.ip.toLowerCase().includes(ipQuery) && !server.name.toLowerCase().includes(ipQuery)) {
      return false;
    }
    return true;
  };

  const ruleMatches = (rule: Rule): boolean => {
    if (rule.disabled) return false;
    if (filters.protocols.length > 0 && !filters.protocols.includes(rule.protocol)) return false;
    if (filters.actions.length > 0 && !filters.actions.includes(rule.action)) return false;
    if (ruleQuery && !rule.name.toLowerCase().includes(ruleQuery) && !rule.id.toLowerCase().includes(ruleQuery)) {
      return false;
    }
    if (portRange && intersectRanges(effectivePorts(rule), [portRange]).length === 0) return false;
    return true;
  };

  /* Focus mode restricts the graph to a server and its immediate neighbourhood. */
  let focusScope: Set<string> | null = null;
  if (filters.focusServerId) {
    focusScope = new Set([filters.focusServerId]);
    for (const connection of graph.bySource.get(filters.focusServerId) ?? []) {
      focusScope.add(connection.destination);
    }
    for (const connection of graph.byDestination.get(filters.focusServerId) ?? []) {
      focusScope.add(connection.source);
    }
  }

  const rules = dataset.rules.filter((rule) => {
    if (!ruleMatches(rule)) return false;

    if (filters.focusServerId) {
      const touchesFocus = rule.source === filters.focusServerId || rule.destination === filters.focusServerId;
      const withinScope = focusScope!.has(rule.source) && focusScope!.has(rule.destination);
      if (!touchesFocus && !withinScope) return false;
      if (filters.direction === 'OUTBOUND' && rule.source !== filters.focusServerId) return false;
      if (filters.direction === 'INBOUND' && rule.destination !== filters.focusServerId) return false;
    }

    // Server-level criteria act on the endpoints. A rule survives when at least
    // one endpoint matches, so "show everything connecting to db-srv-03" works.
    const sourceOk = serverMatches(rule.source);
    const destinationOk = serverMatches(rule.destination);
    if (!sourceOk && !destinationOk) return false;

    if (filters.direction === 'OUTBOUND' && !filters.focusServerId && !sourceOk) return false;
    if (filters.direction === 'INBOUND' && !filters.focusServerId && !destinationOk) return false;

    return true;
  });

  const serverIds = new Set<string>();
  for (const rule of rules) {
    serverIds.add(rule.source);
    serverIds.add(rule.destination);
  }

  // Servers matching the server-level criteria are kept even with no rules, so
  // "show only PROD servers" still reveals isolated PROD servers.
  if (!filters.hideIsolated) {
    const serverOnlyFilters =
      filters.serverIds.length > 0 ||
      filters.roles.length > 0 ||
      filters.environments.length > 0 ||
      filters.zones.length > 0 ||
      ipQuery !== '';
    if (serverOnlyFilters) {
      for (const server of dataset.servers) {
        if (serverMatches(server.id)) serverIds.add(server.id);
      }
    }
  }

  if (filters.hideIsolated) {
    const connected = new Set<string>();
    for (const rule of rules) {
      connected.add(rule.source);
      connected.add(rule.destination);
    }
    return { serverIds: connected, rules, unfiltered: false };
  }

  return { serverIds, rules, unfiltered: false };
}

/** Preset filter descriptions offered in the UI as one-click examples. */
export interface FilterPreset {
  id: string;
  label: string;
  description: string;
  build: (base: TopologyFilters) => TopologyFilters;
}

export const FILTER_PRESETS: FilterPreset[] = [
  {
    id: 'https',
    label: 'All TCP 443 connections',
    description: 'Every rule that includes HTTPS traffic.',
    build: (base) => ({ ...base, protocols: ['TCP'], portQuery: '443' }),
  },
  {
    id: 'prod-only',
    label: 'PROD servers only',
    description: 'Restrict the map to the production environment.',
    build: (base) => ({ ...base, environments: ['PROD'] }),
  },
  {
    id: 'web-to-db',
    label: 'WEB to DB connections',
    description: 'Web tier servers connecting directly to databases.',
    build: (base) => ({ ...base, roles: ['WEB', 'DB'] }),
  },
  {
    id: 'deny-only',
    label: 'All DENY rules',
    description: 'Only explicitly blocked traffic.',
    build: (base) => ({ ...base, actions: ['DENY'] }),
  },
  {
    id: 'admin-ports',
    label: 'Remote administration (SSH)',
    description: 'Rules that include TCP 22.',
    build: (base) => ({ ...base, protocols: ['TCP'], portQuery: '22' }),
  },
  {
    id: 'sql',
    label: 'SQL Server traffic (1433)',
    description: 'Rules that include the Microsoft SQL Server port.',
    build: (base) => ({ ...base, portQuery: '1433' }),
  },
];
