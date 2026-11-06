/**
 * Preset gallery: a grid of live thumbnails that follows the budget rules.
 *
 * - Every card starts as a poster: a still frame rendered once, at exactly the
 *   size and budget the live thumbnail would use, when the card first nears
 *   the viewport.
 * - A card animates only while it's on screen or hovered/focused, and at most
 *   MAX_LIVE at once (hovered and focused first). A live card is a real
 *   `mount()` of the snippet runtime; when it stops, it's destroyed (renderer,
 *   WebGL context, listeners), and the poster is what remains.
 * - With reduced motion (the visitor's own setting, or the studio's
 *   simulation) nothing animates: posters only.
 * - While the gallery tab is hidden, nothing is mounted at all.
 */
import type { RendererDef } from '@abs/runtime/types';
import { backingSize } from '@abs/runtime/core/budget';
import { mount, type Mounted } from '@abs/runtime/core/mount';
import { cssGradient } from '@abs/runtime/fallback/css-gradient';
import { MOODS, type Preset } from '../lib/presets';
import { encodeCanvas, renderStill } from '../poster';
import { TYPE_NAMES } from '../renderers';
import { h, uidFor } from './controls';

/** Most thumbnails animating at once (each WebGL one holds a context). */
export const MAX_LIVE = 8;

interface Card {
  preset: Preset;
  li: HTMLLIElement;
  button: HTMLButtonElement;
  thumb: HTMLElement;
  img: HTMLImageElement;
  visible: boolean;
  hot: boolean;
  poster: 'none' | 'queued' | 'done';
  m: Mounted | null;
}

export interface GalleryDeps {
  presets: readonly Preset[];
  renderers: readonly RendererDef[];
  /** Reduced motion in effect (system setting or the studio's simulation). */
  reduced(): boolean;
  current(): string | null;
  onPick(p: Preset): void;
}

export interface Gallery {
  setShown(shown: boolean): void;
  /** Re-apply the live policy (reduced motion changed, current preset changed). */
  refresh(): void;
  /** Ids of the cards animating right now (for checks). */
  live(): string[];
}

const makeCanvas = () => h('canvas', { class: 'abs-bg__canvas', 'aria-hidden': 'true' });

export function createGallery(root: HTMLElement, deps: GalleryDeps): Gallery {
  const cards: Card[] = [];
  let shown = false;

  for (const mood of MOODS) {
    const list = deps.presets.filter((p) => p.mood === mood.id);
    if (!list.length) continue;
    const headId = uidFor('mood');
    const grid = h('ul', { class: 'gallery__grid', 'aria-labelledby': headId });
    for (const p of list) {
      const thumb = h('span', { class: 'abs-bg' }, makeCanvas());
      thumb.style.background = cssGradient(p.config); // shown until the poster is ready, as in a snippet
      const img = h('img', { class: 'abs-bg__poster', alt: '', decoding: 'async' });
      const descId = uidFor('desc');
      const button = h(
        'button',
        { type: 'button', class: 'card', 'aria-describedby': descId },
        h('span', { class: 'card__thumb' }, thumb, h('span', { class: 'card__sample', style: `color:${p.text}`, 'aria-hidden': 'true' }, 'Aa')),
        h(
          'span',
          { class: 'card__text' },
          h('span', { class: 'card__name' }, p.name),
          h('span', { class: 'card__meta' }, `${TYPE_NAMES[p.config.type]} · ${p.text === '#ffffff' ? 'white' : 'dark'} text`),
          h('span', { class: 'card__desc', id: descId }, p.description),
        ),
      );
      const li = h('li', null, button);
      const card: Card = { preset: p, li, button, thumb, img, visible: false, hot: false, poster: 'none', m: null };
      button.addEventListener('click', () => deps.onPick(p));
      const hot = (v: boolean) => () => {
        card.hot = v;
        schedule();
      };
      button.addEventListener('pointerenter', hot(true));
      button.addEventListener('pointerleave', hot(false));
      button.addEventListener('focus', hot(true));
      button.addEventListener('blur', hot(false));
      cards.push(card);
      grid.append(li);
    }
    root.append(
      h(
        'section',
        { class: 'gallery__mood' },
        h('div', { class: 'gallery__head' }, h('h3', { id: headId }, mood.label), h('p', null, mood.blurb)),
        grid,
      ),
    );
  }

  // ── Posters: rendered one at a time, as cards near the viewport ───────────
  const queue: Card[] = [];
  let working = false;
  const scratch = document.createElement('canvas');

  function size(card: Card) {
    const cfg = card.preset.config;
    const dpr = Math.min(devicePixelRatio || 1, cfg.dprCap);
    return backingSize(card.thumb.clientWidth, card.thumb.clientHeight, cfg.resolution, dpr).concat(dpr) as [number, number, number, number];
  }

  async function drain() {
    if (working) return;
    working = true;
    while (queue.length) {
      const card = queue.shift()!;
      const [w, hgt, res, dpr] = size(card);
      if (!w || !hgt) {
        card.poster = 'none';
        continue;
      }
      const def = deps.renderers.find((d) => d.type === card.preset.config.type)!;
      const blob = renderStill(def, card.preset.config, w, hgt, { resolution: res, dpr }, scratch) ? await encodeCanvas(scratch, 'image/webp', 0.85) : null;
      card.poster = 'done';
      if (blob) {
        card.img.src = URL.createObjectURL(blob);
        card.thumb.prepend(card.img); // under the canvas, as in a snippet
      }
      await new Promise((r) => setTimeout(r, 0)); // let input and paint through between renders
    }
    working = false;
  }

  function wantPoster(card: Card) {
    if (card.poster !== 'none') return;
    card.poster = 'queued';
    queue.push(card);
    void drain();
  }

  // ── Live policy ───────────────────────────────────────────────────────────
  function schedule() {
    const allow = shown && !deps.reduced();
    const want = new Set(
      allow
        ? cards
            .filter((c) => c.visible || c.hot)
            .sort((a, b) => Number(b.hot) - Number(a.hot))
            .slice(0, MAX_LIVE)
        : [],
    );
    const current = deps.current();
    for (const c of cards) {
      if (c.preset.id === current) c.button.setAttribute('aria-current', 'true');
      else c.button.removeAttribute('aria-current');
      if (want.has(c) && !c.m) {
        c.m = mount(c.thumb, { renderers: deps.renderers, config: c.preset.config, simulate: { reducedMotion: false } });
      } else if (!want.has(c) && c.m) {
        c.m.destroy();
        c.m = null;
        // A destroyed WebGL context can't be reused: the next mount gets a fresh canvas.
        c.thumb.querySelector('canvas')?.replaceWith(makeCanvas());
      }
    }
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const card = cards.find((c) => c.li === e.target);
        if (!card) continue;
        card.visible = e.isIntersecting;
        if (e.isIntersecting) wantPoster(card);
      }
      schedule();
    },
    { rootMargin: '0px' },
  );
  // Posters render a little ahead of the viewport, so cards scroll in finished.
  const ahead = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const card = cards.find((c) => c.li === e.target);
        if (card && e.isIntersecting) wantPoster(card);
      }
    },
    { rootMargin: '50% 0px' },
  );
  for (const c of cards) {
    io.observe(c.li);
    ahead.observe(c.li);
  }

  return {
    setShown(v) {
      shown = v;
      schedule();
    },
    refresh: schedule,
    live: () => cards.filter((c) => c.m).map((c) => c.preset.id),
  };
}
