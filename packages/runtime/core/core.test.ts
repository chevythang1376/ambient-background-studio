import { describe, expect, it } from 'vitest';
import { DEFAULTS, resolveConfig } from './config';
import { applyCalm } from './calm';
import { hexToRgb, normalizeHex } from '../lib/color';
import { createNoise3 } from '../lib/noise';

describe('hex parsing', () => {
  it('normalises short, long, hashless and uppercase forms', () => {
    expect(normalizeHex('#abc')).toBe('#aabbcc');
    expect(normalizeHex('AABBCC')).toBe('#aabbcc');
    expect(normalizeHex('  #96694C ')).toBe('#96694c');
  });
  it('rejects junk', () => {
    expect(normalizeHex('#abcd')).toBeNull();
    expect(normalizeHex('red')).toBeNull();
    expect(normalizeHex('')).toBeNull();
  });
  it('converts to 0–1 floats in place', () => {
    const out: [number, number, number] = [0, 0, 0];
    expect(hexToRgb('#ff8000', out)).toBe(out);
    expect(out[0]).toBe(1);
    expect(out[1]).toBeCloseTo(128 / 255);
    expect(out[2]).toBe(0);
  });
});

describe('resolveConfig', () => {
  it('fills defaults from nothing', () => {
    expect(resolveConfig(undefined)).toEqual(DEFAULTS);
    expect(resolveConfig('nope')).toEqual(DEFAULTS);
  });
  it('clamps numbers and ignores non-finite values', () => {
    const c = resolveConfig({ speed: 99, scale: -1, fps: Number.NaN, resolution: 0.1 });
    expect(c.speed).toBe(3);
    expect(c.scale).toBe(0.25);
    expect(c.fps).toBe(DEFAULTS.fps);
    expect(c.resolution).toBe(0.25);
  });
  it('validates enums', () => {
    const c = resolveConfig({ type: 'aurora', pointer: 'swirl', reducedMotion: 'still' });
    expect(c.type).toBe(DEFAULTS.type);
    expect(c.pointer).toBe(DEFAULTS.pointer);
    expect(c.reducedMotion).toBe('still');
  });
  it('keeps 2–5 valid colours, else falls back', () => {
    expect(resolveConfig({ colors: ['#FFF', 'x', '#000'] }).colors).toEqual(['#ffffff', '#000000']);
    expect(resolveConfig({ colors: ['#fff'] }).colors).toEqual(DEFAULTS.colors);
    expect(resolveConfig({ colors: Array(8).fill('#123456') }).colors).toHaveLength(5);
  });
  it('does not share the defaults array', () => {
    const c = resolveConfig({});
    c.colors.push('#ffffff');
    expect(DEFAULTS.colors).toHaveLength(4);
  });
});

describe('calm mapping', () => {
  const base = { speed: 1, turbulence: 1, pointerStrength: 1 };
  it('is identity at calm 1', () => {
    expect(applyCalm({ ...base, calm: 1 })).toEqual({ speed: 1, velocity: 1, turbulence: 1, pointer: 1 });
  });
  it('is near-still (but not frozen) at calm 0', () => {
    const m = applyCalm({ ...base, calm: 0 });
    expect(m.speed).toBeGreaterThan(0);
    expect(m.speed).toBeLessThan(0.05);
    expect(m.velocity).toBeLessThan(0.05);
    expect(m.turbulence).toBeLessThan(0.5);
    expect(m.pointer).toBeLessThan(0.2);
  });
  it('is monotonic', () => {
    let prev = -1;
    for (let k = 0; k <= 1; k += 0.1) {
      const s = applyCalm({ ...base, calm: k }).speed;
      expect(s).toBeGreaterThan(prev);
      prev = s;
    }
  });
  it('still mode overrides calm', () => {
    expect(applyCalm({ ...base, calm: 1 }, true)).toEqual(applyCalm({ ...base, calm: 0 }));
  });
});

describe('simplex noise', () => {
  it('is deterministic per seed and bounded', () => {
    const a = createNoise3(7);
    const b = createNoise3(7);
    const c = createNoise3(8);
    let differs = false;
    for (let i = 0; i < 500; i++) {
      const x = i * 0.37;
      const y = i * 0.11;
      const v = a(x, y, 0.5);
      expect(v).toBe(b(x, y, 0.5));
      expect(Math.abs(v)).toBeLessThanOrEqual(1.01);
      if (v !== c(x, y, 0.5)) differs = true;
    }
    expect(differs).toBe(true);
  });
});
