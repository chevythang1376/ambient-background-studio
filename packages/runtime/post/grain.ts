/**
 * Film grain: a post layer that sits on top of any type, Canvas 2D included.
 *
 * Cheap by construction: one 128 px noise tile is generated once per page and
 * tiled by CSS on an overlay with `mix-blend-mode: overlay`. Animating it only
 * changes a transform (compositor-only, no repaint), and only while the
 * background is animating; a still or poster background gets static grain.
 */
const TILE = 128;
let tileUrl = '';

function tile(): string {
  if (tileUrl) return tileUrl;
  const c = document.createElement('canvas');
  c.width = c.height = TILE;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(TILE, TILE);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = d[i + 1] = d[i + 2] = Math.random() * 256;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return (tileUrl = c.toDataURL());
}

export interface Grain {
  set(amount: number): void;
  /** Shift the tile to a new random offset (call at ~12 fps while animating). */
  jitter(): void;
  destroy(): void;
}

export function createGrain(parent: HTMLElement, amount: number): Grain {
  const el = document.createElement('div');
  el.className = 'abs-bg__grain';
  el.setAttribute('aria-hidden', 'true');
  const url = tile();
  if (url) el.style.backgroundImage = `url(${url})`;
  parent.append(el);

  const grain: Grain = {
    set(a) {
      el.hidden = a <= 0 || !url;
      el.style.opacity = String(Math.min(1, a) * 0.45);
    },
    jitter() {
      // The overlay overhangs by one tile on every side, so ±half a tile never shows an edge.
      const r = () => Math.round((Math.random() - 0.5) * TILE);
      el.style.transform = `translate3d(${r()}px,${r()}px,0)`;
    },
    destroy() {
      el.remove();
    },
  };
  grain.set(amount);
  return grain;
}
