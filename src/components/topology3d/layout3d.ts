import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNode,
} from 'd3-force-3d';
import type { PolicyGraph, Rule, ServerRole, TopologyLayout } from '@/types';
import { layoutDescriptor } from '@/components/topology/layouts';

export type Vec3 = [number, number, number];
export type Positions = Map<string, Vec3>;

/** World-space radius of a node, used for collision and camera framing. */
export const NODE_RADIUS = 1.55;

interface SimNode extends SimulationNode {
  id: string;
}

interface SimLink {
  source: string;
  target: string;
}

/**
 * Tier ordering for the hierarchical layout. Traffic broadly flows downward
 * through these, so stacking them on the Y axis makes the shape of the estate
 * readable at a glance.
 */
const TIER_ORDER: ServerRole[] = ['MANAGEMENT', 'MONITORING', 'WEB', 'API', 'APP', 'FILE', 'DB', 'UNKNOWN'];

export interface Layout3DOptions {
  /** Scales the whole result. Larger graphs are spread further apart. */
  spacing?: number;
  /** Deterministic seed so the same dataset always lays out the same way. */
  seed?: number;
}

/**
 * Compute 3D world positions for every drawn server.
 *
 * Pure: given the same graph, rules, server set and layout it always returns
 * the same positions, which matters when comparing a before and an after.
 */
export function computeLayout3D(
  graph: PolicyGraph,
  rules: Rule[],
  serverIds: Set<string>,
  layout: TopologyLayout,
  options: Layout3DOptions = {},
): Positions {
  const ids = [...serverIds].filter((id) => graph.serversById.has(id)).sort();
  if (ids.length === 0) return new Map();

  const descriptor = layoutDescriptor(layout);
  const spacing = options.spacing ?? spacingFor(ids.length);

  if (descriptor.grouped && descriptor.groupBy) {
    return groupedLayout3D(graph, ids, descriptor.groupBy, spacing);
  }
  if (layout === 'hierarchical') return hierarchicalLayout3D(graph, ids, spacing);
  if (layout === 'circular') return circularLayout3D(graph, ids, spacing);
  return forceLayout3D(graph, rules, ids, spacing, options.seed ?? 1);
}

function spacingFor(count: number): number {
  // Bigger estates need proportionally more room or they read as a solid ball.
  if (count > 600) return 4.2;
  if (count > 250) return 3.6;
  if (count > 100) return 3.2;
  return 3.0;
}

/* ------------------------------------------------------------------ *
 * Force directed
 * ------------------------------------------------------------------ */

/**
 * Three-dimensional force simulation.
 *
 * Runs to completion synchronously rather than animating: an animated
 * simulation over thousands of edges competes with rendering for the frame
 * budget, and a settled graph is what people want to look at.
 */
function forceLayout3D(
  graph: PolicyGraph,
  rules: Rule[],
  ids: string[],
  spacing: number,
  seed: number,
): Positions {
  const present = new Set(ids);
  const nodes: SimNode[] = ids.map((id) => ({ id }));
  const links: SimLink[] = [];

  for (const rule of rules) {
    if (rule.source === rule.destination) continue;
    if (!present.has(rule.source) || !present.has(rule.destination)) continue;
    links.push({ source: rule.source, target: rule.destination });
  }

  // A deterministic PRNG keeps the layout stable between runs.
  let state = seed >>> 0 || 1;
  const random = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 100000) / 100000;
  };

  const simulation = forceSimulation<SimNode, SimLink>(nodes, 3)
    .randomSource(random)
    .numDimensions(3)
    .force(
      'link',
      forceLink<SimNode, SimLink>(links)
        .id((node) => node.id)
        .distance(spacing * 2.2)
        .strength(0.6),
    )
    // Repulsion is bounded: an unbounded charge over a few hundred nodes
    // inflates the graph until the nodes are sub-pixel when framed.
    .force('charge', forceManyBody<SimNode>().strength(-spacing * 12).distanceMax(spacing * 16))
    .force('center', forceCenter<SimNode>(0, 0, 0).strength(1))
    .force('collide', forceCollide<SimNode>(NODE_RADIUS * 2).strength(0.9).iterations(2))
    .stop();

  const iterations = ids.length > 600 ? 140 : ids.length > 250 ? 220 : 320;
  simulation.tick(iterations);

  const positions: Positions = new Map();
  for (const node of nodes) {
    positions.set(node.id, [node.x ?? 0, node.y ?? 0, node.z ?? 0]);
  }
  void graph;
  return positions;
}

/* ------------------------------------------------------------------ *
 * Hierarchical — tiers stacked on the Y axis
 * ------------------------------------------------------------------ */

function hierarchicalLayout3D(graph: PolicyGraph, ids: string[], spacing: number): Positions {
  const tiers = new Map<ServerRole, string[]>();
  for (const id of ids) {
    const role = graph.serversById.get(id)?.role ?? 'UNKNOWN';
    const list = tiers.get(role);
    if (list) list.push(id);
    else tiers.set(role, [id]);
  }

  const present = TIER_ORDER.filter((role) => tiers.has(role));
  const layerGap = spacing * 3.4;
  const positions: Positions = new Map();

  present.forEach((role, tierIndex) => {
    const members = tiers.get(role)!;
    const y = (present.length - 1 - tierIndex) * layerGap - ((present.length - 1) * layerGap) / 2;

    // Arrange each tier on a disc so wide tiers stay compact in plan view.
    const perRing = Math.max(1, Math.round(Math.sqrt(members.length * 1.6)));
    members.forEach((id, index) => {
      const ring = Math.floor(index / perRing);
      const withinRing = index % perRing;
      const ringCount = Math.min(perRing, members.length - ring * perRing);
      const radius = spacing * 3.3 * (ring + 1);
      const angle = (withinRing / ringCount) * Math.PI * 2 + ring * 0.6;
      positions.set(id, [Math.cos(angle) * radius, y, Math.sin(angle) * radius]);
    });
  });

  return positions;
}

/* ------------------------------------------------------------------ *
 * Circular — a sphere shell, densest connections nearest the equator
 * ------------------------------------------------------------------ */

function circularLayout3D(graph: PolicyGraph, ids: string[], spacing: number): Positions {
  // Order by degree so hubs sit together and the shape carries information.
  const ordered = [...ids].sort(
    (a, b) => (graph.nodes.get(b)?.degree ?? 0) - (graph.nodes.get(a)?.degree ?? 0),
  );

  const radius = spacing * Math.max(4, Math.sqrt(ordered.length) * 1.5);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const positions: Positions = new Map();

  ordered.forEach((id, index) => {
    // Fibonacci sphere: even coverage with no clustering at the poles.
    const y = 1 - (index / Math.max(1, ordered.length - 1)) * 2;
    const ringRadius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * index;
    positions.set(id, [
      Math.cos(theta) * ringRadius * radius,
      y * radius,
      Math.sin(theta) * ringRadius * radius,
    ]);
  });

  return positions;
}

/* ------------------------------------------------------------------ *
 * Grouped — one island per role, environment or zone
 * ------------------------------------------------------------------ */

function groupedLayout3D(
  graph: PolicyGraph,
  ids: string[],
  groupBy: 'role' | 'environment' | 'zone',
  spacing: number,
): Positions {
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const server = graph.serversById.get(id);
    if (!server) continue;
    const key =
      groupBy === 'role' ? server.role : groupBy === 'environment' ? server.environment : server.zone || 'Unzoned';
    const list = groups.get(key);
    if (list) list.push(id);
    else groups.set(key, [id]);
  }

  const entries = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const positions: Positions = new Map();

  // Island centres are spread on a ring, sized so the largest island fits.
  const largest = Math.max(...entries.map(([, members]) => members.length));
  const islandRadius = spacing * Math.max(2.4, Math.cbrt(largest) * 2.1);
  const ringRadius = Math.max(
    islandRadius * 2.4,
    (entries.length * islandRadius * 2.3) / (Math.PI * 2),
  );

  entries.forEach(([, members], groupIndex) => {
    const angle = (groupIndex / entries.length) * Math.PI * 2;
    const cx = Math.cos(angle) * ringRadius;
    const cz = Math.sin(angle) * ringRadius;
    // Alternate the height a little so islands do not read as one flat disc.
    const cy = (groupIndex % 2 === 0 ? 1 : -1) * spacing * 1.4;

    const golden = Math.PI * (3 - Math.sqrt(5));
    const localRadius = spacing * Math.max(1.6, Math.cbrt(members.length) * 1.7);

    members.forEach((id, index) => {
      if (members.length === 1) {
        positions.set(id, [cx, cy, cz]);
        return;
      }
      const y = 1 - (index / (members.length - 1)) * 2;
      const shell = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = golden * index;
      positions.set(id, [
        cx + Math.cos(theta) * shell * localRadius,
        cy + y * localRadius * 0.75,
        cz + Math.sin(theta) * shell * localRadius,
      ]);
    });
  });

  return positions;
}

/* ------------------------------------------------------------------ *
 * Framing
 * ------------------------------------------------------------------ */

export interface Bounds {
  center: Vec3;
  /** Radius of the sphere enclosing every node. */
  radius: number;
}

/**
 * Centre and radius used to frame the camera.
 *
 * The radius is a high percentile of the distances from the centre rather than
 * the maximum. A force layout almost always leaves a few weakly-connected
 * stragglers far out, and framing to the furthest one shrinks the part people
 * actually want to look at into the middle of the screen.
 */
export function boundsOf(positions: Positions, percentile = 0.93): Bounds {
  if (positions.size === 0) return { center: [0, 0, 0], radius: 10 };

  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  for (const [x, y, z] of positions.values()) {
    sumX += x;
    sumY += y;
    sumZ += z;
  }
  const count = positions.size;
  const center: Vec3 = [sumX / count, sumY / count, sumZ / count];

  const distances: number[] = [];
  for (const [x, y, z] of positions.values()) {
    distances.push(Math.hypot(x - center[0], y - center[1], z - center[2]));
  }
  distances.sort((a, b) => a - b);

  const index = Math.min(distances.length - 1, Math.floor(distances.length * percentile));
  const percentileRadius = distances[index];
  const furthest = distances[distances.length - 1];

  // Blend the two measures. When a few stragglers sit far outside the body of
  // the graph the percentile wins and the view stays tight; when the extremes
  // are the content — a tall tiered stack, say — the percentile is close to
  // the furthest point and the full extent is used instead, so nothing is
  // clipped off the top and bottom of the frame.
  const radius = Math.max(Math.min(furthest, percentileRadius * 1.45), NODE_RADIUS * 4) + NODE_RADIUS * 1.5;

  return { center, radius };
}
