// Shared by scripts/posters.mjs and the preset tests: where preset posters
// live, their size, and the config hash that marks a poster as up to date.
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const POSTER_DIR = fileURLToPath(new URL('../apps/studio/public/posters/', import.meta.url));
export const PRESET_DIR = fileURLToPath(new URL('../presets/', import.meta.url));
/**
 * Poster size per type. Flow fields carry fine trails that compress poorly, and
 * the canvas renders at half size anyway, so they get a smaller poster.
 */
export function posterSize(type) {
  return type === 'flow-field' ? [960, 540] : [1280, 720];
}
export const POSTER_QUALITY = 0.8;

/** Order-independent hash of a config: a poster is stale when this changes. */
export function configHash(config) {
  const canonical = JSON.stringify(Object.keys(config).sort().map((k) => [k, config[k]]));
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}
