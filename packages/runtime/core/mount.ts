/**
 * Mounts a background onto a `.abs-bg` element and applies every budget and
 * safety rule:
 *
 * - Decision flow on load and whenever inputs change (see detect.ts): reduced
 *   motion → poster or near-still; no WebGL → CSS gradient; else animate, capped.
 * - Pauses (zero rAF) while off-screen (IntersectionObserver) or the tab is
 *   hidden (visibilitychange); resumes with no time jump.
 * - Canvas fades in only after its first frame; the poster stays underneath.
 * - WebGL context loss → poster, never a throw; restores itself if the browser
 *   gives the context back.
 *
 * Renderers are passed in (not imported) so each entry point bundles only the
 * types it ships.
 */
import type { Budget, Config, Renderer, RendererDef } from '../types';
import { resolveConfig } from './config';
import { backingSize, computeBudget, STILL_FPS } from './budget';
import { createScheduler } from './scheduler';
import { decide, onChange, reducedMotionQuery, type Outcome } from './detect';
import { createPointer } from './pointer';
import { ensureStyles } from './styles';
import { cssGradient } from '../fallback/css-gradient';
import { guardPoster } from '../fallback/poster';
import { createGrain, type Grain } from '../post/grain';

/** Studio-only overrides that force a branch of the decision flow. */
export interface Simulate {
  reducedMotion?: boolean;
  noWebGL?: boolean;
  offscreen?: boolean;
}

export type State = Outcome | 'paused';

export interface MountOptions {
  renderers: readonly RendererDef[];
  /** Overrides on top of the element's `data-abs` config. */
  config?: Partial<Config>;
  simulate?: Simulate;
  /** Called after each rendered frame with the CPU time it took. */
  onFrame?: (cpuMs: number) => void;
  onState?: (state: State) => void;
}

export interface Mounted {
  readonly el: HTMLElement;
  readonly state: State;
  readonly config: Config;
  /** Backing-store size, [0, 0] when nothing is rendering. */
  readonly size: readonly [number, number];
  readonly particles: number;
  setConfig(partial: Partial<Config>): void;
  simulate(s: Simulate): void;
  destroy(): void;
}

const GRAIN_MS = 83; // grain flicker ≈ 12 fps, like film
const RESIZE_MS = 100; // debounce: re-layout once the resize settles

function parse(json: string | null): object {
  try {
    const v: unknown = json ? JSON.parse(json) : null;
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export function mount(el: HTMLElement, opts: MountOptions): Mounted | null {
  if (el.hasAttribute('data-abs-on')) return null;
  let cfg = resolveConfig({ ...parse(el.getAttribute('data-abs')), ...opts.config });
  let def = opts.renderers.find((d) => d.type === cfg.type);
  if (!def) return null; // another entry point on the page may own this type
  el.setAttribute('data-abs-on', '');

  ensureStyles();
  el.classList.add('abs-bg');
  el.style.background = cssGradient(cfg);
  guardPoster(el);

  const watch = (c: HTMLCanvasElement) => {
    c.addEventListener('webglcontextlost', onLost);
    c.addEventListener('webglcontextrestored', onRestored);
    return c;
  };
  const makeCanvas = () => {
    const c = document.createElement('canvas');
    c.className = 'abs-bg__canvas';
    c.setAttribute('aria-hidden', 'true');
    return watch(c);
  };
  let canvas = el.querySelector<HTMLCanvasElement>('canvas.abs-bg__canvas');
  canvas = canvas ? watch(canvas) : el.appendChild(makeCanvas());
  let canvasUsed = false;

  const mq = reducedMotionQuery();
  const pointer = createPointer();
  let sim: Simulate = { ...opts.simulate };
  let renderer: Renderer | null = null;
  let budget: Budget = computeBudget(cfg, devicePixelRatio, false);
  let outcome: Outcome = 'poster';
  let state: State = 'poster';
  let webgl = true; // flips to false once a WebGL context can't be created
  let broken = false; // context lost, or Canvas 2D failed
  let inView = false;
  let live = false;
  let size: [number, number] = [0, 0];
  let clock = 0;
  let lastGrain = 0;
  let resizeTimer = 0;
  let grain: Grain | null = null;
  const sched = createScheduler(tick, budget.fps);

  function tick(time: number, dt: number) {
    if (!renderer || !size[0]) return;
    const t0 = performance.now();
    clock = time;
    pointer.update(el.getBoundingClientRect(), dt / 1000);
    renderer.frame(time, pointer.input);
    if (grain && outcome === 'animate' && time - lastGrain >= GRAIN_MS) {
      grain.jitter();
      lastGrain = time;
    }
    if (!live) {
      live = true;
      el.classList.add('abs-bg--live'); // canvas fades in over the poster
    }
    opts.onFrame?.(performance.now() - t0);
  }

  function onLost(e: Event) {
    e.preventDefault(); // tells the browser we want the context back
    // Our own teardown releases contexts too (renderer.destroy → loseContext),
    // and that event arrives later: only a loss under a running renderer counts.
    if (e.target !== canvas || !renderer) return;
    broken = true;
    evaluate();
  }

  function onRestored(e: Event) {
    if (e.target !== canvas || !broken) return;
    broken = false;
    evaluate();
  }

  function teardown() {
    sched.stop();
    renderer?.destroy();
    renderer = null;
    live = false;
    el.classList.remove('abs-bg--live');
  }

  /** Create and size a renderer. Returns false (and records why) if it can't run. */
  function start(still: boolean): boolean {
    teardown();
    // A used canvas may hold a lost or released context: always start fresh.
    if (canvasUsed) {
      const c = makeCanvas();
      canvas!.removeEventListener('webglcontextlost', onLost);
      canvas!.removeEventListener('webglcontextrestored', onRestored);
      canvas!.replaceWith(c);
      canvas = c;
    }
    canvasUsed = true;
    budget = computeBudget(cfg, devicePixelRatio, still);
    sched.setFps(budget.fps);
    const r = def!.create();
    try {
      r.init(canvas!, cfg, budget);
    } catch {
      r.destroy();
      if (def!.webgl) webgl = false;
      else broken = true;
      return false;
    }
    renderer = r;
    size = [0, 0];
    resize();
    return true;
  }

  function evaluate() {
    const reduced = sim.reducedMotion ?? mq?.matches ?? false;
    const next = decide({
      reducedMotion: reduced,
      mode: cfg.reducedMotion,
      needsWebGL: def!.webgl,
      webgl: webgl && !sim.noWebGL,
      broken,
    });
    if (next === 'animate' || next === 'still') {
      const still = next === 'still';
      if ((!renderer || budget.still !== still) && !start(still)) return evaluate();
    } else {
      teardown();
    }
    outcome = next;
    el.classList.toggle('abs-bg--css', next === 'css');
    update();
  }

  /** Run only while there is a renderer, it's on screen and the tab is visible. */
  function update() {
    const run = !!renderer && inView && !document.hidden && !sim.offscreen;
    if (run) sched.start();
    else sched.stop();
    const s: State = renderer && !run ? 'paused' : outcome;
    if (s !== state) {
      state = s;
      opts.onState?.(s);
    }
  }

  function resize() {
    if (!renderer) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    if (!cw || !ch) return;
    budget.dpr = Math.min(devicePixelRatio || 1, cfg.dprCap);
    const [w, h, res] = backingSize(cw, ch, cfg.resolution, budget.dpr);
    if (w === size[0] && h === size[1] && res === budget.resolution) return;
    budget.resolution = res;
    canvas!.width = w;
    canvas!.height = h;
    size = [w, h];
    renderer.resize(w, h);
    // Resizing clears the canvas. If we're paused, repaint once (no motion) so
    // it isn't blank when it comes back into view.
    if (live && !sched.running) renderer.frame(clock, pointer.input);
  }

  function syncGrain() {
    if (cfg.grain > 0 && !grain) grain = createGrain(el, cfg.grain);
    grain?.set(cfg.grain);
  }

  const ro = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(resize, size[0] ? RESIZE_MS : 0);
  });
  const io = new IntersectionObserver((entries) => {
    inView = entries[entries.length - 1]!.isIntersecting;
    update();
  });
  const offMotion = mq ? onChange(mq, evaluate) : () => {};
  document.addEventListener('visibilitychange', update);
  ro.observe(el);
  io.observe(el);
  evaluate();
  syncGrain();

  return {
    el,
    get state() {
      return state;
    },
    get config() {
      return cfg;
    },
    get size() {
      return renderer ? size : ([0, 0] as const);
    },
    get particles() {
      return renderer?.particles?.() ?? 0;
    },

    setConfig(partial) {
      const prev = cfg;
      cfg = resolveConfig({ ...cfg, ...partial });
      el.style.background = cssGradient(cfg);
      syncGrain();
      if (cfg.type !== prev.type) {
        const next = opts.renderers.find((d) => d.type === cfg.type);
        if (next) {
          def = next;
          webgl = true;
          broken = false;
          teardown();
          evaluate();
          return;
        }
        cfg.type = prev.type;
      }
      if (cfg.reducedMotion !== prev.reducedMotion) evaluate();
      if (!renderer) return;
      const changed: Record<string, unknown> = {};
      for (const k of Object.keys(partial) as (keyof Config)[]) changed[k] = cfg[k];
      renderer.setConfig(changed as Partial<Config>);
      if (cfg.fps !== prev.fps) {
        budget.fps = budget.still ? Math.min(cfg.fps, STILL_FPS) : cfg.fps;
        sched.setFps(budget.fps);
      }
      if (cfg.resolution !== prev.resolution || cfg.dprCap !== prev.dprCap) resize();
    },

    simulate(s) {
      sim = { ...sim, ...s };
      evaluate();
    },

    destroy() {
      teardown();
      clearTimeout(resizeTimer);
      ro.disconnect();
      io.disconnect();
      offMotion();
      document.removeEventListener('visibilitychange', update);
      grain?.destroy();
      el.classList.remove('abs-bg--live', 'abs-bg--css');
      el.removeAttribute('data-abs-on');
    },
  };
}

/** Mount every `[data-abs]` element whose type is in `renderers` (snippet entry point). */
export function autoMount(renderers: readonly RendererDef[]): void {
  const run = () => document.querySelectorAll<HTMLElement>('[data-abs]').forEach((el) => mount(el, { renderers }));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
}
