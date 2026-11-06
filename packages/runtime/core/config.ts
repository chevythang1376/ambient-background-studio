import type { BackgroundType, Config, PointerMode, ReducedMotionMode } from '../types';
import { normalizeHex } from '../lib/color';

export const TYPES: readonly BackgroundType[] = ['shader-gradient', 'flow-field', 'particle-mesh'];
const POINTER_MODES: readonly PointerMode[] = ['off', 'attract', 'repel', 'light'];
const REDUCED: readonly ReducedMotionMode[] = ['poster', 'still'];

export const MIN_COLORS = 2;
export const MAX_COLORS = 5;

export const DEFAULTS: Readonly<Config> = {
  type: 'shader-gradient',
  colors: ['#1d1d1f', '#3b3346', '#96694c', '#d9b99b'],
  speed: 1,
  scale: 1,
  turbulence: 0.5,
  calm: 1,
  grain: 0.15,
  pointer: 'light',
  pointerStrength: 0.3,
  density: 0.6,
  trail: 0.6,
  seed: 1,
  resolution: 0.5,
  dprCap: 1.5,
  fps: 30,
  reducedMotion: 'poster',
};

/** Numeric fields and their allowed ranges. */
export const RANGES = {
  speed: [0, 3],
  scale: [0.25, 4],
  turbulence: [0, 1],
  calm: [0, 1],
  grain: [0, 1],
  pointerStrength: [0, 1],
  density: [0, 1],
  trail: [0, 1],
  seed: [0, 9999],
  resolution: [0.25, 1],
  dprCap: [0.5, 3],
  fps: [1, 60],
} as const satisfies Partial<Record<keyof Config, readonly [number, number]>>;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

/**
 * Fill defaults and clamp every field to its range. Accepts untrusted input
 * (a `data-abs` attribute, a preset file, a pasted JSON) and never throws.
 */
export function resolveConfig(input: unknown): Config {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: Config = { ...DEFAULTS, colors: [...DEFAULTS.colors] };

  out.type = pick(src.type, TYPES, DEFAULTS.type);
  out.pointer = pick(src.pointer, POINTER_MODES, DEFAULTS.pointer);
  out.reducedMotion = pick(src.reducedMotion, REDUCED, DEFAULTS.reducedMotion);

  for (const key of Object.keys(RANGES) as (keyof typeof RANGES)[]) {
    const v = src[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      const [lo, hi] = RANGES[key];
      out[key] = clamp(v, lo, hi);
    }
  }

  if (Array.isArray(src.colors)) {
    const colors = src.colors
      .map((c) => (typeof c === 'string' ? normalizeHex(c) : null))
      .filter((c): c is string => c !== null)
      .slice(0, MAX_COLORS);
    if (colors.length >= MIN_COLORS) out.colors = colors;
  }

  return out;
}
