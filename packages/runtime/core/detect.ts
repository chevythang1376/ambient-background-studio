/**
 * Environment detection and the fallback decision. `decide()` is pure so the
 * whole flow is unit-testable:
 *
 *   prefers-reduced-motion? ── yes ─→ poster (or near-still, per export)
 *          │ no
 *   WebGL available? (WebGL types only) ── no ─→ CSS gradient
 *          │ yes
 *   animate, capped ⇄ paused while off-screen / tab hidden
 */
import type { ReducedMotionMode } from '../types';

export type Outcome = 'animate' | 'still' | 'poster' | 'css';

export interface DecisionInput {
  reducedMotion: boolean;
  /** Export choice for reduced motion. */
  mode: ReducedMotionMode;
  needsWebGL: boolean;
  /** A WebGL context could be created (false once creation has failed). */
  webgl: boolean;
  /** The renderer can't run right now: WebGL context lost, or Canvas 2D failed. */
  broken?: boolean;
}

export function decide(i: DecisionInput): Outcome {
  if (i.reducedMotion && i.mode === 'poster') return 'poster';
  if (i.needsWebGL && !i.webgl) return 'css';
  if (i.broken) return 'poster';
  return i.reducedMotion ? 'still' : 'animate';
}

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Live media query (null where matchMedia doesn't exist). */
export function reducedMotionQuery(): MediaQueryList | null {
  return typeof matchMedia === 'function' ? matchMedia(REDUCED_MOTION_QUERY) : null;
}

/** Subscribe to preference changes (Safari < 14 only has addListener). */
export function onChange(mq: MediaQueryList, fn: () => void): () => void {
  if (mq.addEventListener) {
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }
  mq.addListener(fn);
  return () => mq.removeListener(fn);
}
