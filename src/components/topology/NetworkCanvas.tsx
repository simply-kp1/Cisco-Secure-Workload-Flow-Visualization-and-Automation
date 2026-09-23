import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import type { AffectedServer, NetworkPath, PolicyGraph, Rule, TopologyLayout } from '@/types';
import { formatPorts } from '@/services/ports';
import { roleStyle } from '@/lib/design';
import { buildStylesheet, roleBadge } from './graphStyles';
import { groupedLayout, layoutDescriptor, layoutOptions } from './layouts';

cytoscape.use(fcose);

export interface DiffState {
  added: Set<string>;
  removed: Set<string>;
  modified: Set<string>;
}

export interface NetworkCanvasProps {
  graph: PolicyGraph;
  /** Rules to draw. Filtering happens outside so the canvas stays presentational. */
  rules: Rule[];
  /** Servers to draw. */
  serverIds: Set<string>;
  layout: TopologyLayout;
  selectedServerId: string | null;
  selectedServerIds: string[];
  selectedConnectionId: string | null;
  focusServerId: string | null;
  highlightedServerIds: string[];
  highlightedRuleIds: string[];
  /** Rule ids keyed by difference classification, for DIFFERENCE mode. */
  diff?: DiffState | null;
  /** Blast radius overlay. */
  impact?: AffectedServer[] | null;
  /** Path to trace over the topology. */
  activePath?: NetworkPath | null;
  labelZoomThreshold: number;
  showEdgeLabels: boolean;
  performanceThreshold: number;
  animateLayout: boolean;
  onSelectServer: (serverId: string | null) => void;
  onToggleServer: (serverId: string) => void;
  onSelectConnection: (ruleId: string | null) => void;
  onHoverConnection?: (ruleId: string | null) => void;
  /** Exposes imperative controls (zoom, fit, re-layout) to the toolbar. */
  onReady?: (controls: CanvasControls) => void;
}

export interface CanvasControls {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  resetLayout: () => void;
  center: (serverId: string) => void;
  png: () => string | null;
}

export function NetworkCanvas(props: NetworkCanvasProps) {
  const {
    graph,
    rules,
    serverIds,
    layout,
    selectedServerId,
    selectedServerIds,
    selectedConnectionId,
    focusServerId,
    highlightedServerIds,
    highlightedRuleIds,
    diff,
    impact,
    activePath,
    labelZoomThreshold,
    showEdgeLabels,
    performanceThreshold,
    animateLayout,
    onSelectServer,
    onToggleServer,
    onSelectConnection,
    onHoverConnection,
    onReady,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [elementCount, setElementCount] = useState(0);
  /** True while a layout is computing. fCoSE blocks the main thread. */
  const [layoutRunning, setLayoutRunning] = useState(false);
  const frameRef = useRef<number | null>(null);

  /**
   * Layout bookkeeping. These describe the state of the *current Cytoscape
   * instance*, not of this React component, so they are reset whenever a new
   * instance is created — otherwise a remount that rebuilds the instance (as
   * StrictMode's double-invoke does) would inherit stale values and skip the
   * layout, leaving every node stacked at the origin.
   */
  const previousNodeSignature = useRef<string>('');
  const previousLayout = useRef<TopologyLayout | null>(null);
  /** Set when a layout ran; cleared once the graph has been fitted for real. */
  const needsFitRef = useRef(true);

  /**
   * Fit the graph, but only once the container actually has dimensions.
   * Cytoscape silently no-ops a fit against a zero-sized viewport, which is
   * what leaves the diagram in the top-left corner after a remount.
   */
  const fitIfPending = useCallback(() => {
    const cy = cyRef.current;
    const element = containerRef.current;
    if (!cy || !element || !needsFitRef.current) return;
    if (element.clientWidth === 0 || element.clientHeight === 0) return;
    if (cy.elements().length === 0) return;
    cy.fit(undefined, 60);
    needsFitRef.current = false;
  }, []);

  const descriptor = layoutDescriptor(layout);
  const reduceEffects = serverIds.size > performanceThreshold;

  /* ------------------------------------------------------------------ *
   * Element construction
   *
   * Memoised on the inputs that actually change the graph topology, so
   * panning, selecting and hovering never rebuild the element set.
   * ------------------------------------------------------------------ */
  const elements = useMemo<cytoscape.ElementDefinition[]>(() => {
    const nodes: cytoscape.ElementDefinition[] = [];
    const groups = new Map<string, string>();

    const groupKeyFor = (serverId: string): string | undefined => {
      if (!descriptor.grouped || !descriptor.groupBy) return undefined;
      const server = graph.serversById.get(serverId);
      if (!server) return undefined;
      const raw =
        descriptor.groupBy === 'role'
          ? server.role
          : descriptor.groupBy === 'environment'
            ? server.environment
            : server.zone || 'Unzoned';
      return `group:${raw}`;
    };

    for (const serverId of serverIds) {
      const server = graph.serversById.get(serverId);
      if (!server) continue;

      const style = roleStyle(server.role);
      const parent = groupKeyFor(serverId);
      if (parent && !groups.has(parent)) {
        const label =
          descriptor.groupBy === 'role'
            ? style.label
            : descriptor.groupBy === 'environment'
              ? server.environment
              : server.zone || 'Unzoned';
        groups.set(parent, label);
      }

      nodes.push({
        group: 'nodes',
        data: {
          id: serverId,
          // Name, role, IP and environment, each on its own line.
          label: `${server.name}\n${style.short} · ${server.environment}\n${server.ip || 'no IP'}`,
          name: server.name,
          role: server.role,
          environment: server.environment,
          zone: server.zone,
          ip: server.ip,
          synthetic: server.synthetic ? 1 : 0,
          badge: roleBadge(style.short, style.border),
          ...(parent ? { parent } : {}),
        },
      });
    }

    const groupNodes: cytoscape.ElementDefinition[] = [...groups.entries()].map(([id, label]) => ({
      group: 'nodes',
      data: { id, label, group: 1 },
    }));

    const edges: cytoscape.ElementDefinition[] = [];
    for (const rule of rules) {
      if (!serverIds.has(rule.source) || !serverIds.has(rule.destination)) continue;

      const diffClass = diff
        ? diff.added.has(rule.id)
          ? 'ADDED'
          : diff.removed.has(rule.id)
            ? 'REMOVED'
            : diff.modified.has(rule.id)
              ? 'MODIFIED'
              : 'UNCHANGED'
        : undefined;

      edges.push({
        group: 'edges',
        data: {
          id: rule.id,
          source: rule.source,
          target: rule.destination,
          action: rule.action,
          protocol: rule.protocol,
          label: `${rule.protocol} ${formatPorts(rule.ports)}`,
          weight: rule.action === 'DENY' ? 2 : 2.2,
          loop: rule.source === rule.destination ? 1 : 0,
          ...(diffClass ? { diff: diffClass } : {}),
        },
      });
    }

    return [...groupNodes, ...nodes, ...edges];
  }, [graph, rules, serverIds, descriptor.grouped, descriptor.groupBy, diff]);

  /* ------------------------------------------------------------------ *
   * Instance lifecycle
   * ------------------------------------------------------------------ */
  useEffect(() => {
    if (!containerRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      elements: [],
      style: buildStylesheet({ showEdgeLabels, reduceEffects }),
      minZoom: 0.08,
      maxZoom: 3.2,
      wheelSensitivity: 0.22,
      boxSelectionEnabled: true,
      selectionType: 'additive',
    });
    cyRef.current = cy;
    // A brand new instance holds no elements and no layout, so the bookkeeping
    // starts from scratch with it.
    previousNodeSignature.current = '';
    previousLayout.current = null;
    needsFitRef.current = true;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
    // The instance is created once; style and data updates are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Restyle when the presentation options change. */
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.style(buildStylesheet({ showEdgeLabels, reduceEffects }));
  }, [showEdgeLabels, reduceEffects]);

  /* ------------------------------------------------------------------ *
   * Element diffing
   *
   * Rather than replacing the whole graph on every change (which would reset
   * positions and force a re-layout), added and removed elements are applied
   * incrementally, and a layout runs only when the node set actually changed.
   * ------------------------------------------------------------------ */
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const nextIds = new Set(elements.map((element) => String(element.data.id)));
    const nodeSignature = elements
      .filter((element) => element.group === 'nodes')
      .map((element) => element.data.id)
      .sort()
      .join(',');

    cy.batch(() => {
      // Remove elements that are gone.
      cy.elements().forEach((element) => {
        if (!nextIds.has(element.id())) element.remove();
      });
      // Add or update the rest.
      for (const element of elements) {
        const existing = cy.getElementById(String(element.data.id));
        if (existing.length === 0) {
          cy.add(element);
          continue;
        }
        existing.data(element.data);

        // Re-parenting is not a data change in Cytoscape: writing `parent`
        // through data() is ignored, and the node stays in its old compound
        // box. Switching between grouped and ungrouped layouts therefore has
        // to move the node explicitly.
        if (existing.isNode() && !(existing as cytoscape.NodeSingular).isParent()) {
          const node = existing as cytoscape.NodeSingular;
          const nextParent = (element.data.parent as string | undefined) ?? null;
          const parents = node.parent();
          const currentParent = parents.length > 0 ? parents[0].id() : null;
          if (nextParent !== currentParent) node.move({ parent: nextParent });
        }
      }
    });

    setElementCount(cy.nodes().filter((node) => !node.isParent()).length);

    const structureChanged = nodeSignature !== previousNodeSignature.current;
    const layoutChanged = previousLayout.current !== layout;
    previousNodeSignature.current = nodeSignature;
    previousLayout.current = layout;

    if (structureChanged || layoutChanged) {
      // A layout computed while the container is still zero-sized (the usual
      // case on mount, and whenever the page is re-entered) fits against a
      // 0x0 viewport and leaves the graph stranded off-screen. Mark that a fit
      // is owed; the resize observer performs it once real dimensions exist.
      needsFitRef.current = true;
      setLayoutRunning(true);

      // fCoSE runs synchronously and can hold the main thread for several
      // seconds on a large estate. Yielding two frames first lets the progress
      // indicator actually paint, so the pause is explained rather than
      // looking like the application has hung.
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = null;
          if (!cyRef.current) return;
          const running = cyRef.current.layout(resolveLayout(cyRef.current, layout, animateLayout));
          running.one('layoutstop', () => {
            fitIfPending();
            setLayoutRunning(false);
          });
          running.run();
          // Synchronous layouts have already positioned everything by now;
          // for animated ones the layoutstop handler above does the work.
          fitIfPending();
          setLayoutRunning(false);
        });
      });
    }
  }, [elements, layout, animateLayout, fitIfPending]);

  /* Cancel any pending layout frame when the component goes away. */
  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  /* ------------------------------------------------------------------ *
   * Interaction handlers
   * ------------------------------------------------------------------ */
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const onNodeTap = (event: cytoscape.EventObject): void => {
      const node = event.target as cytoscape.NodeSingular;
      if (node.isParent()) return;
      const additive =
        (event.originalEvent as MouseEvent | undefined)?.shiftKey ||
        (event.originalEvent as MouseEvent | undefined)?.metaKey ||
        (event.originalEvent as MouseEvent | undefined)?.ctrlKey;
      if (additive) onToggleServer(node.id());
      else onSelectServer(node.id());
    };

    const onEdgeTap = (event: cytoscape.EventObject): void => {
      onSelectConnection((event.target as cytoscape.EdgeSingular).id());
    };

    const onBackgroundTap = (event: cytoscape.EventObject): void => {
      if (event.target === cy) {
        onSelectServer(null);
        onSelectConnection(null);
      }
    };

    const onNodeOver = (event: cytoscape.EventObject): void => {
      (event.target as cytoscape.NodeSingular).addClass('hovered');
      if (containerRef.current) containerRef.current.style.cursor = 'pointer';
    };
    const onNodeOut = (event: cytoscape.EventObject): void => {
      (event.target as cytoscape.NodeSingular).removeClass('hovered');
      if (containerRef.current) containerRef.current.style.cursor = 'default';
    };
    const onEdgeOver = (event: cytoscape.EventObject): void => {
      const edge = event.target as cytoscape.EdgeSingular;
      edge.addClass('hovered');
      onHoverConnection?.(edge.id());
      if (containerRef.current) containerRef.current.style.cursor = 'pointer';
    };
    const onEdgeOut = (event: cytoscape.EventObject): void => {
      (event.target as cytoscape.EdgeSingular).removeClass('hovered');
      onHoverConnection?.(null);
      if (containerRef.current) containerRef.current.style.cursor = 'default';
    };

    cy.on('tap', 'node', onNodeTap);
    cy.on('tap', 'edge', onEdgeTap);
    cy.on('tap', onBackgroundTap);
    cy.on('mouseover', 'node', onNodeOver);
    cy.on('mouseout', 'node', onNodeOut);
    cy.on('mouseover', 'edge', onEdgeOver);
    cy.on('mouseout', 'edge', onEdgeOut);

    return () => {
      cy.removeListener('tap', 'node', onNodeTap);
      cy.removeListener('tap', 'edge', onEdgeTap);
      cy.removeListener('tap', onBackgroundTap);
      cy.removeListener('mouseover', 'node', onNodeOver);
      cy.removeListener('mouseout', 'node', onNodeOut);
      cy.removeListener('mouseover', 'edge', onEdgeOver);
      cy.removeListener('mouseout', 'edge', onEdgeOut);
    };
  }, [onSelectServer, onToggleServer, onSelectConnection, onHoverConnection]);

  /* ------------------------------------------------------------------ *
   * Label culling at low zoom
   *
   * A 1,000-node graph zoomed out is unreadable and slow if every label is
   * drawn, so labels are suppressed below the threshold.
   * ------------------------------------------------------------------ */
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    // On a large graph labels are unreadable long before they stop being drawn,
    // and drawing them is what makes panning stutter. Require progressively
    // more zoom as the node count grows.
    const nodeCount = cy.nodes().length;
    const effectiveThreshold = Math.max(
      labelZoomThreshold,
      nodeCount > 500 ? 0.75 : nodeCount > 250 ? 0.55 : 0,
    );

    const apply = (): void => {
      const hide = cy.zoom() < effectiveThreshold;
      cy.batch(() => {
        if (hide) cy.nodes().addClass('no-label');
        else cy.nodes().removeClass('no-label');
      });
    };
    apply();
    cy.on('zoom', apply);
    return () => {
      cy.removeListener('zoom', apply);
    };
  }, [labelZoomThreshold, elements]);

  /* ------------------------------------------------------------------ *
   * Selection, focus and highlight classes
   * ------------------------------------------------------------------ */
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.batch(() => {
      cy.elements().removeClass('selected multi-selected faded highlighted on-path');
      cy.nodes().removeClass('impact-DIRECT impact-ONE_HOP impact-TWO_HOP impact-DOWNSTREAM');

      if (selectedServerId) cy.getElementById(selectedServerId).addClass('selected');
      for (const id of selectedServerIds) cy.getElementById(id).addClass('multi-selected');
      if (selectedConnectionId) cy.getElementById(selectedConnectionId).addClass('selected');

      /* Focus mode: fade everything not connected to the focus server. */
      if (focusServerId) {
        const focus = cy.getElementById(focusServerId);
        if (focus.length > 0) {
          const firstDegree = focus.closedNeighborhood();
          const secondDegree = firstDegree.nodes().closedNeighborhood();
          const keep = secondDegree.union(firstDegree);
          cy.elements().difference(keep).addClass('faded');
          focus.addClass('selected');
        }
      }

      /* Search / issue highlighting. */
      if (highlightedServerIds.length > 0 || highlightedRuleIds.length > 0) {
        const matched = cy.collection();
        for (const id of highlightedServerIds) matched.merge(cy.getElementById(id));
        for (const id of highlightedRuleIds) {
          const edge = cy.getElementById(id);
          matched.merge(edge);
          if (edge.isEdge()) matched.merge((edge as cytoscape.EdgeSingular).connectedNodes());
        }
        if (matched.length > 0) {
          cy.elements().difference(matched).addClass('faded');
          matched.addClass('highlighted');
        }
      }

      /* Blast radius rings. */
      if (impact && impact.length > 0) {
        for (const affected of impact) {
          cy.getElementById(affected.serverId).addClass(`impact-${affected.level}`);
        }
      }

      /* Path trace. */
      if (activePath) {
        for (const nodeId of activePath.nodes) cy.getElementById(nodeId).addClass('on-path');
        for (const hop of activePath.hops) cy.getElementById(hop.ruleId).addClass('on-path');
        const pathElements = cy.collection();
        for (const nodeId of activePath.nodes) pathElements.merge(cy.getElementById(nodeId));
        for (const hop of activePath.hops) pathElements.merge(cy.getElementById(hop.ruleId));
        cy.elements().difference(pathElements).addClass('faded');
      }
    });
  }, [
    selectedServerId,
    selectedServerIds,
    selectedConnectionId,
    focusServerId,
    highlightedServerIds,
    highlightedRuleIds,
    impact,
    activePath,
    elements,
  ]);

  /* ------------------------------------------------------------------ *
   * Imperative controls
   * ------------------------------------------------------------------ */
  const controls = useMemo<CanvasControls>(
    () => ({
      zoomIn: () => {
        const cy = cyRef.current;
        if (!cy) return;
        cy.animate({ zoom: Math.min(cy.zoom() * 1.35, 3.2), center: { eles: cy.elements() } }, { duration: 180 });
      },
      zoomOut: () => {
        const cy = cyRef.current;
        if (!cy) return;
        cy.animate({ zoom: Math.max(cy.zoom() / 1.35, 0.08) }, { duration: 180 });
      },
      fit: () => cyRef.current?.animate({ fit: { eles: cyRef.current.elements(), padding: 60 } }, { duration: 260 }),
      resetLayout: () => {
        const cy = cyRef.current;
        if (!cy) return;
        needsFitRef.current = true;
        const running = cy.layout(resolveLayout(cy, layout, animateLayout));
        running.one('layoutstop', () => fitIfPending());
        running.run();
      },
      center: (serverId: string) => {
        const cy = cyRef.current;
        if (!cy) return;
        const node = cy.getElementById(serverId);
        if (node.length === 0) return;
        cy.animate({ center: { eles: node }, zoom: Math.max(cy.zoom(), 1.1) }, { duration: 300 });
      },
      png: () => cyRef.current?.png({ full: true, scale: 2, bg: '#ffffff' }) ?? null,
    }),
    [layout, animateLayout, fitIfPending],
  );

  useEffect(() => {
    onReady?.(controls);
  }, [controls, onReady]);

  /* Resize with the container without a layout thrash. */
  const handleResize = useCallback(() => {
    cyRef.current?.resize();
    // Performs the fit owed by the most recent layout, once the container has
    // real dimensions. A user's manual pan or zoom is never overridden,
    // because the flag is only set when a layout runs.
    fitIfPending();
  }, [fitIfPending]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(handleResize);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [handleResize]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="cy-container h-full w-full" />
      {elementCount === 0 && !layoutRunning ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="rounded-xl bg-white/90 px-4 py-3 text-sm font-medium text-ink-500 shadow-card">
            No servers match the current filters.
          </p>
        </div>
      ) : null}

      {layoutRunning ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/55 backdrop-blur-[1px]">
          <div className="flex items-center gap-3 rounded-xl border border-ink-200 bg-white px-4 py-3 shadow-lift">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-200 border-t-brand-500" />
            <span className="text-[13px] font-medium text-ink-600">
              Laying out {serverIds.size.toLocaleString()} servers…
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Pick the layout implementation for a mode. Grouped modes use the
 * deterministic grid; everything else uses a Cytoscape layout algorithm.
 */
function resolveLayout(
  cy: cytoscape.Core,
  layout: TopologyLayout,
  animate: boolean,
): cytoscape.LayoutOptions {
  const descriptor = layoutDescriptor(layout);
  const nodeCount = cy.nodes().length;
  const shouldAnimate = animate && nodeCount <= 250;
  if (descriptor.grouped) return groupedLayout(cy, shouldAnimate);
  return layoutOptions(layout, nodeCount, animate);
}
