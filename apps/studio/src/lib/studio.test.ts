import { describe, expect, it } from 'vitest';
import {
  AA_LARGE,
  AA_NORMAL,
  assessContrast,
  contrastRatio,
  formatRatio,
  hexLuminance,
  luminance,
  sampleLuminance,
} from './contrast';
import { formatPalette, isUsable, paletteMessage, parsePalette } from './palette';

describe('contrast ratio math', () => {
  it('uses WCAG relative luminance', () => {
    expect(luminance(255, 255, 255)).toBeCloseTo(1, 6);
    expect(luminance(0, 0, 0)).toBe(0);
    // Pure primaries weigh by the Rec. 709 coefficients.
    expect(luminance(255, 0, 0)).toBeCloseTo(0.2126, 4);
    expect(luminance(0, 255, 0)).toBeCloseTo(0.7152, 4);
    expect(hexLuminance('#fff')).toBeCloseTo(1, 6);
    expect(hexLuminance('nope')).toBeNull();
  });

  it('matches known ratios', () => {
    expect(contrastRatio(1, 0)).toBeCloseTo(21, 6);
    expect(contrastRatio(0.3, 0.3)).toBe(1);
    expect(contrastRatio(0, 1)).toBe(contrastRatio(1, 0)); // order-free
    const white = hexLuminance('#ffffff')!;
    // The classic AA boundary: #777 fails on white, #767676 passes.
    expect(contrastRatio(white, hexLuminance('#777777')!)).toBeCloseTo(4.48, 2);
    expect(contrastRatio(white, hexLuminance('#767676')!)).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(contrastRatio(white, hexLuminance('#777777')!)).toBeLessThan(AA_NORMAL);
  });

  it('formats by truncating, so a near miss never displays as a pass', () => {
    expect(formatRatio(4.4999)).toBe('4.49:1');
    expect(formatRatio(21)).toBe('21.00:1');
  });

  it('samples a region evenly, within the sample budget', () => {
    const w = 200;
    const h = 100;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = i % w < w / 2 ? 0 : 255;
    const lums = sampleLuminance({ data, width: w, height: h }, 1000);
    expect(lums.length).toBeLessThanOrEqual(1000 * 1.2);
    expect(lums.length).toBeGreaterThan(400);
    const mean = lums.reduce((a, b) => a + b, 0) / lums.length;
    expect(mean).toBeCloseTo(0.5, 1); // half black, half white
  });

  it('judges text against the low end of the background, not the average', () => {
    const bg = (whiteShare: number) => {
      const a = new Float32Array(1000);
      a.fill(1, 0, Math.round(whiteShare * 1000)); // the rest stays black (0)
      return a;
    };
    // White text over a black field with 3% white specks: the specks are ignored.
    const specks = assessContrast(1, bg(0.03));
    expect(specks.low).toBeCloseTo(21, 3);
    expect(specks.passNormal).toBe(true);
    // A white band behind 10% of the headline fails it, even though the average looks fine.
    const band = assessContrast(1, bg(0.1));
    expect(band.low).toBeCloseTo(1, 3);
    expect(band.passLarge).toBe(false);
    expect(band.average).toBeGreaterThan(AA_NORMAL);
  });

  it('applies the AA thresholds for large and body text', () => {
    const grey = hexLuminance('#5a5a5a')!; // ≈ 3.04:1 against black
    const r = assessContrast(0, new Float32Array(10).fill(grey));
    expect(r.low).toBeGreaterThanOrEqual(AA_LARGE);
    expect(r.passLarge).toBe(true);
    expect(r.passNormal).toBe(false);
    expect(assessContrast(1, new Float32Array(0)).passLarge).toBe(false); // nothing sampled
  });
});

describe('palette parsing', () => {
  it('accepts comma, newline and mixed separators', () => {
    expect(parsePalette('#111111, #222222,#333333').colors).toEqual(['#111111', '#222222', '#333333']);
    expect(parsePalette('#111111\n#222222\r\n  #333333\n').colors).toEqual(['#111111', '#222222', '#333333']);
    expect(parsePalette('#111 #2a2a2a; ABCDEF').colors).toEqual(['#111111', '#2a2a2a', '#abcdef']);
  });

  it('accepts a pasted JSON array', () => {
    expect(parsePalette('["#96694c", "#1d1d1f"]').colors).toEqual(['#96694c', '#1d1d1f']);
  });

  it('reports invalid tokens and keeps the valid ones', () => {
    const p = parsePalette('#111111, #12, blue, #333333');
    expect(p.colors).toEqual(['#111111', '#333333']);
    expect(p.invalid).toEqual(['#12', 'blue']);
    expect(isUsable(p)).toBe(true);
    expect(paletteMessage(p)).toMatch(/“#12”, “blue” aren’t hex colours/);
  });

  it('needs at least two colours and keeps at most five', () => {
    const one = parsePalette('#111111');
    expect(isUsable(one)).toBe(false);
    expect(paletteMessage(one)).toMatch(/at least 2/);
    const seven = parsePalette('#111 #222 #333 #444 #555 #666 #777');
    expect(seven.colors).toHaveLength(5);
    expect(seven.dropped).toBe(2);
    expect(paletteMessage(seven)).toMatch(/first 5/);
    expect(paletteMessage(parsePalette('#111, #222'))).toBeNull();
    expect(parsePalette('').colors).toEqual([]);
  });

  it('formats for display', () => {
    expect(formatPalette(['#111111', '#222222'])).toBe('#111111, #222222');
  });
});
