import type cytoscape from 'cytoscape';
import type { TopologyLayout } from '@/types';

export interface LayoutDescriptor {
  value: TopologyLayout;
  label: string;
  description: string;
  /** True when the layout needs compound parent nodes to be present. */
  grouped: boolean;
  /** Which server attribute the grouping is keyed on. */
  groupBy?: 'role' | 'environment' | 'zone';
}

export const LAYOUTS: LayoutDescriptor[] = [
  {
    value: 'force',
    label: 'Force directed',
    description: 'Physics simulation — clusters emerge from how servers actually talk to each other.',
    grouped: false,
  },
  {
    value: 'hierarchical',
    label: 'Hierarchical',
    description: 'Tiered top-to-bottom flow, following the direction of traffic.',
    grouped: false,
  },
  {
    value: 'circular',
    label: 'Circular',
    description: 'Servers on a ring — useful for spotting a densely connected hub.',
    grouped: false,
  },
  {
    value: 'grouped-role',
    label: 'Grouped by role',
    description: 'Boxed by tier: web, application, database and so on.',
    grouped: true,
    groupBy: 'role',
  },
  {
    value: 'grouped-environment',
    label: 'Grouped by environment',
    description: 'Boxed by PROD, UAT and DEV — makes cross-environment traffic obvious.',
    grouped: true,
    groupBy: 'environment',
  },
  {
    value: 'grouped-zone',
    label: 'Grouped by zone',
    description: 'Boxed by data centre or site.',
    grouped: true,
    groupBy: 'zone',
  },
];

export function layoutDescriptor(layout: TopologyLayout): LayoutDescriptor {
  return LAYOUTS.find((item) => item.value === layout) ?? LAYOUTS[0];
}

/**
 * Cytoscape layout options per mode.
 *
 * `nodeCount` scales the simulation down on large graphs: fCoSE quality is
 * reduced and animation disabled past a few hundred nodes so the map stays
 * responsive at the 1,000-server target.
 */
export function layoutOptions(
  layout: TopologyLayout,
  nodeCount: number,
  animate: boolean,
): cytoscape.LayoutOptions {
  const large = nodeCount > 250;
  const veryLarge = nodeCount > 800;
  const shouldAnimate = animate && !large;

  const base = {
    fit: true,
    padding: 60,
    animate: shouldAnimate,
    animationDuration: 420,
    animationEasing: 'ease-out-cubic' as const,
  };

  switch (layout) {
    case 'hierarchical':
      return {
        ...base,
        name: 'breadthfirst',
        directed: true,
        spacingFactor: large ? 1.4 : 2.1,
        grid: false,
        circle: false,
        avoidOverlap: true,
        // Each node carries a three-line label; without this they collide.
        // Skipped on large graphs, where measuring 1,000 labels dominates.
        nodeDimensionsIncludeLabels: !large,
        maximal: false,
      } as cytoscape.LayoutOptions;

    case 'circular':
      return {
        ...base,
        name: 'concentric',
        concentric: (node: cytoscape.NodeSingular) => node.degree(false),
        levelWidth: () => Math.max(2, Math.ceil(nodeCount / 14)),
        // nodeDimensionsIncludeLabels already reserves the label box, so this
        // is extra breathing room only — a large value here spreads the ring so
        // wide that the fitted zoom drops below the label threshold.
        minNodeSpacing: large ? 12 : 24,
        avoidOverlap: true,
        nodeDimensionsIncludeLabels: !large,
        equidistant: false,
      } as cytoscape.LayoutOptions;

    case 'grouped-role':
    case 'grouped-environment':
    case 'grouped-zone':
      // Grouped views are laid out deterministically by `groupedLayout` below.
      // Force simulation is a poor fit here: with this many cross-group edges
      // it drags the compound boxes through one another and the grouping —
      // the entire point of the view — stops being readable.
      return {
        ...base,
        name: 'fcose',
        quality: veryLarge ? 'draft' : large ? 'default' : 'proof',
        randomize: true,
        // Labels are three lines tall and up to 130px wide, so the simulation
        // has to treat each node as its full label box or the text collides.
        nodeDimensionsIncludeLabels: !large,
        nodeSeparation: large ? 110 : 180,
        idealEdgeLength: () => (large ? 110 : 190),
        nodeRepulsion: () => (large ? 9000 : 22000),
        gravity: 0.28,
        gravityRange: 3.8,
        gravityCompound: 1.4,
        gravityRangeCompound: 1.5,
        numIter: veryLarge ? 800 : 2500,
        tile: true,
        tilingPaddingVertical: 34,
        tilingPaddingHorizontal: 34,
        uniformNodeDimensions: false,
        packComponents: true,
      } as unknown as cytoscape.LayoutOptions;

    case 'force':
    default:
      return {
        ...base,
        name: 'fcose',
        quality: veryLarge ? 'draft' : large ? 'default' : 'proof',
        randomize: true,
        // Measuring label boxes means laying out text for every node. Worth it
        // for readability at small scale; far too costly past a few hundred
        // nodes, where the labels are hidden by the zoom threshold anyway.
        nodeDimensionsIncludeLabels: !large,
        // Spacing is free; only the iteration count costs time. Large estates
        // therefore get *more* room, not less: spreading them out drops the
        // fitted zoom below the label threshold, which is what turns a
        // thousand-node hairball into a readable overview.
        idealEdgeLength: () => (large ? 300 : 210),
        nodeRepulsion: () => (large ? 55000 : 26000),
        edgeElasticity: () => 0.4,
        nestingFactor: 0.1,
        gravity: 0.2,
        gravityRange: 3.8,
        numIter: veryLarge ? 350 : large ? 1200 : 2500,
        nodeSeparation: large ? 240 : 175,
        uniformNodeDimensions: veryLarge,
        // Component packing is a second optimisation pass over the whole graph;
        // it is not worth its cost on a very large estate.
        packComponents: !veryLarge,
        initialEnergyOnIncremental: 0.3,
      } as unknown as cytoscape.LayoutOptions;
  }
}

/* ------------------------------------------------------------------ *
 * Grouped layout
 * ------------------------------------------------------------------ */

/** Cell size per server, sized to hold the node plus its three-line label. */
const CELL_WIDTH = 176;
const CELL_HEIGHT = 128;
/**
 * Gap between adjacent group boxes. Generous, because Cytoscape adds its own
 * padding and a heading label to each compound box on top of the cell grid
 * measured here.
 */
const GROUP_GAP = 130;

/**
 * Deterministic layout for the "grouped by" views.
 *
 * Each group becomes a tidy grid of its members, and the groups themselves are
 * packed left to right and wrapped to keep the overall shape close to the
 * viewport's aspect ratio — so the fitted zoom stays high enough for labels to
 * remain visible. Unlike a force simulation the result is stable: the same
 * dataset always produces the same picture, which matters when someone is
 * comparing a before and an after.
 */
export function groupedLayout(
  cy: cytoscape.Core,
  animate: boolean,
  targetAspect = 1.6,
): cytoscape.LayoutOptions {
  const parents = cy.nodes().filter((node) => node.isParent()).toArray() as cytoscape.NodeSingular[];

  const groups = parents
    .map((parent) => ({
      id: parent.id(),
      children: parent
        .children()
        .filter((child) => child.isNode() && !(child as cytoscape.NodeSingular).isParent())
        .toArray() as cytoscape.NodeSingular[],
    }))
    .filter((group) => group.children.length > 0)
    // Largest first so the packing produces even rows.
    .sort((a, b) => b.children.length - a.children.length);

  if (groups.length === 0) {
    return { ...baseGrid(animate), name: 'grid' } as cytoscape.LayoutOptions;
  }

  // Shape each group's internal grid.
  const boxes = groups.map((group) => {
    const count = group.children.length;
    const columns = Math.max(1, Math.min(count, Math.ceil(Math.sqrt(count * targetAspect))));
    const rows = Math.ceil(count / columns);
    return {
      ...group,
      columns,
      rows,
      width: columns * CELL_WIDTH,
      height: rows * CELL_HEIGHT,
    };
  });

  // Pack the group boxes into rows. Rather than guessing a wrap width, try
  // every row count and keep the packing whose overall aspect ratio is closest
  // to the viewport's — a naive estimate tends to land just short of fitting a
  // second box per row and stacks everything into one tall column.
  const widest = Math.max(...boxes.map((box) => box.width));
  const totalWidth = boxes.reduce((sum, box) => sum + box.width + GROUP_GAP, 0);

  let maxRowWidth = widest;
  let bestScore = Infinity;
  for (let perRow = 1; perRow <= boxes.length; perRow += 1) {
    const candidate = Math.max(widest, (totalWidth / boxes.length) * perRow);
    const { width, height } = measurePacking(boxes, candidate);
    if (height === 0) continue;
    const score = Math.abs(width / height - targetAspect);
    if (score < bestScore) {
      bestScore = score;
      maxRowWidth = candidate;
    }
  }

  const positions = new Map<string, { x: number; y: number }>();
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;

  for (const box of boxes) {
    if (cursorX > 0 && cursorX + box.width > maxRowWidth) {
      cursorX = 0;
      cursorY += rowHeight + GROUP_GAP;
      rowHeight = 0;
    }

    box.children.forEach((child: cytoscape.NodeSingular, index: number) => {
      const column = index % box.columns;
      const row = Math.floor(index / box.columns);
      positions.set(child.id(), {
        x: cursorX + column * CELL_WIDTH + CELL_WIDTH / 2,
        y: cursorY + row * CELL_HEIGHT + CELL_HEIGHT / 2,
      });
    });

    cursorX += box.width + GROUP_GAP;
    rowHeight = Math.max(rowHeight, box.height);
  }

  return {
    name: 'preset',
    positions: (node: cytoscape.NodeSingular) => positions.get(node.id()) ?? { x: 0, y: 0 },
    fit: true,
    padding: 70,
    animate,
    animationDuration: 420,
  } as unknown as cytoscape.LayoutOptions;
}

function baseGrid(animate: boolean) {
  return { fit: true, padding: 60, animate, avoidOverlap: true, nodeDimensionsIncludeLabels: true };
}

/** Overall bounding size of a row-packed arrangement at a given wrap width. */
function measurePacking(
  boxes: { width: number; height: number }[],
  maxRowWidth: number,
): { width: number; height: number } {
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  let widest = 0;

  for (const box of boxes) {
    if (cursorX > 0 && cursorX + box.width > maxRowWidth) {
      widest = Math.max(widest, cursorX - GROUP_GAP);
      cursorX = 0;
      cursorY += rowHeight + GROUP_GAP;
      rowHeight = 0;
    }
    cursorX += box.width + GROUP_GAP;
    rowHeight = Math.max(rowHeight, box.height);
  }
  widest = Math.max(widest, cursorX - GROUP_GAP);
  return { width: widest, height: cursorY + rowHeight };
}
