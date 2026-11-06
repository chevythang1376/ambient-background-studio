/**
 * Renders a preset's poster frame as base64 WebP. Run in the browser by
 * `scripts/posters.mjs` (through the dev server), which writes the files the
 * showcase serves, exactly as a site would host an exported poster.
 */
import type { Config } from '@abs/runtime/types';
import { RENDERERS } from './renderers';
import { blobToDataUrl, encodeCanvas, POSTER_CSS_WIDTH, renderStill } from './poster';

export async function presetPoster(config: Config, w: number, h: number, quality: number): Promise<string | null> {
  const def = RENDERERS.find((d) => d.type === config.type);
  const canvas = document.createElement('canvas');
  if (!def || !renderStill(def, config, w, h, { resolution: w / POSTER_CSS_WIDTH, dpr: 1 }, canvas)) return null;
  const blob = await encodeCanvas(canvas, 'image/webp', quality);
  return blob ? (await blobToDataUrl(blob)).split(',')[1]! : null;
}
