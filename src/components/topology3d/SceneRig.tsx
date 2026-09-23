import { useMemo } from 'react';
import * as THREE from 'three';
import { Environment, Lightformer, MeshReflectorMaterial } from '@react-three/drei';
import {
  Bloom,
  BrightnessContrast,
  EffectComposer,
  HueSaturation,
  N8AO,
  SMAA,
  ToneMapping,
  Vignette,
} from '@react-three/postprocessing';
import { BlendFunction, ToneMappingMode } from 'postprocessing';

export type QualityLevel = 'low' | 'balanced' | 'ultra';

export interface SceneRigProps {
  quality: QualityLevel;
  /** Radius of the sphere enclosing the graph, used to size the rig. */
  radius: number;
  showFloor: boolean;
}

/**
 * Lighting rig.
 *
 * The environment is built from emissive panels rather than a downloaded HDRI:
 * it produces the same soft, physically plausible reflections on the metal
 * bodies, costs nothing to fetch, and works with no network connection.
 */
export function SceneLighting({ radius }: { radius: number }) {
  const shadowExtent = Math.max(radius * 1.6, 20);

  return (
    <>
      <color attach="background" args={['#070910']} />
      <fog attach="fog" args={['#070910', radius * 2.4, radius * 7]} />

      <ambientLight intensity={0.55} color="#93a8cc" />

      {/* Key light — warm, casts the shadows that ground the scene. */}
      <directionalLight
        position={[radius * 1.1, radius * 1.5, radius * 0.9]}
        intensity={3.4}
        color="#fff4e2"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0006}
        shadow-normalBias={0.03}
      >
        <orthographicCamera
          attach="shadow-camera"
          args={[-shadowExtent, shadowExtent, shadowExtent, -shadowExtent, 0.1, shadowExtent * 5]}
        />
      </directionalLight>

      {/* Cool fill from the opposite side keeps the dark sides from going flat. */}
      <directionalLight position={[-radius, radius * 0.4, -radius * 0.8]} intensity={1.25} color="#6f9bff" />
      {/* Rim from behind separates the silhouettes from the background. */}
      <directionalLight position={[0, -radius * 0.6, -radius * 1.3]} intensity={0.95} color="#3563f4" />

      <Environment resolution={256} frames={1}>
        <Lightformer
          form="rect"
          intensity={6.5}
          color="#ffffff"
          position={[0, radius * 1.4, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[radius * 2, radius * 2, 1]}
        />
        <Lightformer
          form="rect"
          intensity={3.4}
          color="#6f9bff"
          position={[-radius * 1.5, radius * 0.2, 0]}
          rotation={[0, Math.PI / 2, 0]}
          scale={[radius * 1.4, radius * 1.4, 1]}
        />
        <Lightformer
          form="rect"
          intensity={2.6}
          color="#ff9f6e"
          position={[radius * 1.5, 0, radius * 0.4]}
          rotation={[0, -Math.PI / 2, 0]}
          scale={[radius * 1.2, radius * 1.2, 1]}
        />
        <Lightformer
          form="ring"
          intensity={2.0}
          color="#9ec5ff"
          position={[0, -radius, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={radius * 1.6}
        />
      </Environment>
    </>
  );
}

/**
 * Reflective ground plane.
 *
 * A real blurred reflection rather than a fake gradient: it is what makes the
 * nodes look like objects sitting in a space instead of sprites on a backdrop.
 */
export function ReflectiveFloor({ radius, quality }: { radius: number; quality: QualityLevel }) {
  const size = Math.max(radius * 6, 80);
  const y = -radius * 1.05;

  // The reflector renders the whole scene a second time. That is the single
  // biggest cost in this rig, so at the lowest quality the floor becomes an
  // ordinary matte plane rather than a cheaper mirror.
  const resolution = quality === 'ultra' ? 1024 : 512;

  return (
    <group position={[0, y, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[size, size]} />
        {quality === 'low' ? (
          <meshStandardMaterial color="#0a0d14" roughness={0.95} metalness={0.25} />
        ) : (
          <MeshReflectorMaterial
            resolution={resolution}
            mixBlur={1}
            mixStrength={26}
            blur={[380, 110]}
            mirror={0.55}
            depthScale={1.1}
            minDepthThreshold={0.4}
            maxDepthThreshold={1.3}
            roughness={0.92}
            metalness={0.62}
            color="#0a0d14"
          />
        )}
      </mesh>

      {/* Faint grid, purely for depth cueing. */}
      <gridHelper
        args={[size, Math.round(size / (radius / 6 || 4)), '#1d2637', '#131a26']}
        position={[0, 0.02, 0]}
      />
    </group>
  );
}

/**
 * Post-processing chain.
 *
 * Order matters: ambient occlusion before bloom so contact shadows are not
 * bloomed, and tone mapping last so the whole frame is mapped together.
 */
export function PostProcessing({ quality }: { quality: QualityLevel }) {
  const enableAO = quality !== 'low';
  const enableSMAA = quality === 'ultra';

  // Remounting the composer when the effect set changes avoids a stale chain.
  const key = useMemo(() => `${quality}`, [quality]);

  return (
    <EffectComposer key={key} enableNormalPass={enableAO} multisampling={quality === 'ultra' ? 4 : 0}>
      {enableAO ? (
        <N8AO
          aoRadius={2.4}
          intensity={2.6}
          distanceFalloff={1.1}
          quality={quality === 'ultra' ? 'high' : 'medium'}
          color="#05070c"
        />
      ) : (
        <></>
      )}

      <Bloom
        intensity={quality === 'low' ? 0.7 : 1.15}
        luminanceThreshold={0.28}
        luminanceSmoothing={0.35}
        mipmapBlur
        radius={0.72}
      />

      <HueSaturation saturation={0.06} />
      <BrightnessContrast brightness={0.008} contrast={0.09} />
      <Vignette offset={0.28} darkness={0.62} blendFunction={BlendFunction.NORMAL} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      {enableSMAA ? <SMAA /> : <></>}
    </EffectComposer>
  );
}

/** Renderer settings applied once the GL context exists. */
export function configureRenderer(gl: THREE.WebGLRenderer): void {
  gl.toneMapping = THREE.ACESFilmicToneMapping;
  gl.toneMappingExposure = 1.05;
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = THREE.PCFSoftShadowMap;
}
