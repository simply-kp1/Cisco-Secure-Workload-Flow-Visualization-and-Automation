import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { Focus, Layers2, X } from 'lucide-react';
import type { ServerRole, TopologyMode } from '@/types';
import { applyChange } from '@/services/analyseChange';
import { hasActiveFilters } from '@/services/filter';
import { useAppStore } from '@/store/useAppStore';
import { useDataset, useFilteredView, useGraph } from '@/store/selectors';
import { Badge, Button, IconButton } from '@/components/ui';
import { NetworkCanvas, type CanvasControls, type DiffState } from '@/components/topology/NetworkCanvas';
// The 3D renderer pulls in three.js and its ecosystem — by far the heaviest
// dependency here. Loading it on demand keeps the initial bundle small for
// anyone who works in the 2D diagram.
const NetworkCanvas3D = lazy(() =>
  import('@/components/topology3d/NetworkCanvas3D').then((module) => ({
    default: module.NetworkCanvas3D,
  })),
);
import { TopologyToolbar } from '@/components/topology/TopologyToolbar';
import { FilterPanel } from '@/components/topology/FilterPanel';
import { Legend } from '@/components/topology/Legend';
import { ServerDetailsPanel } from '@/components/panels/ServerDetailsPanel';
import { ConnectionDetailsPanel } from '@/components/panels/ConnectionDetailsPanel';
import { cx, roleStyle } from '@/lib/design';
import type { PageId } from '@/components/layout/Sidebar';

export function NetworkMapPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const dataset = useDataset();
  const graph = useGraph();
  const view = useFilteredView();

  const store = useAppStore();
  const {
    filters,
    layout,
    topologyMode,
    selectedServerId,
    selectedServerIds,
    selectedConnectionId,
    focusServerId,
    highlightedServerIds,
    highlightedRuleIds,
    proposedChange,
    proposedAnalysis,
    settings,
  } = store;

  const [controls, setControls] = useState<CanvasControls | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [hiddenRoles, setHiddenRoles] = useState<ServerRole[]>([]);
  const [showEdgeLabels, setShowEdgeLabels] = useState(settings.showEdgeLabels);

  /* ------------------------------------------------------------------ *
   * Which rules and servers to draw, given the mode and the category toggles
   * ------------------------------------------------------------------ */
  const drawn = useMemo(() => {
    if (!dataset || !graph || !view) return null;

    let rules = view.rules;

    // Proposed / difference modes draw the post-change rule set so that added
    // connections are visible. Removed connections are re-injected below.
    if (proposedChange && (topologyMode === 'PROPOSED' || topologyMode === 'DIFFERENCE')) {
      const proposedRules = applyChange(dataset.rules, proposedChange);
      const visibleIds = new Set(view.rules.map((rule) => rule.id));
      rules = proposedRules.filter(
        (rule) =>
          !rule.disabled &&
          (view.unfiltered || visibleIds.has(rule.id) || rule.id === proposedChange.proposedRule?.id),
      );

      if (topologyMode === 'DIFFERENCE' && proposedChange.originalRule) {
        // In difference mode the removed rule must still be drawn, marked as removed.
        const stillPresent = rules.some((rule) => rule.id === proposedChange.originalRule!.id);
        if (!stillPresent) rules = [...rules, proposedChange.originalRule];
      }
    }

    if (hiddenRoles.length > 0) {
      rules = rules.filter((rule) => {
        const source = graph.serversById.get(rule.source);
        const destination = graph.serversById.get(rule.destination);
        return !hiddenRoles.includes(source?.role ?? 'UNKNOWN') && !hiddenRoles.includes(destination?.role ?? 'UNKNOWN');
      });
    }

    if (!settings.showDenyRules) rules = rules.filter((rule) => rule.action !== 'DENY');

    const serverIds = new Set(
      [...view.serverIds].filter((id) => {
        const server = graph.serversById.get(id);
        return server ? !hiddenRoles.includes(server.role) : false;
      }),
    );
    // Any endpoint a drawn rule touches must exist as a node.
    for (const rule of rules) {
      const source = graph.serversById.get(rule.source);
      const destination = graph.serversById.get(rule.destination);
      if (source && !hiddenRoles.includes(source.role)) serverIds.add(rule.source);
      if (destination && !hiddenRoles.includes(destination.role)) serverIds.add(rule.destination);
    }

    return { rules, serverIds };
  }, [dataset, graph, view, proposedChange, topologyMode, hiddenRoles, settings.showDenyRules]);

  /* Difference classification, derived from the committed analysis. */
  const diff = useMemo<DiffState | null>(() => {
    if (topologyMode !== 'DIFFERENCE' || !proposedAnalysis) return null;
    return {
      added: new Set(proposedAnalysis.connectionsAdded.map((delta) => delta.connection.ruleId)),
      removed: new Set(proposedAnalysis.connectionsRemoved.map((delta) => delta.connection.ruleId)),
      modified: new Set(proposedAnalysis.connectionsModified.map((delta) => delta.connection.ruleId)),
    };
  }, [topologyMode, proposedAnalysis]);

  const impact = useMemo(
    () => (proposedAnalysis && topologyMode !== 'CURRENT' ? proposedAnalysis.affectedServers : null),
    [proposedAnalysis, topologyMode],
  );

  const handleReady = useCallback((next: CanvasControls) => setControls(next), []);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.roles.length) count += 1;
    if (filters.environments.length) count += 1;
    if (filters.zones.length) count += 1;
    if (filters.protocols.length) count += 1;
    if (filters.actions.length) count += 1;
    if (filters.ipQuery.trim()) count += 1;
    if (filters.portQuery.trim()) count += 1;
    if (filters.ruleNameQuery.trim()) count += 1;
    if (filters.direction !== 'ANY') count += 1;
    if (filters.focusServerId) count += 1;
    if (filters.hideIsolated) count += 1;
    return count;
  }, [filters]);

  if (!dataset || !graph || !view || !drawn) return null;

  const focusServer = focusServerId ? graph.serversById.get(focusServerId) : null;
  const filtered = hasActiveFilters(filters);

  return (
    <div
      className={cx(
        'flex min-h-0 flex-col overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-card',
        fullscreen ? 'fixed inset-0 z-[60] rounded-none border-0' : 'h-full',
      )}
    >
      <TopologyToolbar
        controls={controls}
        layout={layout}
        onLayoutChange={store.setLayout}
        mode={topologyMode}
        onModeChange={(mode: TopologyMode) => store.setTopologyMode(mode)}
        showDiffModes={Boolean(proposedChange)}
        fullscreen={fullscreen}
        onToggleFullscreen={() => setFullscreen((value) => !value)}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen((value) => !value)}
        activeFilterCount={activeFilterCount}
        showEdgeLabels={showEdgeLabels}
        onToggleEdgeLabels={() => setShowEdgeLabels((value) => !value)}
        nodeCount={drawn.serverIds.size}
        edgeCount={drawn.rules.length}
        view={settings.topologyView}
        onViewChange={(view) => store.updateSettings({ topologyView: view })}
        three={{
          quality: settings.quality3d,
          controlMode: settings.controlMode3d,
          showLabels: settings.showLabels3d,
          showFlow: settings.showFlow3d,
          showFloor: settings.showFloor3d,
          onQualityChange: (quality3d) => store.updateSettings({ quality3d }),
          onControlModeChange: (controlMode3d) => store.updateSettings({ controlMode3d }),
          onToggleLabels: () => store.updateSettings({ showLabels3d: !settings.showLabels3d }),
          onToggleFlow: () => store.updateSettings({ showFlow3d: !settings.showFlow3d }),
          onToggleFloor: () => store.updateSettings({ showFloor3d: !settings.showFloor3d }),
        }}
      />

      {/* Context strip — what is currently narrowing the view. */}
      {(filtered || focusServer || highlightedServerIds.length > 0 || proposedChange) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 bg-ink-50/70 px-3 py-1.5">
          {proposedChange ? (
            <Badge className="bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200" icon={Layers2}>
              Proposed: {proposedChange.label}
            </Badge>
          ) : null}
          {focusServer ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 py-1 pl-2.5 pr-1 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-200">
              <Focus className="h-3 w-3" />
              Focused on {focusServer.name}
              <button
                type="button"
                aria-label="Clear focus"
                onClick={() => store.setFocusServer(null)}
                className="rounded-full p-0.5 transition-colors hover:bg-brand-200"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ) : null}
          {highlightedServerIds.length > 0 || highlightedRuleIds.length > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 py-1 pl-2.5 pr-1 text-xs font-semibold text-violet-700 ring-1 ring-inset ring-violet-200">
              Highlighting {highlightedServerIds.length} servers, {highlightedRuleIds.length} rules
              <button
                type="button"
                aria-label="Clear highlight"
                onClick={store.clearHighlight}
                className="rounded-full p-0.5 transition-colors hover:bg-violet-200"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ) : null}
          {filtered ? (
            <span className="text-[12px] font-medium text-ink-500">
              Showing {drawn.serverIds.size} of {graph.nodes.size} servers and {drawn.rules.length} of{' '}
              {graph.connections.length} connections.
            </span>
          ) : null}
          {selectedServerIds.length > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-200/70 py-1 pl-2.5 pr-1 text-xs font-semibold text-ink-700">
              {selectedServerIds.length} servers multi-selected
              <button
                type="button"
                aria-label="Clear selection"
                onClick={store.clearServerSelection}
                className="rounded-full p-0.5 transition-colors hover:bg-ink-300"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ) : null}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {filtersOpen ? <FilterPanel onClose={() => setFiltersOpen(false)} /> : null}

        <div className="relative min-w-0 flex-1">
          {settings.topologyView === '3D' ? (
            <Suspense fallback={<CanvasLoading />}>
                <NetworkCanvas3D
                graph={graph}
                rules={drawn.rules}
                serverIds={drawn.serverIds}
                layout={layout}
                selectedServerId={selectedServerId}
                selectedServerIds={selectedServerIds}
                selectedConnectionId={selectedConnectionId}
                focusServerId={focusServerId}
                highlightedServerIds={highlightedServerIds}
                highlightedRuleIds={highlightedRuleIds}
                diff={diff}
                impact={impact}
                activePath={null}
                quality={settings.quality3d}
                controlMode={settings.controlMode3d}
                showLabels={settings.showLabels3d}
                showFlow={settings.showFlow3d}
                showFloor={settings.showFloor3d}
                animate={settings.animate3d}
                onSelectServer={store.selectServer}
                onToggleServer={store.toggleServerSelection}
                onSelectConnection={store.selectConnection}
                  onReady={handleReady}
                />
            </Suspense>
          ) : (
            <NetworkCanvas
              graph={graph}
              rules={drawn.rules}
              serverIds={drawn.serverIds}
              layout={layout}
              selectedServerId={selectedServerId}
              selectedServerIds={selectedServerIds}
              selectedConnectionId={selectedConnectionId}
              focusServerId={focusServerId}
              highlightedServerIds={highlightedServerIds}
              highlightedRuleIds={highlightedRuleIds}
              diff={diff}
              impact={impact}
              activePath={null}
              labelZoomThreshold={settings.labelZoomThreshold}
              showEdgeLabels={showEdgeLabels}
              performanceThreshold={settings.performanceThreshold}
              animateLayout={settings.animateLayout}
              onSelectServer={store.selectServer}
              onToggleServer={store.toggleServerSelection}
              onSelectConnection={store.selectConnection}
              onReady={handleReady}
            />
          )}

          <Legend
            mode={topologyMode}
            hiddenRoles={hiddenRoles}
            showImpact={Boolean(impact)}
            is3d={settings.topologyView === '3D'}
            onToggleRole={(role) =>
              setHiddenRoles((current) =>
                current.includes(role) ? current.filter((item) => item !== role) : [...current, role],
              )
            }
          />

          {fullscreen ? (
            <div className="absolute right-3 top-3 z-10">
              <IconButton icon={X} label="Exit fullscreen" onClick={() => setFullscreen(false)} />
            </div>
          ) : null}

          {selectedServerIds.length > 1 ? (
            <div className="absolute bottom-3 right-3 z-10 w-[240px] rounded-xl border border-ink-200 bg-white/95 p-3 shadow-lift backdrop-blur">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-400">
                Multi-selection ({selectedServerIds.length})
              </p>
              <div className="mb-2.5 max-h-28 space-y-0.5 overflow-y-auto">
                {selectedServerIds.map((id) => {
                  const server = graph.serversById.get(id);
                  if (!server) return null;
                  return (
                    <div key={id} className="flex items-center gap-1.5 text-[12px] text-ink-700">
                      <span className={cx('h-2 w-2 rounded-full', roleStyle(server.role).dot)} />
                      <span className="truncate">{server.name}</span>
                    </div>
                  );
                })}
              </div>
              <Button
                size="sm"
                variant="secondary"
                className="w-full"
                onClick={() => {
                  store.setFilters({ serverIds: selectedServerIds });
                  store.clearServerSelection();
                }}
              >
                Filter to these servers
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <ServerDetailsPanel
        serverId={selectedServerId}
        graph={graph}
        onClose={() => store.selectServer(null)}
        onOpenRule={(ruleId) => {
          store.selectServer(null);
          store.selectConnection(ruleId);
        }}
      />

      <ConnectionDetailsPanel
        ruleId={selectedConnectionId}
        graph={graph}
        onClose={() => store.selectConnection(null)}
        onAnalyse={(ruleId) => {
          const rule = graph.rulesById.get(ruleId);
          if (!rule) return;
          store.selectConnection(null);
          store.proposeChange('MODIFY_RULE', rule, { ...rule }, `Modify rule "${rule.name}"`);
          onNavigate('change');
        }}
      />
    </div>
  );
}

/** Shown while the 3D renderer chunk is being fetched. */
function CanvasLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#070910]">
      <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-ink-900/80 px-4 py-3 backdrop-blur">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-brand-400" />
        <span className="text-[13px] font-medium text-white/80">Loading the 3D renderer…</span>
      </div>
    </div>
  );
}
