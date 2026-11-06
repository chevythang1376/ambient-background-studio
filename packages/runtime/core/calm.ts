import type { Config } from '../types';

/** Effective motion after the calm master has been applied. */
export interface Motion {
  /** Time multiplier for field evolution. */
  speed: number;
  /** Effective turbulence, 0–1. */
  turbulence: number;
  /** Effective cursor strength, 0–1. */
  pointer: number;
  /** Particle velocity multiplier (Canvas 2D types). */
  velocity: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The calm master slider: one value that scales speed, turbulence, cursor
 * strength and particle velocity down together. At calm = 0 the background is
 * near-still (not frozen, so it still reads as alive). Speed uses a curve so the
 * lower half of the slider stays in the "barely moving" range where it matters.
 *
 * `still` forces the reduced-motion near-still variant regardless of calm.
 */
export function applyCalm(
  c: Pick<Config, 'speed' | 'turbulence' | 'pointerStrength' | 'calm'>,
  still = false,
  out: Motion = { speed: 0, turbulence: 0, pointer: 0, velocity: 0 },
): Motion {
  const k = still ? 0 : Math.min(1, Math.max(0, c.calm));
  const motion = lerp(0.03, 1, Math.pow(k, 1.5));
  out.speed = c.speed * motion;
  out.velocity = c.speed * motion;
  out.turbulence = c.turbulence * lerp(0.4, 1, k);
  out.pointer = c.pointerStrength * lerp(0.15, 1, k);
  return out;
}
