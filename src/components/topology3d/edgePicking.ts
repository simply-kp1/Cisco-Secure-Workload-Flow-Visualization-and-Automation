import * as THREE from 'three';
import type { Rule } from '@/types';
import type { Positions } from './layout3d';

/**
 * Analytic edge picking.
 *
 * The arcs are merged into one geometry for performance, which means they
 * cannot be raycast as meshes. Instead each connection is tested against the
 * pointer ray directly. Two sub-segments per edge approximate the arc closely
 * enough for selection, and the whole sweep is a few thousand cheap vector
 * operations — fast enough to run on click and on a throttled hover.
 */
export interface PickableEdge {
  ruleId: string;
  a: THREE.Vector3;
  mid: THREE.Vector3;
  b: THREE.Vector3;
}

export function buildPickableEdges(rules: Rule[], positions: Positions): PickableEdge[] {
  const out: PickableEdge[] = [];
  for (const rule of rules) {
    const from = positions.get(rule.source);
    const to = positions.get(rule.destination);
    if (!from || !to || rule.source === rule.destination) continue;

    const a = new THREE.Vector3(from[0], from[1], from[2]);
    const b = new THREE.Vector3(to[0], to[1], to[2]);
    // Matches the arc built in Edges3D closely enough for hit testing.
    const mid = a.clone().add(b).multiplyScalar(0.5);
    out.push({ ruleId: rule.id, a, mid, b });
  }
  return out;
}

/** Shortest distance between an infinite ray and a finite segment. */
function rayToSegmentDistance(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  start: THREE.Vector3,
  end: THREE.Vector3,
): { distance: number; alongRay: number } {
  const segment = end.clone().sub(start);
  const w0 = origin.clone().sub(start);

  const a = direction.dot(direction);
  const b = direction.dot(segment);
  const c = segment.dot(segment);
  const d = direction.dot(w0);
  const e = segment.dot(w0);

  const denominator = a * c - b * b;
  let rayT: number;
  let segT: number;

  if (Math.abs(denominator) < 1e-8) {
    rayT = 0;
    segT = c > 1e-8 ? e / c : 0;
  } else {
    rayT = (b * e - c * d) / denominator;
    segT = (a * e - b * d) / denominator;
  }

  rayT = Math.max(0, rayT);
  segT = Math.min(1, Math.max(0, segT));

  const pointOnRay = origin.clone().addScaledVector(direction, rayT);
  const pointOnSegment = start.clone().addScaledVector(segment, segT);
  return { distance: pointOnRay.distanceTo(pointOnSegment), alongRay: rayT };
}

export interface EdgeHit {
  ruleId: string;
  distance: number;
  alongRay: number;
}

/**
 * Find the connection nearest the pointer ray.
 *
 * `tolerance` is in world units and should scale with camera distance so the
 * hit area stays roughly constant on screen.
 */
export function pickEdge(
  edges: PickableEdge[],
  raycaster: THREE.Raycaster,
  tolerance: number,
): EdgeHit | null {
  const origin = raycaster.ray.origin;
  const direction = raycaster.ray.direction;

  let best: EdgeHit | null = null;

  for (const edge of edges) {
    const first = rayToSegmentDistance(origin, direction, edge.a, edge.mid);
    const second = rayToSegmentDistance(origin, direction, edge.mid, edge.b);
    const nearer = first.distance <= second.distance ? first : second;
    if (nearer.distance > tolerance) continue;

    // Prefer the closest edge to the ray; break ties by whichever is nearer
    // the camera so the front-most connection wins.
    if (
      !best ||
      nearer.distance < best.distance - 1e-4 ||
      (Math.abs(nearer.distance - best.distance) <= 1e-4 && nearer.alongRay < best.alongRay)
    ) {
      best = { ruleId: edge.ruleId, distance: nearer.distance, alongRay: nearer.alongRay };
    }
  }

  return best;
}
