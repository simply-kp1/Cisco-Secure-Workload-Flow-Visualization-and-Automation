import * as THREE from 'three';
import type { ServerRole } from '@/types';
import { ROLE_STYLES } from '@/lib/design';

/**
 * Three-dimensional counterpart to the 2D node shapes.
 *
 * Role is still carried by geometry as well as colour, so the map stays
 * readable without relying on hue — the silhouettes are chosen to be
 * distinguishable from any viewing angle, which matters once the camera can
 * orbit freely.
 */
export type RoleGeometryKind =
  | 'rack'
  | 'sphere'
  | 'drum'
  | 'prism'
  | 'crate'
  | 'gem'
  | 'shield'
  | 'shard';

export const ROLE_GEOMETRY: Record<ServerRole, RoleGeometryKind> = {
  WEB: 'rack',
  APP: 'sphere',
  DB: 'drum',
  API: 'prism',
  FILE: 'crate',
  MONITORING: 'gem',
  MANAGEMENT: 'shield',
  UNKNOWN: 'shard',
};

const R = 1.15;

/**
 * Build the geometry for a role. Kept small in polygon count because every one
 * of these is instanced across potentially a thousand nodes.
 */
export function createRoleGeometry(kind: RoleGeometryKind): THREE.BufferGeometry {
  switch (kind) {
    case 'rack': {
      // A flattened, chamfered slab — reads as rack-mounted hardware.
      const geometry = new THREE.BoxGeometry(R * 2.1, R * 1.0, R * 1.5, 1, 1, 1);
      return geometry;
    }
    case 'sphere':
      return new THREE.SphereGeometry(R, 32, 24);
    case 'drum':
      // Database: the classic cylinder, kept chunky so it reads at distance.
      return new THREE.CylinderGeometry(R * 0.92, R * 0.92, R * 1.5, 28, 1);
    case 'prism':
      return new THREE.CylinderGeometry(R * 0.98, R * 0.98, R * 1.25, 6, 1);
    case 'crate':
      return new THREE.BoxGeometry(R * 1.45, R * 1.45, R * 1.45);
    case 'gem':
      return new THREE.OctahedronGeometry(R * 1.2, 0);
    case 'shield':
      return new THREE.DodecahedronGeometry(R * 1.02, 0);
    case 'shard':
    default:
      return new THREE.TetrahedronGeometry(R * 1.3, 0);
  }
}

/** Vertical offset so every silhouette sits centred on its layout position. */
export function geometryOffset(kind: RoleGeometryKind): number {
  void kind;
  return 0;
}

export interface RoleMaterialSpec {
  /** Body colour — a dark metal tinted towards the role hue. */
  body: THREE.Color;
  /** Emissive accent colour, the role hue at full saturation. */
  accent: THREE.Color;
  metalness: number;
  roughness: number;
}

/**
 * Physically-based material parameters per role.
 *
 * Bodies are dark, near-metal so the environment does the work and the scene
 * reads as real hardware rather than flat coloured blobs; the role hue is
 * carried by an emissive accent that bloom picks up.
 */
export function roleMaterialSpec(role: ServerRole): RoleMaterialSpec {
  const style = ROLE_STYLES[role] ?? ROLE_STYLES.UNKNOWN;
  const accent = new THREE.Color(style.color);

  // Mix the hue into a brushed-steel base rather than using it neat: pure
  // saturated bodies look like plastic toys under a physical light rig.
  //
  // Metalness is deliberately kept near the middle. A true metal reflects only
  // its environment, which renders as near-black against a dark background —
  // the classic mistake that makes a PBR scene look broken rather than moody.
  const body = new THREE.Color('#5a6676').lerp(accent, 0.46);

  return {
    body,
    accent,
    metalness: role === 'UNKNOWN' ? 0.2 : 0.58,
    roughness: role === 'UNKNOWN' ? 0.7 : 0.33,
  };
}

export const ROLE_KEYS = Object.keys(ROLE_GEOMETRY) as ServerRole[];

/** Plain-English name for each 3D silhouette, shown in the legend. */
export const ROLE_SHAPE_LABEL: Record<RoleGeometryKind, string> = {
  rack: 'flat slab',
  sphere: 'sphere',
  drum: 'cylinder',
  prism: 'hexagonal prism',
  crate: 'cube',
  gem: 'octahedron',
  shield: 'dodecahedron',
  shard: 'tetrahedron',
};
