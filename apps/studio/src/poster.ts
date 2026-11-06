/**
 * Poster frames: for the studio preview, and at export size for the snippet.
 *
 * The poster is what visitors see before the canvas fades in, with reduced
 * motion, or after a lost WebGL context, and it's the image the contrast check
 * measures.
 *
 * Preview poster: while the preview animates, the studio copies the live
 * canvas inside the frame callback (same task as the draw, so a WebGL canvas
 * still holds its drawing buffer without `preserveDrawingBuffer`). Otherwise it
 * renders a frame offscreen, with no pointer influence.
 *
 * Export poster (`capturePoster`):
 * - Shader gradient: its frame depends only on settings and the integrated
 *   phase, so the live renderer redraws the current frame at the export size,
 *   with no cursor effect, and is restored in the same task (nothing flashes).
 * - Flow field and particle mesh: their frames hold simulation history that
 *   can't be redrawn at another size, so the poster is a freshly settled frame
 *   with the same settings and seed, rendered at the export size.
 * - No live renderer (reduced motion, fallback, paused before the first frame):
 *   a fresh frame, as above.
 */
import type { Budget, Config, FrameInput, Renderer, RendererDef } from '@abs/runtime/types';
import { MAX_PARTICLES } from '@abs/runtime/core/budget';

const NO_INPUT: FrameInput = { pointer: null, presence: 0, scroll: 0 };
// Canvas 2D types simulate, so give them about a second for trails and links to settle.
const SETTLE_FRAMES = 30;
/**
 * Export posters stand in for a hero this many CSS px wide, so line widths and
 * particle counts look the same at every poster size; only sharpness changes.
 */
export const POSTER_CSS_WIDTH = 1600;

/** Copy `src` into `out`, resizing `out` to match. */
export function copyCanvas(src: HTMLCanvasElement, out: HTMLCanvasElement): void {
  if (out.width !== src.width || out.height !== src.height) {
    out.width = src.width;
    out.height = src.height;
  }
  out.getContext('2d')!.drawImage(src, 0, 0);
}

/**
 * Render `cfg` offscreen at `w`×`h` backing pixels into `out`.
 * Returns false when the renderer can't run (no WebGL, say).
 */
export function renderStill(
  def: RendererDef,
  cfg: Config,
  w: number,
  h: number,
  scale: Pick<Budget, 'resolution' | 'dpr'>,
  out: HTMLCanvasElement,
): boolean {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const r = def.create();
  try {
    r.init(canvas, cfg, { ...scale, fps: 30, maxParticles: MAX_PARTICLES, still: false });
  } catch {
    r.destroy();
    return false;
  }
  r.resize(w, h);
  const frames = def.webgl ? 2 : SETTLE_FRAMES;
  for (let i = 0; i < frames; i++) r.frame(i * 33, NO_INPUT);
  copyCanvas(canvas, out);
  r.destroy();
  return true;
}

// ── Live renderer tracking ──────────────────────────────────────────────────

interface Slot {
  renderer: Renderer;
  canvas: HTMLCanvasElement;
  webgl: boolean;
  /** Scheduler time of the last frame. */
  time: number;
  /** The mount's (reused) input object from the last frame. */
  input: FrameInput;
}

/** The renderer the preview is running right now, with its last frame's inputs. */
export type LiveRenderer = Readonly<Slot>;

/**
 * Wrap renderer defs so the studio can reach the live instance. The wrapper
 * only forwards calls, so the preview runs exactly the code a snippet runs.
 */
export function trackRenderers(defs: readonly RendererDef[]): { defs: RendererDef[]; readonly live: LiveRenderer | null } {
  let live: Slot | null = null;
  const wrap = (def: RendererDef): RendererDef => ({
    ...def,
    create() {
      const r = def.create();
      let me: Slot | null = null;
      const tracked: Renderer = {
        init(canvas, cfg, budget) {
          r.init(canvas, cfg, budget);
          me = live = { renderer: tracked, canvas, webgl: def.webgl, time: 0, input: NO_INPUT };
        },
        frame(time, input) {
          if (me) {
            me.time = time;
            me.input = input;
          }
          r.frame(time, input);
        },
        resize: (w, h) => r.resize(w, h),
        setConfig: (p) => r.setConfig(p),
        destroy() {
          if (live === me) live = null;
          me = null;
          r.destroy();
        },
        particles: r.particles && (() => r.particles!()),
      };
      return tracked;
    },
  });
  const wrapped = defs.map(wrap);
  return {
    defs: wrapped,
    get live() {
      return live;
    },
  };
}

// ── Export capture ──────────────────────────────────────────────────────────

/** `frame`: the frame on screen, redrawn at export size. `render`: a fresh, settled frame. */
export type PosterSource = 'frame' | 'render';

export function capturePoster(
  def: RendererDef,
  cfg: Config,
  w: number,
  h: number,
  live: LiveRenderer | null,
  out: HTMLCanvasElement,
): PosterSource | null {
  if (live && live.webgl && live.canvas.width) {
    const { renderer, canvas, time, input } = live;
    const pw = canvas.width;
    const ph = canvas.height;
    try {
      canvas.width = w;
      canvas.height = h;
      renderer.resize(w, h);
      renderer.frame(time, NO_INPUT); // same time: zero step, the phase doesn't move
      copyCanvas(canvas, out);
    } finally {
      // Restore and redraw before the task ends, so the page never shows a cleared canvas.
      canvas.width = pw;
      canvas.height = ph;
      renderer.resize(pw, ph);
      renderer.frame(time, input);
    }
    return 'frame';
  }
  const px = w / POSTER_CSS_WIDTH;
  return renderStill(def, cfg, w, h, { resolution: px, dpr: 1 }, out) ? 'render' : null;
}

/** Encode a canvas. Resolves null if the browser can't encode that type. */
export function encodeCanvas(canvas: HTMLCanvasElement, type: 'image/webp' | 'image/png', quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b && b.type === type ? b : null), type, quality));
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
