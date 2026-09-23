import type cytoscape from 'cytoscape';
import { DIFF_COLORS, ROLE_STYLES } from '@/lib/design';

/**
 * Cytoscape stylesheet.
 *
 * Role is encoded three ways so the map never depends on colour alone:
 *   - shape   (round-rectangle / ellipse / barrel / hexagon / …)
 *   - colour
 *   - a text label containing the role code
 *
 * Action is encoded by line style (solid ALLOW, dashed DENY) as well as colour.
 */
export function buildStylesheet(options: {
  showEdgeLabels: boolean;
  reduceEffects: boolean;
}): cytoscape.StylesheetStyle[] {
  const { showEdgeLabels, reduceEffects } = options;

  const roleSelectors = Object.entries(ROLE_STYLES).map(([role, style]) => ({
    selector: `node[role = "${role}"]`,
    style: {
      'background-color': style.color,
      'border-color': style.border,
      shape: style.shape,
    },
  })) as cytoscape.StylesheetStyle[];

  return [
    {
      selector: 'node',
      style: {
        width: 54,
        height: 54,
        'border-width': 2.5,
        'background-opacity': 0.16,
        label: 'data(label)',
        'font-size': 11,
        'font-weight': 600,
        'font-family': 'Inter, system-ui, sans-serif',
        color: '#252b38',
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 7,
        'text-wrap': 'wrap',
        'text-max-width': '130px',
        'text-background-color': '#ffffff',
        'text-background-opacity': 0.82,
        'text-background-padding': '3px',
        'text-background-shape': 'roundrectangle',
        'transition-property': reduceEffects ? 'none' : 'background-opacity, border-width, opacity',
        'transition-duration': reduceEffects ? 0 : 160,
      },
    },
    ...roleSelectors,

    /* The role code drawn inside the node — the non-colour role channel. */
    {
      selector: 'node',
      style: {
        'background-image': 'data(badge)',
        'background-fit': 'none',
        'background-image-opacity': 1,
        'background-width': '30px',
        'background-height': '30px',
        'background-position-x': '50%',
        'background-position-y': '50%',
      },
    },

    /* Unresolved endpoints are visually provisional. */
    {
      selector: 'node[?synthetic]',
      style: {
        'border-style': 'dashed',
        'border-color': '#94a3b8',
        'background-opacity': 0.08,
      },
    },

    /* Compound parent nodes used by the grouped layouts. */
    {
      selector: 'node[?group]',
      style: {
        'background-color': '#f7f8fa',
        'background-opacity': 1,
        'background-image': 'none',
        'border-width': 1.5,
        'border-color': '#dfe3ea',
        'border-style': 'solid',
        shape: 'round-rectangle',
        label: 'data(label)',
        'text-valign': 'top',
        'text-halign': 'center',
        'text-margin-y': -6,
        'font-size': 11,
        'font-weight': 700,
        color: '#6b7488',
        'text-background-opacity': 0,
        padding: '26px',
      },
    },

    /* ---------------- edges ---------------- */
    {
      selector: 'edge',
      style: {
        width: 'data(weight)',
        'line-color': '#cbd5e1',
        'target-arrow-color': '#cbd5e1',
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.85,
        'curve-style': 'bezier',
        'control-point-step-size': 34,
        opacity: 0.55,
        'transition-property': reduceEffects ? 'none' : 'line-color, opacity, width',
        'transition-duration': reduceEffects ? 0 : 160,
        ...(showEdgeLabels
          ? {
              label: 'data(label)',
              'font-size': 9,
              'font-family': 'JetBrains Mono, monospace',
              color: '#6b7488',
              'text-background-color': '#ffffff',
              'text-background-opacity': 0.9,
              'text-background-padding': '2px',
              'text-rotation': 'autorotate',
            }
          : {}),
      },
    },
    {
      selector: 'edge[action = "ALLOW"]',
      style: {
        'line-color': '#10b981',
        'target-arrow-color': '#10b981',
        'line-style': 'solid',
      },
    },
    {
      selector: 'edge[action = "DENY"]',
      style: {
        'line-color': '#f43f5e',
        'target-arrow-color': '#f43f5e',
        'line-style': 'dashed',
        'line-dash-pattern': [6, 4],
        opacity: 0.75,
      },
    },
    /* Self-loops from rules whose source and destination are the same server. */
    {
      selector: 'edge[?loop]',
      style: { 'curve-style': 'bezier', 'loop-direction': '-45deg', 'loop-sweep': '45deg' },
    },

    /* ---------------- difference mode ---------------- */
    {
      selector: 'edge[diff = "ADDED"]',
      style: {
        'line-color': DIFF_COLORS.ADDED,
        'target-arrow-color': DIFF_COLORS.ADDED,
        width: 4,
        opacity: 1,
        'line-style': 'solid',
      },
    },
    {
      selector: 'edge[diff = "REMOVED"]',
      style: {
        'line-color': DIFF_COLORS.REMOVED,
        'target-arrow-color': DIFF_COLORS.REMOVED,
        width: 4,
        opacity: 1,
        'line-style': 'dotted',
      },
    },
    {
      selector: 'edge[diff = "MODIFIED"]',
      style: {
        'line-color': DIFF_COLORS.MODIFIED,
        'target-arrow-color': DIFF_COLORS.MODIFIED,
        width: 4,
        opacity: 1,
      },
    },
    {
      selector: 'edge[diff = "UNCHANGED"]',
      style: {
        'line-color': DIFF_COLORS.UNCHANGED,
        'target-arrow-color': DIFF_COLORS.UNCHANGED,
        opacity: 0.3,
        width: 1.5,
      },
    },

    /* ---------------- interaction states ---------------- */
    {
      selector: 'node.hovered',
      style: { 'border-width': 4, 'background-opacity': 0.3 },
    },
    {
      selector: 'node.selected',
      style: {
        'border-width': 5,
        'border-color': '#2044e0',
        'background-opacity': 0.34,
        'font-weight': 800,
      },
    },
    {
      selector: 'node.multi-selected',
      style: { 'border-width': 4, 'border-color': '#3563f4', 'background-opacity': 0.3 },
    },
    {
      selector: 'edge.selected',
      style: { width: 5, opacity: 1, 'z-index': 99 },
    },
    {
      selector: 'edge.hovered',
      style: { width: 4, opacity: 1, 'z-index': 98 },
    },

    /* Focus mode / search highlighting: everything unrelated is faded, never hidden. */
    {
      selector: '.faded',
      style: { opacity: 0.08, 'text-opacity': 0, 'z-index': 0 },
    },
    {
      selector: 'node.highlighted',
      style: {
        'border-width': 5,
        'border-color': '#2044e0',
        'background-opacity': 0.34,
        'z-index': 50,
      },
    },
    {
      selector: 'edge.highlighted',
      style: { width: 4.5, opacity: 1, 'z-index': 50 },
    },

    /* Blast radius rings. */
    {
      selector: 'node.impact-DIRECT',
      style: { 'border-width': 6, 'border-color': '#e11d48', 'background-opacity': 0.34 },
    },
    {
      selector: 'node.impact-ONE_HOP',
      style: { 'border-width': 5, 'border-color': '#f97316', 'background-opacity': 0.26 },
    },
    {
      selector: 'node.impact-TWO_HOP',
      style: { 'border-width': 4, 'border-color': '#f59e0b', 'background-opacity': 0.22 },
    },
    {
      selector: 'node.impact-DOWNSTREAM',
      style: { 'border-width': 3, 'border-color': '#0ea5e9', 'background-opacity': 0.18 },
    },

    /* Path explorer highlighting. */
    {
      selector: 'edge.on-path',
      style: {
        'line-color': '#2044e0',
        'target-arrow-color': '#2044e0',
        width: 5,
        opacity: 1,
        'z-index': 60,
      },
    },
    {
      selector: 'node.on-path',
      style: { 'border-width': 5, 'border-color': '#2044e0', 'background-opacity': 0.32, 'z-index': 60 },
    },

    /* Hidden by a category toggle. */
    { selector: '.hidden', style: { display: 'none' } },

    /* Label suppression at low zoom keeps large graphs legible and fast. */
    { selector: '.no-label', style: { 'text-opacity': 0 } },
  ];
}

/**
 * A small SVG data URI drawn inside each node showing the role code.
 * Cytoscape cannot render a React icon, so the role identifier is baked into an
 * inline SVG — this is the label channel that works even for colour-blind users
 * and at print resolution.
 */
export function roleBadge(roleShort: string, color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60">
    <text x="30" y="30" text-anchor="middle" dominant-baseline="central"
      font-family="Inter, system-ui, sans-serif" font-size="${roleShort.length > 3 ? 13 : 15}"
      font-weight="800" fill="${color}" letter-spacing="0.3">${roleShort}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
