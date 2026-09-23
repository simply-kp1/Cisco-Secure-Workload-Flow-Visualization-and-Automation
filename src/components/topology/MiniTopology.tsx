import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import { Maximize2 } from 'lucide-react';
import type { PolicyGraph } from '@/types';
import { roleStyle } from '@/lib/design';

cytoscape.use(fcose);

/**
 * A read-only overview of the whole policy for the dashboard.
 *
 * Deliberately minimal: no labels, no interaction handlers, smaller nodes. The
 * point is the shape of the network at a glance, not detail — detail lives on
 * the Network Map.
 */
export function MiniTopology({ graph, onOpen }: { graph: PolicyGraph; onOpen: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const nodes = [...graph.nodes.values()].map((node) => ({
      data: {
        id: node.id,
        role: node.server.role,
        degree: Math.max(node.degree, 1),
      },
    }));

    const edges = graph.connections.map((connection) => ({
      data: {
        id: connection.id,
        source: connection.source,
        target: connection.destination,
        action: connection.action,
      },
    }));

    const roleSelectors = Object.entries(
      Object.fromEntries([...graph.nodes.values()].map((node) => [node.server.role, roleStyle(node.server.role)])),
    ).map(([role, style]) => ({
      selector: `node[role = "${role}"]`,
      style: { 'background-color': style.color, 'border-color': style.border, shape: style.shape },
    })) as cytoscape.StylesheetStyle[];

    const cy = cytoscape({
      container: containerRef.current,
      elements: [...nodes, ...edges],
      userZoomingEnabled: false,
      userPanningEnabled: false,
      boxSelectionEnabled: false,
      autoungrabify: true,
      style: [
        {
          selector: 'node',
          style: {
            width: 'mapData(degree, 1, 20, 14, 34)',
            height: 'mapData(degree, 1, 20, 14, 34)',
            'border-width': 1.5,
            'background-opacity': 0.25,
            label: '',
          },
        },
        ...roleSelectors,
        {
          selector: 'edge',
          style: {
            width: 1,
            'line-color': '#cbd5e1',
            'curve-style': 'haystack',
            opacity: 0.4,
          },
        },
        {
          selector: 'edge[action = "ALLOW"]',
          style: { 'line-color': '#10b981' },
        },
        {
          selector: 'edge[action = "DENY"]',
          style: { 'line-color': '#f43f5e', opacity: 0.6 },
        },
      ],
    });
    cyRef.current = cy;

    cy.layout({
      name: 'fcose',
      quality: graph.nodes.size > 250 ? 'draft' : 'default',
      animate: false,
      fit: true,
      padding: 24,
      randomize: true,
      nodeRepulsion: () => 5000,
      idealEdgeLength: () => 55,
      packComponents: true,
    } as unknown as cytoscape.LayoutOptions).run();

    const observer = new ResizeObserver(() => {
      cy.resize();
      cy.fit(undefined, 24);
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      cy.destroy();
      cyRef.current = null;
    };
  }, [graph]);

  return (
    <div className="group relative h-full w-full">
      <div ref={containerRef} className="cy-container h-full w-full" />
      <button
        type="button"
        onClick={onOpen}
        className="absolute inset-0 flex items-center justify-center bg-white/0 opacity-0 transition-all duration-200 group-hover:bg-white/40 group-hover:opacity-100 group-hover:backdrop-blur-[1px]"
        aria-label="Open the full Network Map"
      >
        <span className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-[13px] font-semibold text-ink-700 shadow-pop">
          <Maximize2 className="h-4 w-4" strokeWidth={2.2} />
          Open the full Network Map
        </span>
      </button>
    </div>
  );
}
