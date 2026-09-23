import { useMemo } from 'react';
import type { Dataset, PolicyGraph, PolicyIssue, ValidationReport } from '@/types';
import { buildGraph } from '@/services/graph';
import { findAllIssues } from '@/services/issues';
import { applyChange } from '@/services/analyseChange';
import {
  calculateStats,
  portUsage,
  summariseAllServers,
  type DashboardStats,
  type PortUsage,
  type ServerSummary,
} from '@/services/statistics';
import { applyFilters, type FilteredView } from '@/services/filter';
import { useAppStore } from './useAppStore';

/**
 * Derived state.
 *
 * `useMemo` alone is not enough here: it caches per component instance, so a
 * table with hundreds of cells that each call `useGraph()` would rebuild the
 * whole policy graph hundreds of times per render. These caches are module
 * level and keyed on object identity, so every consumer of a given dataset
 * shares one computation. The store only replaces `workingDataset` when
 * something actually changed, which makes identity a sound cache key.
 */
function createCache<K extends object, V>(compute: (key: K) => V): (key: K) => V {
  let cachedKey: K | null = null;
  let cachedValue: V;
  return (key: K): V => {
    if (cachedKey !== key) {
      cachedValue = compute(key);
      cachedKey = key;
    }
    return cachedValue;
  };
}

/** As `createCache`, for values derived from two independently changing inputs. */
function createCache2<A extends object, B, V>(compute: (a: A, b: B) => V): (a: A, b: B) => V {
  let keyA: A | null = null;
  let keyB: B | undefined;
  let cachedValue: V;
  return (a: A, b: B): V => {
    if (keyA !== a || keyB !== b) {
      cachedValue = compute(a, b);
      keyA = a;
      keyB = b;
    }
    return cachedValue;
  };
}

const graphFor = createCache<Dataset, PolicyGraph>((dataset) => buildGraph(dataset));
const summariesFor = createCache<Dataset, Map<string, ServerSummary>>((dataset) =>
  summariseAllServers(dataset),
);
const portUsageFor = createCache<Dataset, PortUsage[]>((dataset) => portUsage(dataset, null));

export function useDataset(): Dataset | null {
  return useAppStore((state) => state.workingDataset);
}

export function useGraph(): PolicyGraph | null {
  const dataset = useDataset();
  return useMemo(() => (dataset ? graphFor(dataset) : null), [dataset]);
}

/** The graph that would result if the proposed change were applied. */
export function useProposedGraph(): PolicyGraph | null {
  const dataset = useDataset();
  const change = useAppStore((state) => state.proposedChange);
  return useMemo(() => {
    if (!dataset || !change) return null;
    return buildGraph({ ...dataset, rules: applyChange(dataset.rules, change) });
  }, [dataset, change]);
}

/**
 * Policy issues depend on both the dataset and the import validation, so the
 * cache is keyed on the pair rather than on the dataset alone.
 */
const issuesFor = createCache2<Dataset, ValidationReport | null, PolicyIssue[]>(
  (dataset, validation) => findAllIssues(dataset, graphFor(dataset), validation),
);

export function useIssues(): PolicyIssue[] {
  const dataset = useDataset();
  const validation = useAppStore((state) => state.validation);
  return useMemo(() => (dataset ? issuesFor(dataset, validation) : []), [dataset, validation]);
}

export function useStats(): DashboardStats | null {
  const dataset = useDataset();
  const graph = useGraph();
  const issues = useIssues();
  return useMemo(
    () => (dataset && graph ? calculateStats(dataset, graph, issues) : null),
    [dataset, graph, issues],
  );
}

export function useServerSummaries(): Map<string, ServerSummary> {
  const dataset = useDataset();
  return useMemo(() => (dataset ? summariesFor(dataset) : new Map()), [dataset]);
}

export function usePortUsage(): PortUsage[] {
  const dataset = useDataset();
  return useMemo(() => (dataset ? portUsageFor(dataset) : []), [dataset]);
}

export function useFilteredView(): FilteredView | null {
  const dataset = useDataset();
  const graph = useGraph();
  const filters = useAppStore((state) => state.filters);
  return useMemo(
    () => (dataset && graph ? applyFilters(dataset, graph, filters) : null),
    [dataset, graph, filters],
  );
}

export function useHasData(): boolean {
  return useAppStore((state) => state.workingDataset !== null);
}

/** Zones present in the dataset, for filter dropdowns. */
export function useZones(): string[] {
  const dataset = useDataset();
  return useMemo(() => {
    if (!dataset) return [];
    return [...new Set(dataset.servers.map((server) => server.zone).filter(Boolean))].sort();
  }, [dataset]);
}

export function useProtocols(): string[] {
  const dataset = useDataset();
  return useMemo(() => {
    if (!dataset) return [];
    return [...new Set(dataset.rules.map((rule) => rule.protocol))].sort();
  }, [dataset]);
}
