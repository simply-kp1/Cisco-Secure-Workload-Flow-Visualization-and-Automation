import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Billboard, OrbitControls, Text, TrackballControls } from '@react-three/drei';
import type { AffectedServer, NetworkPath, PolicyGraph, Rule, TopologyLayout } from '@/types';
import type { CanvasControls } from '@/components/topology/NetworkCanvas';
import { boundsOf, computeLayout3D, NODE_RADIUS, type Positions } from './layout3d';
import { Nodes3D, type NodeVisualState } from './Nodes3D';
import { Edges3D, type EdgeDiff, type EdgeVisualState } from './Edges3D';
import { buildPickableEdges, pickEdge } from './edgePicking';
import { configureRenderer, PostProcessing, ReflectiveFloor, SceneLighting, type QualityLevel } from './SceneRig';
import { lowerQuality, PerformanceGuard, QUALITY_ORDER } from './PerformanceGuard';

export type ControlMode = 'orbit' | 'free';

export interface NetworkCanvas3DProps {
  graph: PolicyGraph;
  rules: Rule[];
  serverIds: Set<string>;
  layout: TopologyLayout;
  selectedServerId: string | null;
  selectedServerIds: string[];
  selectedConnectionId: string | null;
  focusServerId: string | null;
  highlightedServerIds: string[];
  highlightedRuleIds: string[];
  diff?: { added: Set<string>; removed: Set<string>; modified: Set<string> } | null;
  impact?: AffectedServer[] | null;
  activePath?: NetworkPath | null;
  quality: QualityLevel;
  controlMode: ControlMode;
  showLabels: boolean;
  showFlow: boolean;
  showFloor: boolean;
  animate: boolean;
  onSelectServer: (serverId: string | null) => void;
  onToggleServer: (serverId: string) => void;
  onSelectConnection: (ruleId: string | null) => void;
  onReady?: (controls: CanvasControls) => void;
}

/** Imperative camera actions shared with the scene through a ref. */
interface CameraApi {
  zoomBy: (factor: number) => void;
  fit: () => void;
  focusOn: (serverId: string) => void;
  resetView: () => void;
  screenshot: () => string | null;
}

export function NetworkCanvas3D(props: NetworkCanvas3DProps) {
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
    quality,
    controlMode,
    showLabels,
    showFlow,
    showFloor,
    animate,
    onSelectServer,
    onToggleServer,
    onSelectConnection,
    onReady,
  } = props;

  const [hoveredServer, setHoveredServer] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const cameraApi = useRef<CameraApi | null>(null);

  /**
   * Where the pointer went down, so a camera drag is not mistaken for a click.
   *
   * React Three Fiber treats any pointerdown/pointerup pair on the same object
   * as a click, and orbiting the camera is exactly that — without this, every
   * rotation selects whatever happened to be under the cursor.
   */
  const pointerDownAt = useRef<{ x: number; y: number } | null>(null);
  const DRAG_THRESHOLD_PX = 5;

  const wasDrag = useCallback((event: { nativeEvent: { clientX: number; clientY: number } }): boolean => {
    const start = pointerDownAt.current;
    if (!start) return false;
    const { clientX, clientY } = event.nativeEvent;
    return Math.hypot(clientX - start.x, clientY - start.y) > DRAG_THRESHOLD_PX;
  }, []);

  const drawnIds = useMemo(() => [...serverIds], [serverIds]);

  /* ------------------------------------------------------------------ *
   * Adaptive quality
   *
   * The chosen quality is treated as a ceiling, not a demand. Past a few
   * hundred nodes the per-frame CPU work — rebuilding a matrix per node for
   * the idle drift, stepping a particle along every permitted edge — costs
   * more than any GPU setting, so it is shed first, then the screen-space
   * effects.
   * ------------------------------------------------------------------ */
  const nodeCount = drawnIds.length;
  const heavy = nodeCount > 400;
  const veryHeavy = nodeCount > 800;

  // Ceiling imposed by the frame-rate watchdog after it has seen the scene
  // struggle on this machine. Reset whenever the user picks a quality again.
  const [autoCeiling, setAutoCeiling] = useState<QualityLevel | null>(null);
  const [lastRequested, setLastRequested] = useState<QualityLevel>(quality);
  if (quality !== lastRequested) {
    setLastRequested(quality);
    setAutoCeiling(null);
  }

  const sizeCeiling: QualityLevel = veryHeavy ? 'low' : heavy ? 'balanced' : 'ultra';
  const effectiveQuality: QualityLevel = [quality, sizeCeiling, autoCeiling ?? 'ultra'].reduce(
    (lowest, candidate) =>
      QUALITY_ORDER.indexOf(candidate) < QUALITY_ORDER.indexOf(lowest) ? candidate : lowest,
    'ultra' as QualityLevel,
  );
  // The idle drift rewrites every instance matrix each frame; it is a nicety,
  // and the first thing to go.
  const effectiveAnimate = animate && !heavy;
  const effectiveFloor = showFloor && !veryHeavy;

  /* ------------------------------------------------------------------ *
   * Layout
   *
   * The force simulation is synchronous and can take a moment on a large
   * estate, so it runs off the render path with an indicator shown first.
   * ------------------------------------------------------------------ */
  // A fresh object identity whenever anything the layout depends on changes.
  // Comparing it against the committed result derives "still laying out"
  // without writing state during render.
  const layoutToken = useMemo(() => ({}), [graph, rules, serverIds, layout]);
  const [computed, setComputed] = useState<{ token: object | null; positions: Positions }>({
    token: null,
    positions: new Map(),
  });

  const laying = computed.token !== layoutToken;
  const positions = computed.positions;

  useEffect(() => {
    if (!laying) return;
    // Deferred by a frame so the indicator paints before the simulation, which
    // is synchronous and blocks for a moment on a large estate.
    const handle = window.setTimeout(() => {
      setComputed({ token: layoutToken, positions: computeLayout3D(graph, rules, serverIds, layout) });
    }, 16);
    return () => window.clearTimeout(handle);
  }, [laying, layoutToken, graph, rules, serverIds, layout]);

  const bounds = useMemo(() => boundsOf(positions), [positions]);

  /* ------------------------------------------------------------------ *
   * Visual state
   * ------------------------------------------------------------------ */
  const { nodeState, edgeState } = useMemo(() => {
    const nodeDim = new Map<string, number>();
    const edgeDim = new Map<string, number>();

    // Work out which objects are "in scope"; everything else is dimmed rather
    // than hidden, so context is never lost.
    let scopedServers: Set<string> | null = null;
    let scopedRules: Set<string> | null = null;

    if (activePath) {
      scopedServers = new Set(activePath.nodes);
      scopedRules = new Set(activePath.hops.map((hop) => hop.ruleId));
    } else if (focusServerId) {
      scopedServers = new Set([focusServerId]);
      scopedRules = new Set();
      for (const rule of rules) {
        if (rule.source === focusServerId || rule.destination === focusServerId) {
          scopedRules.add(rule.id);
          scopedServers.add(rule.source);
          scopedServers.add(rule.destination);
        }
      }
    } else if (highlightedServerIds.length > 0 || highlightedRuleIds.length > 0) {
      scopedServers = new Set(highlightedServerIds);
      scopedRules = new Set(highlightedRuleIds);
      for (const rule of rules) {
        if (scopedRules.has(rule.id)) {
          scopedServers.add(rule.source);
          scopedServers.add(rule.destination);
        }
      }
    }

    if (scopedServers) {
      for (const id of drawnIds) nodeDim.set(id, scopedServers.has(id) ? 1 : 0.12);
      for (const rule of rules) edgeDim.set(rule.id, scopedRules!.has(rule.id) ? 1 : 0.08);
    }

    const impactMap = new Map<string, string>();
    if (impact) for (const entry of impact) impactMap.set(entry.serverId, entry.level);

    const diffMap = new Map<string, EdgeDiff>();
    if (diff) {
      for (const rule of rules) {
        diffMap.set(
          rule.id,
          diff.added.has(rule.id)
            ? 'ADDED'
            : diff.removed.has(rule.id)
              ? 'REMOVED'
              : diff.modified.has(rule.id)
                ? 'MODIFIED'
                : 'UNCHANGED',
        );
      }
    }

    const selected = new Set(selectedServerIds);
    if (selectedServerId) selected.add(selectedServerId);

    const nodes: NodeVisualState = {
      dim: nodeDim,
      selected,
      impact: impactMap,
      hovered: hoveredServer,
    };
    const edges: EdgeVisualState = {
      dim: edgeDim,
      selected: selectedConnectionId,
      hovered: hoveredEdge,
      diff: diffMap,
    };
    return { nodeState: nodes, edgeState: edges };
  }, [
    drawnIds,
    rules,
    focusServerId,
    highlightedServerIds,
    highlightedRuleIds,
    activePath,
    impact,
    diff,
    selectedServerId,
    selectedServerIds,
    selectedConnectionId,
    hoveredServer,
    hoveredEdge,
  ]);

  /* ------------------------------------------------------------------ *
   * Imperative controls for the toolbar
   * ------------------------------------------------------------------ */
  const controls = useMemo<CanvasControls>(
    () => ({
      zoomIn: () => cameraApi.current?.zoomBy(0.75),
      zoomOut: () => cameraApi.current?.zoomBy(1.33),
      fit: () => cameraApi.current?.fit(),
      resetLayout: () => cameraApi.current?.resetView(),
      center: (serverId: string) => cameraApi.current?.focusOn(serverId),
      png: () => cameraApi.current?.screenshot() ?? null,
    }),
    [],
  );

  useEffect(() => {
    onReady?.(controls);
  }, [controls, onReady]);

  const handleSelectServer = useCallback(
    (serverId: string, additive: boolean) => {
      if (additive) onToggleServer(serverId);
      else onSelectServer(serverId);
    },
    [onSelectServer, onToggleServer],
  );

  const labelled = useMemo(() => {
    if (!showLabels) return [];
    // Labels are billboarded text meshes; past a couple of hundred they
    // dominate the frame, so only the most connected ones are named.
    if (drawnIds.length <= 220) return drawnIds;
    return [...drawnIds]
      .sort((a, b) => (graph.nodes.get(b)?.degree ?? 0) - (graph.nodes.get(a)?.degree ?? 0))
      .slice(0, 160);
  }, [showLabels, drawnIds, graph]);

  return (
    <div
      className="relative h-full w-full"
      onPointerDown={(event) => {
        pointerDownAt.current = { x: event.clientX, y: event.clientY };
      }}
    >
      <Canvas
        shadows
        dpr={effectiveQuality === 'ultra' ? [1, 2] : [1, 1.5]}
        gl={{
          antialias: effectiveQuality !== 'low',
          preserveDrawingBuffer: true,
          powerPreference: 'high-performance',
        }}
        camera={{ fov: 45, near: 0.1, far: 4000, position: [0, 18, 52] }}
        onCreated={({ gl }) => configureRenderer(gl)}
      >
        <SceneLighting radius={bounds.radius} />
        {effectiveFloor ? <ReflectiveFloor radius={bounds.radius} quality={effectiveQuality} /> : null}

        <CameraRig
          bounds={bounds}
          apiRef={cameraApi}
          positions={positions}
          controlMode={controlMode}
        />

        <SceneContents
          graph={graph}
          rules={rules}
          drawnIds={drawnIds}
          positions={positions}
          nodeState={nodeState}
          edgeState={edgeState}
          labelled={labelled}
          showFlow={showFlow}
          animate={effectiveAnimate}
          wasDrag={wasDrag}
          onHoverServer={setHoveredServer}
          onSelectServer={handleSelectServer}
          onHoverEdge={setHoveredEdge}
          onSelectEdge={onSelectConnection}
          onClearSelection={() => {
            onSelectServer(null);
            onSelectConnection(null);
          }}
        />

        <PostProcessing quality={effectiveQuality} />

        <PerformanceGuard
          enabled={!laying && effectiveQuality !== 'low'}
          onStruggling={() => setAutoCeiling(lowerQuality(effectiveQuality))}
        />
      </Canvas>

      {laying ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-ink-900/80 px-4 py-3 shadow-pop backdrop-blur">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-brand-400" />
            <span className="text-[13px] font-medium text-white/80">
              Laying out {drawnIds.length.toLocaleString()} servers in 3D…
            </span>
          </div>
        </div>
      ) : null}

      {drawnIds.length === 0 && !laying ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="rounded-xl border border-white/10 bg-ink-900/80 px-4 py-3 text-sm font-medium text-white/70 backdrop-blur">
            No servers match the current filters.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Scene contents
 * ------------------------------------------------------------------ */

function SceneContents({
  graph,
  rules,
  drawnIds,
  positions,
  nodeState,
  edgeState,
  labelled,
  showFlow,
  animate,
  wasDrag,
  onHoverServer,
  onSelectServer,
  onHoverEdge,
  onSelectEdge,
  onClearSelection,
}: {
  graph: PolicyGraph;
  rules: Rule[];
  drawnIds: string[];
  positions: Positions;
  nodeState: NodeVisualState;
  edgeState: EdgeVisualState;
  labelled: string[];
  showFlow: boolean;
  animate: boolean;
  wasDrag: (event: { nativeEvent: { clientX: number; clientY: number } }) => boolean;
  onHoverServer: (id: string | null) => void;
  onSelectServer: (id: string, additive: boolean) => void;
  onHoverEdge: (id: string | null) => void;
  onSelectEdge: (id: string | null) => void;
  onClearSelection: () => void;
}) {
  const { camera, raycaster } = useThree();

  const pickable = useMemo(() => buildPickableEdges(rules, positions), [rules, positions]);

  /* Edge hover is throttled: the sweep is cheap but not free, and running it
   * on every pointer move at 120Hz is wasted work. */
  const lastHoverCheck = useRef(0);

  const tolerance = useCallback((): number => {
    // Keep the hit area roughly constant on screen regardless of zoom, but
    // keep it well under a node radius: in a dense 3D graph a generous
    // tolerance means almost every click in empty space snaps to some distant
    // connection instead of clearing the selection.
    const distance = camera.position.length();
    return Math.min(NODE_RADIUS * 0.5, Math.max(0.18, distance * 0.006));
  }, [camera]);

  const handlePointerMove = (): void => {
    const now = performance.now();
    if (now - lastHoverCheck.current < 60) return;
    lastHoverCheck.current = now;
    if (nodeState.hovered) {
      onHoverEdge(null);
      return;
    }
    const hit = pickEdge(pickable, raycaster, tolerance());
    onHoverEdge(hit?.ruleId ?? null);
  };

  const handleClick = (event: ThreeEvent<MouseEvent>): void => {
    // A camera drag ends with a pointerup and must not select anything.
    if (wasDrag(event)) return;
    // Nodes stop propagation themselves, so reaching here means empty space
    // was clicked — test the connections before clearing the selection.
    const hit = pickEdge(pickable, raycaster, tolerance());
    if (hit) {
      onSelectEdge(hit.ruleId);
      event.stopPropagation();
      return;
    }
    onClearSelection();
  };

  return (
    <group>
      {/* An invisible sphere that catches pointer events in empty space. */}
      <mesh onPointerMove={handlePointerMove} onClick={handleClick} scale={2000}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial side={THREE.BackSide} transparent opacity={0} depthWrite={false} />
      </mesh>

      <Edges3D rules={rules} positions={positions} state={edgeState} showFlow={showFlow} animate={animate} />

      <Nodes3D
        graph={graph}
        serverIds={drawnIds}
        positions={positions}
        state={nodeState}
        onHover={onHoverServer}
        onSelect={onSelectServer}
        wasDrag={wasDrag}
        animate={animate}
      />

      <NodeLabels graph={graph} ids={labelled} positions={positions} state={nodeState} />
    </group>
  );
}

/* ------------------------------------------------------------------ *
 * Labels
 * ------------------------------------------------------------------ */

function NodeLabels({
  graph,
  ids,
  positions,
  state,
}: {
  graph: PolicyGraph;
  ids: string[];
  positions: Positions;
  state: NodeVisualState;
}) {
  return (
    <group>
      {ids.map((id) => {
        const server = graph.serversById.get(id);
        const position = positions.get(id);
        if (!server || !position) return null;
        const dim = state.dim.get(id) ?? 1;
        if (dim < 0.5 && state.hovered !== id && !state.selected.has(id)) return null;

        return (
          <Billboard key={id} position={[position[0], position[1] + NODE_RADIUS * 1.95, position[2]]}>
            <Text
              fontSize={0.62}
              color="#eef3ff"
              anchorX="center"
              anchorY="bottom"
              outlineWidth={0.05}
              outlineColor="#05070c"
              outlineOpacity={0.85}
              maxWidth={14}
              // Labels must not glow, or bloom turns dense clusters into mush.
              material-toneMapped={false}
            >
              {server.name}
            </Text>
            <Text
              fontSize={0.42}
              color="#8fa3c4"
              anchorX="center"
              anchorY="top"
              position={[0, -0.08, 0]}
              outlineWidth={0.04}
              outlineColor="#05070c"
              outlineOpacity={0.8}
              material-toneMapped={false}
            >
              {`${server.role} · ${server.environment}`}
            </Text>
          </Billboard>
        );
      })}
    </group>
  );
}

/* ------------------------------------------------------------------ *
 * Camera
 * ------------------------------------------------------------------ */

function CameraRig({
  bounds,
  apiRef,
  positions,
  controlMode,
}: {
  bounds: { center: [number, number, number]; radius: number };
  apiRef: React.MutableRefObject<CameraApi | null>;
  positions: Positions;
  controlMode: ControlMode;
}) {
  const { camera, gl } = useThree();
  const orbitRef = useRef<React.ComponentRef<typeof OrbitControls> | null>(null);
  const trackballRef = useRef<React.ComponentRef<typeof TrackballControls> | null>(null);

  /** Smoothly flown-to target, applied each frame. */
  const flight = useRef<{ from: THREE.Vector3; to: THREE.Vector3; target: THREE.Vector3; t: number } | null>(
    null,
  );

  const currentTarget = useCallback((): THREE.Vector3 => {
    const orbit = orbitRef.current as unknown as { target?: THREE.Vector3 } | null;
    if (orbit?.target) return orbit.target;
    const trackball = trackballRef.current as unknown as { target?: THREE.Vector3 } | null;
    if (trackball?.target) return trackball.target;
    return new THREE.Vector3();
  }, []);

  const frame = useCallback(
    (center: THREE.Vector3, radius: number, immediate = false) => {
      // Distance that puts a sphere of `radius` comfortably inside the frustum.
      const perspective = camera as THREE.PerspectiveCamera;
      const fov = (perspective.fov * Math.PI) / 180;
      const distance = (radius / Math.sin(fov / 2)) * 0.92;

      const direction = camera.position.clone().sub(currentTarget());
      if (direction.lengthSq() < 1e-6) direction.set(0.45, 0.42, 1);
      direction.normalize();

      const destination = center.clone().addScaledVector(direction, distance);

      if (immediate) {
        camera.position.copy(destination);
        currentTarget().copy(center);
        return;
      }
      flight.current = { from: camera.position.clone(), to: destination, target: center.clone(), t: 0 };
    },
    [camera, currentTarget],
  );

  /* Frame the graph whenever its extent changes materially. */
  const lastRadius = useRef(0);
  useEffect(() => {
    if (positions.size === 0) return;
    const changed = Math.abs(bounds.radius - lastRadius.current) > lastRadius.current * 0.2 + 1;
    if (!changed) return;
    lastRadius.current = bounds.radius;
    frame(new THREE.Vector3(...bounds.center), bounds.radius, true);
  }, [bounds, positions, frame]);

  useFrame((_, delta) => {
    const active = flight.current;
    if (!active) return;
    active.t = Math.min(1, active.t + delta * 2.4);
    // Ease-out so the move settles rather than stopping dead.
    const eased = 1 - Math.pow(1 - active.t, 3);
    camera.position.lerpVectors(active.from, active.to, eased);
    currentTarget().lerp(active.target, eased);
    if (active.t >= 1) flight.current = null;
  });

  useEffect(() => {
    apiRef.current = {
      zoomBy: (factor: number) => {
        const target = currentTarget();
        const offset = camera.position.clone().sub(target);
        const next = offset.multiplyScalar(factor);
        const length = next.length();
        if (length < NODE_RADIUS * 2 || length > bounds.radius * 14) return;
        flight.current = {
          from: camera.position.clone(),
          to: target.clone().add(next),
          target: target.clone(),
          t: 0,
        };
      },
      fit: () => frame(new THREE.Vector3(...bounds.center), bounds.radius),
      focusOn: (serverId: string) => {
        const position = positions.get(serverId);
        if (!position) return;
        frame(new THREE.Vector3(position[0], position[1], position[2]), NODE_RADIUS * 9);
      },
      resetView: () => {
        const center = new THREE.Vector3(...bounds.center);
        camera.position.set(
          center.x + bounds.radius * 0.9,
          center.y + bounds.radius * 0.75,
          center.z + bounds.radius * 1.5,
        );
        currentTarget().copy(center);
        frame(center, bounds.radius, true);
      },
      // The context is created with preserveDrawingBuffer, so the most recently
      // composed frame — post-processing included — is still readable here.
      screenshot: () => gl.domElement.toDataURL('image/png'),
    };
  }, [apiRef, camera, gl, bounds, positions, frame, currentTarget]);

  const distanceLimits = {
    min: NODE_RADIUS * 2.2,
    max: bounds.radius * 12,
  };

  return controlMode === 'free' ? (
    <TrackballControls
      ref={trackballRef}
      rotateSpeed={3.2}
      zoomSpeed={1.2}
      panSpeed={0.8}
      dynamicDampingFactor={0.12}
      minDistance={distanceLimits.min}
      maxDistance={distanceLimits.max}
    />
  ) : (
    <OrbitControls
      ref={orbitRef}
      makeDefault
      enableDamping
      dampingFactor={0.07}
      rotateSpeed={0.85}
      zoomSpeed={0.9}
      panSpeed={0.8}
      screenSpacePanning
      minDistance={distanceLimits.min}
      maxDistance={distanceLimits.max}
      // Unclamped polar range: the camera can pass over and under the graph.
      minPolarAngle={0}
      maxPolarAngle={Math.PI}
    />
  );
}
