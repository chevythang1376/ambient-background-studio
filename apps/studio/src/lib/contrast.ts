/**
 * WCAG 2.x contrast math for the studio's contrast check.
 *
 * A background is never one flat colour, so the check samples the poster
 * pixels behind the preview headline and judges the text against the low end
 * of that distribution (the 5th percentile), not the average. A few stray
 * pixels can't fail it, but a bright band behind half the headline will.
 */
import { normalizeHex } from '@abs/runtime/lib/color';

/** AA minimum for body text. */
export const AA_NORMAL = 4.5;
/** AA minimum for large text (≥ 24 px, or ≥ 18.66 px bold), such as a hero headline. */
export const AA_LARGE = 3;
/** Share of background pixels allowed to fall below the reported ratio. */
export const LOW_PERCENTILE = 0.05;

// 8-bit sRGB channel → linear light, as a table: the check runs over thousands of pixels.
const LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of an 8-bit sRGB colour, 0 (black) to 1 (white). */
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * LINEAR[r & 255]! + 0.7152 * LINEAR[g & 255]! + 0.0722 * LINEAR[b & 255]!;
}

/** Relative luminance of a hex colour, or null if it isn't one. */
export function hexLuminance(hex: string): number | null {
  const h = normalizeHex(hex);
  if (!h) return null;
  const n = parseInt(h.slice(1), 16);
  return luminance((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

/** WCAG contrast ratio between two relative luminances, 1 to 21. Order doesn't matter. */
export function contrastRatio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export interface PixelRegion {
  data: ArrayLike<number>; // RGBA, 4 bytes per pixel (ImageData layout)
  width: number;
  height: number;
}

/** Luminance of up to about `maxSamples` pixels spread evenly over an RGBA region. */
export function sampleLuminance(img: PixelRegion, maxSamples = 4096): Float32Array {
  const { data, width, height } = img;
  const stride = Math.max(1, Math.ceil(Math.sqrt((width * height) / maxSamples)));
  const out = new Float32Array(Math.ceil(width / stride) * Math.ceil(height / stride));
  let k = 0;
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const i = (y * width + x) * 4;
      out[k++] = luminance(data[i]!, data[i + 1]!, data[i + 2]!);
    }
  }
  return out;
}

export interface ContrastResult {
  /** Ratio against the low end of the background. Pass/fail uses this. */
  low: number;
  /** Ratio against the mean background luminance, for reference. */
  average: number;
  /** AA for body text (4.5:1). */
  passNormal: boolean;
  /** AA for large text (3:1). */
  passLarge: boolean;
}

/** Judge text of luminance `text` against sampled background luminances. */
export function assessContrast(text: number, background: ArrayLike<number>, percentile = LOW_PERCENTILE): ContrastResult {
  const n = background.length;
  if (!n) return { low: 1, average: 1, passNormal: false, passLarge: false };
  const ratios = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const b = background[i]!;
    ratios[i] = contrastRatio(text, b);
    sum += b;
  }
  ratios.sort();
  const low = ratios[Math.min(n - 1, Math.floor(n * percentile))]!;
  return { low, average: contrastRatio(text, sum / n), passNormal: low >= AA_NORMAL, passLarge: low >= AA_LARGE };
}

/**
 * Format a ratio as "4.49:1". Truncates rather than rounds, because WCAG
 * thresholds are exact: 4.499 must not display as a passing 4.50.
 */
export function formatRatio(r: number): string {
  return `${(Math.floor(r * 100) / 100).toFixed(2)}:1`;
}
