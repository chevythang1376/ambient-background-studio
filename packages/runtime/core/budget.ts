/**
 * The budget rules. Decides, from config and device, how much work a
 * background may do. When visual richness and the budget disagree, the budget
 * wins.
 */
import type { Budget, Config } from '../types';

/** Hard cap on backing-store pixels (≈ 1440×1040). Protects 4K/5K screens. */
export const MAX_PIXELS = 1_500_000;
/** Particle / line cap for Canvas 2D types. */
export const MAX_PARTICLES = 4000;
/** The near-still reduced-motion variant barely changes per frame: 12 fps is plenty. */
export const STILL_FPS = 12;

export function computeBudget(cfg: Config, devicePixelRatio: number, still: boolean): Budget {
  return {
    resolution: cfg.resolution,
    dpr: Math.min(devicePixelRatio || 1, cfg.dprCap),
    fps: still ? Math.min(cfg.fps, STILL_FPS) : cfg.fps,
    maxParticles: MAX_PARTICLES,
    still,
  };
}

/**
 * Backing-store size for an element of `cssW × cssH`: CSS size × dpr ×
 * resolution, shrunk further if it would exceed MAX_PIXELS. Returns the size and
 * the effective resolution actually used.
 */
export function backingSize(
  cssW: number,
  cssH: number,
  resolution: number,
  dpr: number,
): [w: number, h: number, resolution: number] {
  let s = dpr * resolution;
  const px = cssW * cssH * s * s;
  if (px > MAX_PIXELS) s *= Math.sqrt(MAX_PIXELS / px);
  return [Math.max(1, Math.round(cssW * s)), Math.max(1, Math.round(cssH * s)), s / dpr];
}
