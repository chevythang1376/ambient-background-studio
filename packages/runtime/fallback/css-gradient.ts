/**
 * CSS gradient approximation: layered radial-gradients built from the palette.
 * Used when WebGL is missing, as the colour shown before the poster loads, and
 * on the no-JS path (the export writes it inline). Deterministic per seed.
 */
import type { Config } from '../types';
import { mulberry32 } from '../lib/noise';

const pct = (v: number) => Math.round(v * 100) + '%';

export function cssGradient(cfg: Pick<Config, 'type' | 'colors' | 'seed'>): string {
  const rand = mulberry32(cfg.seed * 7919 + 17);
  const { colors } = cfg;
  const first = colors[0] ?? '#000000';
  const lastColor = colors[colors.length - 1] ?? first;
  const mid = colors[colors.length >> 1] ?? first;
  // A soft elliptical blob: solid at the centre, fully transparent by 70%.
  const blob = (c: string, alpha: string, size: number) =>
    `radial-gradient(${pct(size + rand() * 0.35)} ${pct(size + 0.1 + rand() * 0.35)} at ${pct(rand())} ${pct(rand())},${c}${alpha} 0%,${c}00 70%)`;

  if (cfg.type === 'shader-gradient') {
    // The shader spends most of its area in the middle stops, so they get the
    // biggest blobs; the ends form a diagonal base underneath.
    const layers = colors.slice(1, -1).map((c) => blob(c, '', 0.55));
    layers.push(blob(lastColor, '', 0.35));
    layers.push(`linear-gradient(${Math.round(rand() * 360)}deg,${first},${mid})`);
    return layers.join(',') + ',' + mid;
  }

  // Canvas 2D types: background colour with faint glows of the ink colours,
  // which is how thin lines read from a distance.
  const layers = colors.slice(1).map((c) => blob(c, '38', 0.5));
  return layers.join(',') + ',' + first;
}
