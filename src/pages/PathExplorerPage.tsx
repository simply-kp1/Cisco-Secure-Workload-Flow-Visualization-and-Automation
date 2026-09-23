import { useMemo, useState } from 'react';
import { ArrowRight, Ban, CircleSlash, Route, Search, ShieldCheck } from 'lucide-react';
import type { NetworkPath } from '@/types';
import { findAllowedPaths } from '@/services/paths';
import { formatPorts } from '@/services/ports';
import { useAppStore } from '@/store/useAppStore';
import { useDataset, useGraph } from '@/store/selectors';
import { Badge, Button, Callout, Card, CardHeader, EmptyState, Select, Toggle } from '@/components/ui';
import { NetworkCanvas } from '@/components/topology/NetworkCanvas';
import { ACTION_STYLES, cx, roleStyle } from '@/lib/design';

/**
 * Path Explorer.
 *
 * Answers "can A reach B, and by what route?" — enumerating every permitted
 * path, with the rules, protocols and ports at each hop. When nothing is
 * permitted it says so plainly rather than returning an empty list.
 */
export function PathExplorerPage() {
  const dataset = useDataset();
  const graph = useGraph();
  const settings = useAppStore((state) => state.settings);

  const [sourceId, setSourceId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [maxHops, setMaxHops] = useState(settings.maxPathHops);
  const [allowedOnly, setAllowedOnly] = useState(true);
  const [selectedPath, setSelectedPath] = useState<NetworkPath | null>(null);
  const [searched, setSearched] = useState(false);

  const paths = useMemo(() => {
    if (!graph || !sourceId || !destinationId || !searched) return null;
    return findAllowedPaths(graph, sourceId, destinationId, {
      maxHops,
      allowedRulesOnly: allowedOnly,
      maxResults: 60,
    });
  }, [graph, sourceId, destinationId, maxHops, allowedOnly, searched]);

  if (!dataset || !graph) return null;

  const sortedServers = [...dataset.servers].sort((a, b) => a.name.localeCompare(b.name));
  const permitted = paths?.filter((path) => path.permitted) ?? [];
  const viaDenied = paths?.filter((path) => !path.permitted) ?? [];

  return (
    <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[380px_1fr]">
      <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <Card>
          <CardHeader
            title="Path Explorer"
            subtitle="Find every permitted route between two servers, hop by hop."
            icon={Route}
          />
          <div className="space-y-4 border-t border-ink-100 px-5 py-4">
            <Select
              label="Source server"
              value={sourceId}
              onChange={(event) => {
                setSourceId(event.target.value);
                setSearched(false);
                setSelectedPath(null);
              }}
            >
              <option value="">Select a source…</option>
              {sortedServers.map((server) => (
                <option key={server.id} value={server.id}>
                  {server.name} ({server.role})
                </option>
              ))}
            </Select>

            <div className="flex justify-center">
              <ArrowRight className="h-4 w-4 text-ink-300" />
            </div>

            <Select
              label="Destination server"
              value={destinationId}
              onChange={(event) => {
                setDestinationId(event.target.value);
                setSearched(false);
                setSelectedPath(null);
              }}
            >
              <option value="">Select a destination…</option>
              {sortedServers.map((server) => (
                <option key={server.id} value={server.id}>
                  {server.name} ({server.role})
                </option>
              ))}
            </Select>

            <Select
              label="Maximum hop count"
              value={String(maxHops)}
              onChange={(event) => {
                setMaxHops(Number(event.target.value));
                setSearched(false);
              }}
              hint="Higher values find longer routes but take longer to search."
            >
              {[1, 2, 3, 4, 5, 6].map((value) => (
                <option key={value} value={value}>
                  {value} hop{value === 1 ? '' : 's'}
                </option>
              ))}
            </Select>

            <div className="rounded-xl border border-ink-200 bg-ink-50/60 px-3.5 py-1">
              <Toggle
                checked={allowedOnly}
                onChange={(value) => {
                  setAllowedOnly(value);
                  setSearched(false);
                }}
                label="Allowed rules only"
                description={
                  allowedOnly
                    ? 'Only ALLOW rules are traversed, so every result is a permitted route.'
                    : 'DENY rules are traversed too, and the resulting routes are marked as not permitted.'
                }
              />
            </div>

            <Button
              variant="primary"
              icon={Search}
              className="w-full"
              disabled={!sourceId || !destinationId || sourceId === destinationId}
              onClick={() => {
                setSearched(true);
                setSelectedPath(null);
              }}
            >
              Find paths
            </Button>

            {sourceId && sourceId === destinationId ? (
              <p className="text-[12px] font-medium text-amber-600">
                Choose two different servers.
              </p>
            ) : null}
          </div>
        </Card>

        {paths ? (
          <Card>
            <CardHeader
              title="Results"
              subtitle={`${permitted.length} permitted route${permitted.length === 1 ? '' : 's'}${
                viaDenied.length > 0 ? `, ${viaDenied.length} via a denied connection` : ''
              }`}
            />
            <div className="max-h-[52vh] space-y-1.5 overflow-y-auto border-t border-ink-100 px-5 py-4">
              {paths.length === 0 ? (
                <Callout tone="warning" title="No permitted path exists." icon={CircleSlash}>
                  No route of up to {maxHops} hop{maxHops === 1 ? '' : 's'} permits traffic from{' '}
                  <strong>{graph.serversById.get(sourceId)?.name}</strong> to{' '}
                  <strong>{graph.serversById.get(destinationId)?.name}</strong>
                  {allowedOnly ? ' using ALLOW rules' : ''}. Try increasing the maximum hop count, or check whether
                  the connectivity is provided outside this policy export.
                </Callout>
              ) : (
                paths.map((path, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => setSelectedPath(path === selectedPath ? null : path)}
                    className={cx(
                      'w-full rounded-lg border px-3 py-2.5 text-left transition-all duration-150',
                      path === selectedPath
                        ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-100'
                        : 'border-ink-200 bg-white hover:border-brand-300 hover:bg-brand-50/40',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {path.permitted ? (
                        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" strokeWidth={2.4} />
                      ) : (
                        <Ban className="h-3.5 w-3.5 shrink-0 text-rose-500" strokeWidth={2.4} />
                      )}
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink-800">
                        {path.nodes.map((id) => graph.serversById.get(id)?.name ?? id).join(' → ')}
                      </span>
                      <Badge>{path.hopCount} hops</Badge>
                    </div>
                  </button>
                ))
              )}
            </div>
          </Card>
        ) : null}
      </div>

      {/* ---------------- detail + map ---------------- */}
      <div className="flex min-h-0 flex-col gap-4">
        {selectedPath ? (
          <Card>
            <CardHeader
              title="Path detail"
              subtitle={`${selectedPath.hopCount} hop${selectedPath.hopCount === 1 ? '' : 's'} · ${
                selectedPath.permitted ? 'every hop is permitted' : 'includes a denied connection'
              }`}
              icon={Route}
            />
            <div className="border-t border-ink-100 px-5 py-4">
              <ol className="space-y-2">
                {selectedPath.hops.map((hop, index) => {
                  const rule = graph.rulesById.get(hop.ruleId);
                  const from = graph.serversById.get(hop.from);
                  const to = graph.serversById.get(hop.to);
                  return (
                    <li key={index} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-700">
                          {index + 1}
                        </span>
                        {index < selectedPath.hops.length - 1 ? (
                          <span className="mt-1 w-px flex-1 bg-ink-200" />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1 pb-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-800">
                            <span className={cx('h-2 w-2 rounded-full', from ? roleStyle(from.role).dot : 'bg-ink-300')} />
                            {from?.name ?? hop.from}
                          </span>
                          <ArrowRight className="h-3 w-3 text-ink-400" />
                          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-800">
                            <span className={cx('h-2 w-2 rounded-full', to ? roleStyle(to.role).dot : 'bg-ink-300')} />
                            {to?.name ?? hop.to}
                          </span>
                          <Badge className={ACTION_STYLES[hop.action].chip}>{hop.action}</Badge>
                        </div>
                        <p className="mono mt-1 text-[11.5px] text-ink-500">
                          {hop.protocol} {formatPorts(hop.ports)} · rule “{rule?.name ?? hop.ruleId}” ({hop.ruleId})
                        </p>
                        {rule?.description ? (
                          <p className="mt-0.5 text-[12px] leading-snug text-ink-500">{rule.description}</p>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </Card>
        ) : null}

        <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-card">
          {selectedPath ? (
            <NetworkCanvas
              graph={graph}
              rules={[...graph.rulesById.values()].filter((rule) => !rule.disabled)}
              serverIds={new Set(graph.nodes.keys())}
              layout="force"
              selectedServerId={null}
              selectedServerIds={[]}
              selectedConnectionId={null}
              focusServerId={null}
              highlightedServerIds={[]}
              highlightedRuleIds={[]}
              activePath={selectedPath}
              labelZoomThreshold={0}
              showEdgeLabels={false}
              performanceThreshold={settings.performanceThreshold}
              animateLayout={false}
              onSelectServer={() => {}}
              onToggleServer={() => {}}
              onSelectConnection={() => {}}
            />
          ) : (
            <EmptyState
              icon={Route}
              className="h-full"
              title={paths ? 'Select a path to trace it on the map' : 'Choose a source and destination'}
              description={
                paths
                  ? 'Each result lists every hop with its rule, protocol and ports. Selecting one highlights it on the topology.'
                  : 'Path Explorer walks the policy graph to find every route that permits traffic between two servers, and tells you plainly when no permitted path exists.'
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
