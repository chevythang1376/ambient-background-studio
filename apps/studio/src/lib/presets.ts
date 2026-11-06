/**
 * Presets: one JSON file per preset in /presets, each with a name, a mood tag,
 * the headline colour it was tuned for, a one-line description and a full config.
 *
 *   { "name": "Morning Mist", "mood": "calm-saas", "text": "#111111",
 *     "description": "…", "config": { "type": "shader-gradient", … every field } }
 *
 * The id is the file name. Parsing is strict (a preset that the runtime would
 * clamp or fill in is a broken preset), and pure, so Node tests run it too.
 */
import type { BackgroundType, Config } from '@abs/runtime/types';
import { DEFAULTS, resolveConfig, TYPES } from '@abs/runtime/core/config';
import { normalizeHex } from '@abs/runtime/lib/color';

export type Mood = 'calm-saas' | 'luxury' | 'playful' | 'dark-tech';

export const MOODS: readonly { id: Mood; label: string; blurb: string }[] = [
  { id: 'calm-saas', label: 'Calm SaaS', blurb: 'Light, airy and quiet. For product pages that need to feel trustworthy.' },
  { id: 'luxury', label: 'Luxury', blurb: 'Deep, warm and slow, with film grain. For brands that sell craft.' },
  { id: 'playful', label: 'Playful', blurb: 'Soft pastels with a little bounce. Friendly, never loud.' },
  { id: 'dark-tech', label: 'Dark tech', blurb: 'Navy, teal and graphite. For developer tools and infrastructure.' },
];

export interface Preset {
  id: string;
  name: string;
  mood: Mood;
  /** Headline colour the preset is tuned for (contrast is checked against it). */
  text: string;
  description: string;
  config: Config;
}

const isMood = (v: unknown): v is Mood => MOODS.some((m) => m.id === v);

/** Validate one preset file. Throws with a readable message. */
export function parsePreset(id: string, json: unknown): Preset {
  const fail = (msg: string): never => {
    throw new Error(`preset "${id}": ${msg}`);
  };
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) fail('file name must be kebab-case');
  if (!json || typeof json !== 'object') fail('not an object');
  const src = json as Record<string, unknown>;
  const name = typeof src.name === 'string' && src.name.trim() ? src.name.trim() : fail('missing name');
  const mood = isMood(src.mood) ? src.mood : fail(`mood must be one of ${MOODS.map((m) => m.id).join(', ')}`);
  const text = (typeof src.text === 'string' && normalizeHex(src.text)) || fail('text must be a hex colour');
  const description = typeof src.description === 'string' && src.description.trim() ? src.description.trim() : fail('missing description');
  const raw = src.config;
  if (!raw || typeof raw !== 'object') fail('missing config');
  const rawConfig = raw as Record<string, unknown>;
  const missing = Object.keys(DEFAULTS).filter((k) => !(k in rawConfig));
  if (missing.length) fail(`config is missing ${missing.join(', ')} (presets carry every field)`);
  const extra = Object.keys(rawConfig).filter((k) => !(k in DEFAULTS));
  if (extra.length) fail(`config has unknown fields ${extra.join(', ')}`);
  const config = resolveConfig(rawConfig);
  for (const key of Object.keys(DEFAULTS) as (keyof Config)[]) {
    if (JSON.stringify(config[key]) !== JSON.stringify(rawConfig[key])) fail(`config.${key} is out of range or invalid`);
  }
  return { id, name, mood, text, description, config };
}

const TYPE_ORDER = (t: BackgroundType) => TYPES.indexOf(t);

/** Parse a set of preset files (id → JSON) into the gallery order: mood, then type, then name. */
export function loadPresets(files: Record<string, unknown>): Preset[] {
  const out = Object.entries(files).map(([id, json]) => parsePreset(id, json));
  const moodIndex = (m: Mood) => MOODS.findIndex((x) => x.id === m);
  return out.sort(
    (a, b) => moodIndex(a.mood) - moodIndex(b.mood) || TYPE_ORDER(a.config.type) - TYPE_ORDER(b.config.type) || a.name.localeCompare(b.name),
  );
}

/** True when `cfg` still matches the preset exactly. */
export function matchesPreset(cfg: Config, p: Preset): boolean {
  return (Object.keys(DEFAULTS) as (keyof Config)[]).every((k) => JSON.stringify(cfg[k]) === JSON.stringify(p.config[k]));
}

/** OKLCH chroma of a hex colour: how saturated it looks (neon is above ~0.2). */
export function oklchChroma(hex: string): number {
  const h = normalizeHex(hex);
  if (!h) return NaN;
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(h.slice(i, i + 2), 16) / 255)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return Math.hypot(A, B);
}
