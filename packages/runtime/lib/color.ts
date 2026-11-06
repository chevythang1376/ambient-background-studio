/** Colour helpers. Colours travel as hex strings in config and as 0–1 floats on the GPU. */

export type RGB = [number, number, number];

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Normalise `#abc`, `abc`, `#aabbcc` or `AABBCC` to lowercase `#aabbcc`; `null` if invalid. */
export function normalizeHex(input: string): string | null {
  const m = HEX.exec(input.trim());
  if (!m) return null;
  let h = m[1]!.toLowerCase();
  if (h.length === 3) h = h[0]! + h[0] + h[1] + h[1] + h[2] + h[2];
  return '#' + h;
}

/** Parse a hex colour into 0–1 floats, writing into `out` when given (no allocation). */
export function hexToRgb(hex: string, out: RGB = [0, 0, 0]): RGB {
  const n = parseInt((normalizeHex(hex) ?? '#000000').slice(1), 16);
  out[0] = ((n >> 16) & 255) / 255;
  out[1] = ((n >> 8) & 255) / 255;
  out[2] = (n & 255) / 255;
  return out;
}

/** CSS `rgba()` string from a hex colour and alpha. */
export function hexToRgba(hex: string, alpha: number): string {
  const c = hexToRgb(hex);
  return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${alpha})`;
}
