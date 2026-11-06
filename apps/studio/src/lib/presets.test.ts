import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { configHash, POSTER_DIR } from '../../../../scripts/poster-manifest.mjs';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, TYPES } from '@abs/runtime/core/config';
import { contrastRatio, hexLuminance } from './contrast';
import { loadPresets, matchesPreset, MOODS, oklchChroma, parsePreset } from './presets';

const dir = fileURLToPath(new URL('../../../../presets/', import.meta.url));
const files = Object.fromEntries(
  readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(dir + f, 'utf8'))]),
);
const presets = loadPresets(files);
const ratio = (a: string, b: string) => contrastRatio(hexLuminance(a)!, hexLuminance(b)!);

describe('preset files', () => {
  it('ships at least 20, at least 5 per mood, covering every type', () => {
    expect(presets.length).toBeGreaterThanOrEqual(20);
    for (const m of MOODS) expect(presets.filter((p) => p.mood === m.id).length, m.id).toBeGreaterThanOrEqual(5);
    for (const t of TYPES) expect(presets.some((p) => p.config.type === t), t).toBe(true);
    // Grain is the fourth type: an overlay every preset sets on purpose.
    expect(presets.filter((p) => p.config.grain > 0).length).toBe(presets.length);
  });

  it('gives every mood at least two background types', () => {
    for (const m of MOODS) expect(new Set(presets.filter((p) => p.mood === m.id).map((p) => p.config.type)).size, m.id).toBeGreaterThanOrEqual(2);
  });

  it('has unique names', () => {
    expect(new Set(presets.map((p) => p.name)).size).toBe(presets.length);
  });

  it('carries a full config that the runtime takes as is', () => {
    for (const p of presets) {
      expect(Object.keys(files[p.id].config).sort(), p.id).toEqual(Object.keys(DEFAULTS).sort());
      expect(matchesPreset(p.config, p), p.id).toBe(true);
    }
  });

  it('keeps the budget defaults: 30 fps, half resolution, DPR 1.5, poster for reduced motion', () => {
    for (const p of presets) {
      expect(p.config, p.id).toMatchObject({ fps: 30, resolution: 0.5, dprCap: 1.5, reducedMotion: 'poster' });
    }
  });

  it('keeps motion subtle: slow, gentle cursor, light grain', () => {
    for (const p of presets) {
      expect(p.config.speed, p.id).toBeLessThanOrEqual(1);
      expect(p.config.pointerStrength, p.id).toBeLessThanOrEqual(0.35);
      expect(p.config.grain, p.id).toBeLessThanOrEqual(0.3);
    }
  });

  it('has no garish colours (OKLCH chroma at most 0.15)', () => {
    for (const p of presets) for (const c of p.config.colors) expect(oklchChroma(c), `${p.id} ${c}`).toBeLessThanOrEqual(0.15);
  });

  it('suits its headline colour on every palette stop it paints large areas with', () => {
    for (const p of presets) {
      // The shader blends every stop over large areas; Canvas 2D types paint
      // colors[0] as the ground and the rest as thin lines.
      const grounds = p.config.type === 'shader-gradient' ? p.config.colors : p.config.colors.slice(0, 1);
      for (const c of grounds) expect(ratio(p.text, c), `${p.id} ${c}`).toBeGreaterThanOrEqual(4.5);
      for (const c of p.config.colors.slice(grounds.length)) expect(ratio(p.text, c), `${p.id} ink ${c}`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('preset posters', () => {
  const manifest = JSON.parse(readFileSync(POSTER_DIR + 'manifest.json', 'utf8')) as Record<string, { hash: string; bytes: number }>;

  it('has an up-to-date poster file for every preset (else run `npm run posters`)', () => {
    expect(Object.keys(manifest).sort()).toEqual(presets.map((p) => p.id).sort());
    for (const p of presets) {
      expect(manifest[p.id]!.hash, `${p.id} poster is stale: run npm run posters`).toBe(configHash(files[p.id].config));
      expect(statSync(`${POSTER_DIR}${p.id}.webp`).size, p.id).toBe(manifest[p.id]!.bytes);
    }
  });

  it('keeps every poster light: under 80 KB', () => {
    for (const p of presets) expect(manifest[p.id]!.bytes, p.id).toBeLessThan(80 * 1024);
  });
});

describe('parsePreset', () => {
  const good = { name: 'X', mood: 'luxury', text: '#fff', description: 'd', config: { ...DEFAULTS } };

  it('accepts a complete preset and normalises the text colour', () => {
    expect(parsePreset('x', good).text).toBe('#ffffff');
  });

  it('rejects a missing field, an unknown field, an out-of-range value, a bad mood or id', () => {
    const { seed: _seed, ...noSeed } = DEFAULTS;
    expect(() => parsePreset('x', { ...good, config: noSeed })).toThrow(/missing seed/);
    expect(() => parsePreset('x', { ...good, config: { ...DEFAULTS, glow: 1 } })).toThrow(/unknown fields glow/);
    expect(() => parsePreset('x', { ...good, config: { ...DEFAULTS, fps: 240 } })).toThrow(/config\.fps/);
    expect(() => parsePreset('x', { ...good, mood: 'loud' })).toThrow(/mood/);
    expect(() => parsePreset('Bad Name', good)).toThrow(/kebab-case/);
  });

  it('measures chroma: neutral greys are 0, a neon pink is well above 0.2', () => {
    expect(oklchChroma('#777777')).toBeLessThan(0.001);
    expect(oklchChroma('#ff00cc')).toBeGreaterThan(0.25);
  });
});
