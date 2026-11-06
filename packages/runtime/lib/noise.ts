/**
 * Seeded 3D simplex noise for Canvas 2D renderers (after Stefan Gustavson's
 * public-domain reference). Returns roughly −1…1. The returned function never
 * allocates, so it is safe to call thousands of times per frame.
 */

const F3 = 1 / 3;
const G3 = 1 / 6;
// 12 edge-midpoint gradients of a cube, flattened.
const GRAD = new Int8Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1,
  -1, 0, -1, -1,
]);

/** Small seeded PRNG (mulberry32), 0 ≤ x < 1. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Noise3 = (x: number, y: number, z: number) => number;

export function createNoise3(seed: number): Noise3 {
  const rand = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = p[i]!;
    p[i] = p[j]!;
    p[j] = t;
  }
  const perm = new Uint8Array(512);
  const g = new Uint8Array(512); // perm % 12 × 3, pre-multiplied into GRAD offsets
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255]!;
    g[i] = (perm[i]! % 12) * 3;
  }

  // Contribution of one simplex corner: (0.6 − r²)⁴ · (grad · offset).
  const corner = (gi: number, x: number, y: number, z: number): number => {
    let t = 0.6 - x * x - y * y - z * z;
    if (t < 0) return 0;
    t *= t;
    return t * t * (GRAD[gi]! * x + GRAD[gi + 1]! * y + GRAD[gi + 2]! * z);
  };

  return (x, y, z) => {
    // Skew into simplex space to find the containing cell.
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const x0 = x - i + t;
    const y0 = y - j + t;
    const z0 = z - k + t;

    // Which of the six tetrahedra are we in? Offsets of the 2nd and 3rd corners.
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }

    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;
    const n =
      corner(g[ii + perm[jj + perm[kk]!]!]!, x0, y0, z0) +
      corner(g[ii + i1 + perm[jj + j1 + perm[kk + k1]!]!]!, x0 - i1 + G3, y0 - j1 + G3, z0 - k1 + G3) +
      corner(g[ii + i2 + perm[jj + j2 + perm[kk + k2]!]!]!, x0 - i2 + 2 * G3, y0 - j2 + 2 * G3, z0 - k2 + 2 * G3) +
      corner(g[ii + 1 + perm[jj + 1 + perm[kk + 1]!]!]!, x0 - 1 + 3 * G3, y0 - 1 + 3 * G3, z0 - 1 + 3 * G3);
    return 32 * n;
  };
}
