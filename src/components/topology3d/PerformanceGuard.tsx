import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { QualityLevel } from './SceneRig';

export const QUALITY_ORDER: QualityLevel[] = ['low', 'balanced', 'ultra'];

/** One step down the quality ladder, or null if already at the bottom. */
export function lowerQuality(quality: QualityLevel): QualityLevel | null {
  const index = QUALITY_ORDER.indexOf(quality);
  return index > 0 ? QUALITY_ORDER[index - 1] : null;
}

/**
 * Frame-rate watchdog.
 *
 * The right render settings depend on the machine, and there is no way to know
 * in advance what a given user's GPU will manage: the post-processing chain
 * that runs effortlessly on a discrete card can crawl on integrated graphics.
 * Rather than guess, this measures what the scene is actually achieving and
 * steps the quality down when it is clearly struggling.
 *
 * It only ever reduces. Stepping back up on a brief recovery would oscillate
 * between settings, which is far more distracting than a slightly conservative
 * picture.
 */
export function PerformanceGuard({
  enabled,
  minimumFps = 24,
  sampleSeconds = 2.5,
  onStruggling,
}: {
  enabled: boolean;
  minimumFps?: number;
  sampleSeconds?: number;
  onStruggling: () => void;
}) {
  const frames = useRef(0);
  const elapsed = useRef(0);
  // The first moments after a scene change are full of one-off costs — shader
  // compilation, texture uploads — so the first window is discarded.
  const warmedUp = useRef(false);

  useFrame((_, delta) => {
    if (!enabled) return;
    frames.current += 1;
    elapsed.current += delta;

    if (elapsed.current < sampleSeconds) return;

    const fps = frames.current / elapsed.current;
    frames.current = 0;
    elapsed.current = 0;

    if (!warmedUp.current) {
      warmedUp.current = true;
      return;
    }
    if (fps < minimumFps) onStruggling();
  });

  return null;
}
