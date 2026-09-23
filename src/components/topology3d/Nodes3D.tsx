import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { PolicyGraph, ServerRole } from '@/types';
import { IMPACT_STYLES } from '@/lib/design';
import type { Positions } from './layout3d';
import { NODE_RADIUS } from './layout3d';
import { createRoleGeometry, ROLE_GEOMETRY, roleMaterialSpec } from './roleGeometry';

export interface NodeVisualState {
  /** 0 = fully faded out, 1 = fully lit. Used by focus and highlight modes. */
  dim: Map<string, number>;
  selected: Set<string>;
  /** Blast-radius level per server, if an impact overlay is active. */
  impact: Map<string, string>;
  hovered: string | null;
}

export interface Nodes3DProps {
  graph: PolicyGraph;
  serverIds: string[];
  positions: Positions;
  state: NodeVisualState;
  onHover: (serverId: string | null) => void;
  onSelect: (serverId: string, additive: boolean) => void;
  /** True when the pointer moved far enough to be a camera drag, not a click. */
  wasDrag: (event: { nativeEvent: { clientX: number; clientY: number } }) => boolean;
  /** Disables the idle bob and pulse on very large scenes. */
  animate: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Instanced node meshes, one draw call per role.
 *
 * Instancing is what makes a thousand physically-shaded servers viable: the
 * alternative, a mesh per node, costs a thousand draw calls a frame.
 */
export function Nodes3D({
  graph,
  serverIds,
  positions,
  state,
  onHover,
  onSelect,
  wasDrag,
  animate,
}: Nodes3DProps) {
  /* Group the drawn servers by role so each role becomes one instanced mesh. */
  const groups = useMemo(() => {
    const byRole = new Map<ServerRole, string[]>();
    for (const id of serverIds) {
      const role = graph.serversById.get(id)?.role ?? 'UNKNOWN';
      const list = byRole.get(role);
      if (list) list.push(id);
      else byRole.set(role, [id]);
    }
    return [...byRole.entries()];
  }, [graph, serverIds]);

  return (
    <group>
      {groups.map(([role, ids]) => (
        <RoleInstances
          key={role}
          role={role}
          ids={ids}
          positions={positions}
          state={state}
          onHover={onHover}
          onSelect={onSelect}
          wasDrag={wasDrag}
          animate={animate}
        />
      ))}
    </group>
  );
}

function RoleInstances({
  role,
  ids,
  positions,
  state,
  onHover,
  onSelect,
  wasDrag,
  animate,
}: {
  role: ServerRole;
  ids: string[];
  positions: Positions;
  state: NodeVisualState;
  onHover: (serverId: string | null) => void;
  onSelect: (serverId: string, additive: boolean) => void;
  wasDrag: (event: { nativeEvent: { clientX: number; clientY: number } }) => boolean;
  animate: boolean;
}) {
  const bodyRef = useRef<THREE.InstancedMesh>(null);
  const glowRef = useRef<THREE.InstancedMesh>(null);

  const geometry = useMemo(() => createRoleGeometry(ROLE_GEOMETRY[role]), [role]);
  const glowGeometry = useMemo(() => new THREE.SphereGeometry(NODE_RADIUS * 1.32, 16, 12), []);
  const spec = useMemo(() => roleMaterialSpec(role), [role]);

  useEffect(
    () => () => {
      geometry.dispose();
      glowGeometry.dispose();
    },
    [geometry, glowGeometry],
  );

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);

  /* Per-instance transforms and colours. Rebuilt when the inputs change. */
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const glow = glowRef.current;
    if (!body || !glow) return;

    ids.forEach((id, index) => {
      const position = positions.get(id) ?? [0, 0, 0];
      const selected = state.selected.has(id);
      const hovered = state.hovered === id;
      const scale = selected ? 1.34 : hovered ? 1.18 : 1;

      dummy.position.set(position[0], position[1], position[2]);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      body.setMatrixAt(index, dummy.matrix);

      const dim = state.dim.get(id) ?? 1;
      color.copy(spec.body);
      if (dim < 1) color.lerp(new THREE.Color('#1b212c'), 1 - dim);
      if (selected || hovered) color.lerp(spec.accent, selected ? 0.5 : 0.28);
      body.setColorAt(index, color);

      // The glow shell is a slightly larger additive sphere. It is what makes
      // the bloom pass read as light coming off the hardware.
      const impactLevel = state.impact.get(id);
      const glowStrength = impactLevel
        ? 1
        : selected
          ? 0.9
          : hovered
            ? 0.6
            : dim < 1
              ? 0.03
              : 0.18;

      dummy.scale.setScalar(scale * (impactLevel ? 1.15 : 1) * (glowStrength > 0.5 ? 1.08 : 1));
      dummy.updateMatrix();
      glow.setMatrixAt(index, dummy.matrix);

      const glowColor = impactLevel
        ? new THREE.Color(IMPACT_STYLES[impactLevel as keyof typeof IMPACT_STYLES]?.color ?? spec.accent)
        : spec.accent.clone();
      glow.setColorAt(index, glowColor.multiplyScalar(glowStrength));
    });

    body.count = ids.length;
    glow.count = ids.length;
    body.instanceMatrix.needsUpdate = true;
    glow.instanceMatrix.needsUpdate = true;
    if (body.instanceColor) body.instanceColor.needsUpdate = true;
    if (glow.instanceColor) glow.instanceColor.needsUpdate = true;
    body.computeBoundingSphere();
  }, [ids, positions, state, spec, dummy, color]);

  /* A slow, barely-there drift keeps the scene feeling alive without being
   * distracting. Disabled on large scenes where it costs a matrix rebuild. */
  const time = useRef(0);
  useFrame((_, delta) => {
    if (!animate) return;
    const body = bodyRef.current;
    if (!body) return;
    time.current += delta;

    ids.forEach((id, index) => {
      const position = positions.get(id) ?? [0, 0, 0];
      const selected = state.selected.has(id);
      const hovered = state.hovered === id;
      const scale = selected ? 1.34 : hovered ? 1.18 : 1;
      const phase = index * 0.7;
      const bob = Math.sin(time.current * 0.6 + phase) * 0.09;

      dummy.position.set(position[0], position[1] + bob, position[2]);
      dummy.rotation.set(0, Math.sin(time.current * 0.18 + phase) * 0.12, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      body.setMatrixAt(index, dummy.matrix);
    });
    body.instanceMatrix.needsUpdate = true;
  });

  const handlePointerMove = (event: { stopPropagation: () => void; instanceId?: number }): void => {
    event.stopPropagation();
    if (event.instanceId === undefined) return;
    const id = ids[event.instanceId];
    if (id) onHover(id);
  };

  const handleClick = (event: {
    stopPropagation: () => void;
    instanceId?: number;
    shiftKey?: boolean;
    metaKey?: boolean;
    ctrlKey?: boolean;
    nativeEvent: { clientX: number; clientY: number };
  }): void => {
    event.stopPropagation();
    // Rotating the camera must not select whatever it started over.
    if (wasDrag(event)) return;
    if (event.instanceId === undefined) return;
    const id = ids[event.instanceId];
    if (id) onSelect(id, Boolean(event.shiftKey || event.metaKey || event.ctrlKey));
  };

  return (
    <group>
      <instancedMesh
        ref={bodyRef}
        args={[geometry, undefined, Math.max(ids.length, 1)]}
        castShadow
        receiveShadow
        onPointerMove={handlePointerMove}
        onPointerOut={(event) => {
          event.stopPropagation();
          onHover(null);
        }}
        onClick={handleClick}
      >
        {/* `emissive` gives each body a touch of self-illumination in the role
            hue, so a node stays legible even facing away from every light. */}
        <meshPhysicalMaterial
          metalness={spec.metalness}
          roughness={spec.roughness}
          clearcoat={0.7}
          clearcoatRoughness={0.18}
          envMapIntensity={2.4}
          reflectivity={0.7}
          emissive={spec.accent}
          emissiveIntensity={0.34}
        />
      </instancedMesh>

      {/* Additive shell that produces the emissive halo for the bloom pass. */}
      <instancedMesh ref={glowRef} args={[glowGeometry, undefined, Math.max(ids.length, 1)]} raycast={() => null}>
        <meshBasicMaterial
          transparent
          opacity={0.17}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.BackSide}
          toneMapped={false}
        />
      </instancedMesh>
    </group>
  );
}

export { UP };
