import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { Rule } from '@/types';
import { ACTION_STYLES, DIFF_COLORS } from '@/lib/design';
import type { Positions } from './layout3d';

export type EdgeDiff = 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED';

export interface EdgeVisualState {
  dim: Map<string, number>;
  selected: string | null;
  hovered: string | null;
  diff: Map<string, EdgeDiff>;
}

export interface Edges3DProps {
  rules: Rule[];
  positions: Positions;
  state: EdgeVisualState;
  /** Animated packets along permitted connections. */
  showFlow: boolean;
  animate: boolean;
}

/** How far an edge bows away from the straight line between its endpoints. */
const CURVE_LIFT = 0.16;
const SEGMENTS = 14;

interface EdgeRecord {
  rule: Rule;
  points: THREE.Vector3[];
  length: number;
}

/**
 * Curved arcs between servers.
 *
 * All edges of a given visual class are merged into a single line geometry, so
 * a six-thousand-rule policy costs a handful of draw calls rather than six
 * thousand. Arcs rather than straight lines because in 3D two straight lines
 * between overlapping endpoints are indistinguishable, whereas arcs separate.
 */
export function Edges3D({ rules, positions, state, showFlow, animate }: Edges3DProps) {
  /* ---------- build the arc for every drawn rule ---------- */
  const edges = useMemo<EdgeRecord[]>(() => {
    const out: EdgeRecord[] = [];
    const from = new THREE.Vector3();
    const to = new THREE.Vector3();

    for (const rule of rules) {
      const a = positions.get(rule.source);
      const b = positions.get(rule.destination);
      if (!a || !b) continue;
      if (rule.source === rule.destination) continue;

      from.set(a[0], a[1], a[2]);
      to.set(b[0], b[1], b[2]);
      const length = from.distanceTo(to);
      if (length < 1e-4) continue;

      // Lift the midpoint perpendicular to the connection so parallel rules
      // between the same pair fan out instead of overlapping exactly.
      const mid = from.clone().add(to).multiplyScalar(0.5);
      const direction = to.clone().sub(from).normalize();
      let normal = new THREE.Vector3(0, 1, 0).cross(direction);
      if (normal.lengthSq() < 1e-6) normal = new THREE.Vector3(1, 0, 0).cross(direction);
      normal.normalize();

      const seed = hashCode(rule.id);
      const spin = ((seed % 1000) / 1000) * Math.PI * 2;
      const axis = direction.clone();
      normal.applyAxisAngle(axis, spin);
      mid.addScaledVector(normal, length * CURVE_LIFT);

      const curve = new THREE.QuadraticBezierCurve3(from.clone(), mid, to.clone());
      out.push({ rule, points: curve.getPoints(SEGMENTS), length });
    }
    return out;
  }, [rules, positions]);

  /* ---------- merged line geometry ---------- */
  const { geometry, ranges } = useMemo(() => {
    const positionArray = new Float32Array(edges.length * SEGMENTS * 2 * 3);
    const colorArray = new Float32Array(edges.length * SEGMENTS * 2 * 3);
    const edgeRanges: { rule: Rule; start: number; count: number }[] = [];

    let cursor = 0;
    for (const edge of edges) {
      const start = cursor;
      for (let i = 0; i < SEGMENTS; i += 1) {
        const p0 = edge.points[i];
        const p1 = edge.points[i + 1];
        positionArray[cursor * 3 + 0] = p0.x;
        positionArray[cursor * 3 + 1] = p0.y;
        positionArray[cursor * 3 + 2] = p0.z;
        cursor += 1;
        positionArray[cursor * 3 + 0] = p1.x;
        positionArray[cursor * 3 + 1] = p1.y;
        positionArray[cursor * 3 + 2] = p1.z;
        cursor += 1;
      }
      edgeRanges.push({ rule: edge.rule, start, count: cursor - start });
    }

    const bufferGeometry = new THREE.BufferGeometry();
    bufferGeometry.setAttribute('position', new THREE.BufferAttribute(positionArray, 3));
    bufferGeometry.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));
    return { geometry: bufferGeometry, ranges: edgeRanges };
  }, [edges]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  /* ---------- colour every vertex from the current visual state ---------- */
  useEffect(() => {
    const attribute = geometry.getAttribute('color') as THREE.BufferAttribute;
    const array = attribute.array as Float32Array;
    const colour = new THREE.Color();
    const faded = new THREE.Color('#0d1016');

    for (const range of ranges) {
      const { rule } = range;
      const diff = state.diff.get(rule.id);
      const isSelected = state.selected === rule.id;
      const isHovered = state.hovered === rule.id;
      const dim = state.dim.get(rule.id) ?? 1;

      if (diff) {
        colour.set(DIFF_COLORS[diff]);
      } else {
        colour.set(rule.action === 'ALLOW' ? ACTION_STYLES.ALLOW.color : ACTION_STYLES.DENY.color);
      }

      let intensity = rule.action === 'DENY' ? 0.85 : 0.6;
      if (diff === 'UNCHANGED') intensity = 0.22;
      if (isSelected) intensity = 2.6;
      else if (isHovered) intensity = 1.8;
      colour.multiplyScalar(intensity);
      if (dim < 1) colour.lerp(faded, 1 - dim);

      for (let i = 0; i < range.count; i += 1) {
        const index = (range.start + i) * 3;
        array[index] = colour.r;
        array[index + 1] = colour.g;
        array[index + 2] = colour.b;
      }
    }
    attribute.needsUpdate = true;
  }, [geometry, ranges, state]);

  return (
    <group>
      <lineSegments geometry={geometry} raycast={() => null} frustumCulled={false}>
        <lineBasicMaterial
          vertexColors
          transparent
          opacity={0.82}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>

      {showFlow ? <FlowParticles edges={edges} state={state} animate={animate} /> : null}
    </group>
  );
}

/* ------------------------------------------------------------------ *
 * Flow particles
 * ------------------------------------------------------------------ */

/**
 * Packets travelling source to destination.
 *
 * This is how direction is conveyed in 3D. Arrowheads work on a flat diagram
 * but become ambiguous once the camera can look along an edge; motion does not.
 */
function FlowParticles({
  edges,
  state,
  animate,
}: {
  edges: EdgeRecord[];
  state: EdgeVisualState;
  animate: boolean;
}) {
  const pointsRef = useRef<THREE.Points>(null);

  // One packet per permitted edge, capped so dense policies stay affordable.
  const flowing = useMemo(() => {
    const permitted = edges.filter((edge) => edge.rule.action === 'ALLOW' && !edge.rule.disabled);
    // Every packet is advanced on the CPU each frame, so the budget shrinks as
    // the policy grows: a token sample still reads as traffic in motion.
    const limit = permitted.length > 4000 ? 450 : permitted.length > 1500 ? 800 : 1400;
    if (permitted.length <= limit) return permitted;
    const step = permitted.length / limit;
    const sampled: EdgeRecord[] = [];
    for (let i = 0; i < limit; i += 1) sampled.push(permitted[Math.floor(i * step)]);
    return sampled;
  }, [edges]);

  const { geometry, offsets, speeds } = useMemo(() => {
    const count = flowing.length;
    const bufferGeometry = new THREE.BufferGeometry();
    bufferGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    bufferGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));

    const offsetArray = new Float32Array(count);
    const speedArray = new Float32Array(count);
    flowing.forEach((edge, index) => {
      offsetArray[index] = (hashCode(edge.rule.id) % 1000) / 1000;
      // Longer connections take proportionally longer to traverse.
      speedArray[index] = 0.26 + (1 / Math.max(edge.length, 4)) * 2.4;
    });

    return { geometry: bufferGeometry, offsets: offsetArray, speeds: speedArray };
  }, [flowing]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const clock = useRef(0);
  const colour = useMemo(() => new THREE.Color(), []);
  const point = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    const points = pointsRef.current;
    if (!points) return;
    if (animate) clock.current += delta;

    const positionAttribute = geometry.getAttribute('position') as THREE.BufferAttribute;
    const colourAttribute = geometry.getAttribute('color') as THREE.BufferAttribute;
    const positionArray = positionAttribute.array as Float32Array;
    const colourArray = colourAttribute.array as Float32Array;

    flowing.forEach((edge, index) => {
      const t = (clock.current * speeds[index] + offsets[index]) % 1;
      // Walk the pre-sampled curve rather than re-evaluating the bezier.
      const scaled = t * SEGMENTS;
      const segment = Math.min(SEGMENTS - 1, Math.floor(scaled));
      const local = scaled - segment;
      point.copy(edge.points[segment]).lerp(edge.points[segment + 1], local);

      positionArray[index * 3 + 0] = point.x;
      positionArray[index * 3 + 1] = point.y;
      positionArray[index * 3 + 2] = point.z;

      const dim = state.dim.get(edge.rule.id) ?? 1;
      const emphasised = state.selected === edge.rule.id || state.hovered === edge.rule.id;
      const diff = state.diff.get(edge.rule.id);
      colour.set(diff ? DIFF_COLORS[diff] : ACTION_STYLES.ALLOW.color);
      colour.multiplyScalar((emphasised ? 3.4 : 1.5) * dim);

      colourArray[index * 3 + 0] = colour.r;
      colourArray[index * 3 + 1] = colour.g;
      colourArray[index * 3 + 2] = colour.b;
    });

    positionAttribute.needsUpdate = true;
    colourAttribute.needsUpdate = true;
  });

  if (flowing.length === 0) return null;

  return (
    <points ref={pointsRef} geometry={geometry} raycast={() => null} frustumCulled={false}>
      <pointsMaterial
        size={0.34}
        vertexColors
        transparent
        opacity={0.95}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </points>
  );
}

/* ------------------------------------------------------------------ */

function hashCode(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export { hashCode };
