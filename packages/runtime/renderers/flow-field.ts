/**
 * Flow field: thousands of thin lines following a noise field, like wind or hair.
 * Canvas 2D. Particle state lives in Float32Arrays, every frame is one fade fill
 * plus one stroked path, and nothing is allocated per frame.
 */
import type { Budget, Config, FrameInput, Renderer, RendererDef } from '../types';
import { applyCalm, type Motion } from '../core/calm';
import { createNoise3, type Noise3 } from '../lib/noise';

/**
 * CSS px² per particle at density 1 (before the budget cap). Counted in CSS
 * pixels so lowering render resolution saves GPU/CPU without thinning the look.
 */
const CSS_AREA_PER_PARTICLE = 420;
/** Base direction of the "wind", radians (slightly rising to the right). */
const BASE_ANGLE = -0.3;
/** Simulated warm-up so the first visible frame already has trails. */
const WARM_STEPS = 20;
const NO_INPUT: FrameInput = { pointer: null, presence: 0, scroll: 0 };

export function createFlowField(): Renderer {
  let ctx: CanvasRenderingContext2D | null = null;
  let cfg: Config;
  let budget: Budget;
  let noise: Noise3;
  const motion: Motion = { speed: 0, turbulence: 0, pointer: 0, velocity: 0 };
  let w = 0;
  let h = 0;
  let xs = new Float32Array(0);
  let ys = new Float32Array(0);
  let life = new Float32Array(0);
  let count = 0;
  let phase = 0;
  let last = -1;
  let bg = '#000';
  let ink: string | CanvasGradient = '#fff';
  let lineWidth = 1;
  let seededFor = -1;

  const spawn = (i: number) => {
    xs[i] = Math.random() * w;
    ys[i] = Math.random() * h;
    life[i] = 1.5 + Math.random() * 4.5; // seconds
  };

  /** Recompute particle count and buffers; respawn everyone. */
  function layout() {
    const px = budget.dpr * budget.resolution; // backing px per CSS px
    const cap = Math.min(budget.maxParticles, (w * h) / (px * px * CSS_AREA_PER_PARTICLE));
    count = Math.max(0, Math.round(cap * (0.15 + 0.85 * cfg.density)));
    if (xs.length < count) {
      xs = new Float32Array(count);
      ys = new Float32Array(count);
      life = new Float32Array(count);
    }
    for (let i = 0; i < count; i++) spawn(i);
  }

  /** Styles that only change with config or size. */
  function paintStyles() {
    if (!ctx) return;
    const [first, ...rest] = cfg.colors;
    bg = first ?? '#000';
    if (rest.length < 2) {
      ink = rest[0] ?? '#fff';
    } else {
      // Ink colour varies across the canvas through one gradient, so all lines
      // still go out in a single stroke() call.
      const g = ctx.createLinearGradient(0, h, w, 0);
      rest.forEach((c, i) => g.addColorStop(i / (rest.length - 1), c));
      ink = g;
    }
    // ~1.4 CSS px lines regardless of reduced resolution.
    lineWidth = Math.min(2, Math.max(0.6, 1.4 * budget.dpr * budget.resolution));
  }

  function applyConfig() {
    applyCalm(cfg, budget.still, motion);
    if (cfg.seed !== seededFor) {
      noise = createNoise3(cfg.seed);
      seededFor = cfg.seed;
    }
    paintStyles();
  }

  function step(dt: number, input: FrameInput) {
    const c = ctx!;
    phase += dt * motion.speed;

    // Fade toward the background: this is what draws the trails. The fade is
    // per-second (frame-rate independent) and slows with velocity, so trail
    // length in pixels stays the same at any speed and calm 0 is truly still.
    const perFrame = 0.12 - 0.09 * cfg.trail; // fade alpha at 30 fps, 1x velocity
    c.globalAlpha = 1 - Math.pow(1 - perFrame, dt * 30 * Math.min(1, motion.velocity * 1.5 + 0.02));
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);

    const unit = Math.min(w, h);
    const freq = 1.6 / (unit * cfg.scale);
    const z = phase * 0.12;
    const spread = Math.PI * (0.35 + 1.4 * motion.turbulence);
    const dist = unit * 0.12 * motion.velocity * dt; // px this frame

    let mx = 0;
    let my = 0;
    let pull = 0;
    const mode = cfg.pointer;
    if (input.pointer && mode !== 'off') {
      mx = input.pointer[0] * w;
      my = input.pointer[1] * h;
      pull = input.presence * motion.pointer * 1.6;
    }
    const r2 = (unit * 0.2) ** 2;

    c.globalAlpha = 0.8;
    c.strokeStyle = ink;
    c.lineWidth = lineWidth;
    c.beginPath();
    for (let i = 0; i < count; i++) {
      const x = xs[i];
      const y = ys[i];
      const a = BASE_ANGLE + noise(x * freq, y * freq, z) * spread;
      let vx = Math.cos(a);
      let vy = Math.sin(a);
      if (pull > 0) {
        // Gaussian falloff around the pointer, normalised direction.
        const dx = mx - x;
        const dy = my - y;
        const d2 = dx * dx + dy * dy + 1;
        const f = (pull * Math.exp(-d2 / r2)) / Math.sqrt(d2);
        if (mode === 'attract') { vx += dx * f; vy += dy * f; }
        else if (mode === 'repel') { vx -= dx * f; vy -= dy * f; }
        else { vx -= dy * f; vy += dx * f; } // 'light' → gentle swirl
      }
      const nx = x + vx * dist;
      const ny = y + vy * dist;
      life[i] -= dt;
      if (life[i] <= 0 || nx < 0 || nx > w || ny < 0 || ny > h) {
        spawn(i);
        continue;
      }
      c.moveTo(x, y);
      c.lineTo(nx, ny);
      xs[i] = nx;
      ys[i] = ny;
    }
    c.stroke();
  }

  return {
    init(canvas, config, b) {
      cfg = config;
      budget = b;
      ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('abs: Canvas 2D unavailable');
      applyConfig();
    },

    frame(time, input) {
      if (!ctx || !w) return;
      const dt = last < 0 ? 0 : Math.min(time - last, 100) / 1000;
      last = time;
      if (dt > 0) step(dt, input);
    },

    resize(nw, nh) {
      if (!ctx) return;
      w = nw;
      h = nh;
      layout();
      paintStyles();
      // Resizing clears the canvas: repaint and warm up so trails exist at once.
      ctx.globalAlpha = 1;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < WARM_STEPS; i++) step(1 / 15, NO_INPUT);
    },

    setConfig(partial) {
      const prevDensity = cfg.density;
      cfg = { ...cfg, ...partial };
      applyConfig();
      if (cfg.density !== prevDensity && w) layout();
    },

    destroy() {
      ctx = null;
      count = 0;
    },

    particles: () => count,
  };
}

export const flowField: RendererDef = { type: 'flow-field', webgl: false, create: createFlowField };
