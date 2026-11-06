/**
 * Particle mesh: dots that connect into a slowly drifting network.
 * Canvas 2D. Neighbour lookups use a uniform grid with cell size = link
 * distance (counting sort into typed arrays), so links cost O(n · k), not O(n²).
 * Everything lives in preallocated typed arrays; nothing is allocated per frame.
 *
 * Draw: one pass over the data per frame. Links are bucketed by distance into
 * BUCKETS alpha levels (one stroke each) so they fade in and out instead of
 * popping; dots go out in one fill.
 */
import type { Budget, Config, FrameInput, Renderer, RendererDef } from '../types';
import { applyCalm, type Motion } from '../core/calm';
import { createNoise3, mulberry32, type Noise3 } from '../lib/noise';

/** CSS px² per node at density 1, scale 1. */
const CSS_AREA_PER_NODE = 5200;
/** Link distance at scale 1, CSS px. */
const LINK_CSS = 115;
/** Dot radius, CSS px. */
const DOT_CSS = 1.4;
const BUCKETS = 4;
/** Half-neighbourhood cell offsets: each adjacent cell pair is visited once. */
const OFFSETS = new Int8Array([0, 0, 1, -1, 1, 0, 1, 1, 0, 1]);
const TAU = Math.PI * 2;

export function createParticleMesh(): Renderer {
  let ctx: CanvasRenderingContext2D | null = null;
  let cfg: Config;
  let budget: Budget;
  let noise: Noise3;
  let seededFor = -1;
  const motion: Motion = { speed: 0, turbulence: 0, pointer: 0, velocity: 0 };
  let w = 0;
  let h = 0;
  let n = 0;
  // Simulated positions, base drift velocities, and per-frame render positions
  // (simulated + cursor lens offset, which never accumulates into the sim).
  let xs = new Float32Array(0);
  let ys = new Float32Array(0);
  let vxs = new Float32Array(0);
  let vys = new Float32Array(0);
  let rx = new Float32Array(0);
  let ry = new Float32Array(0);
  // Grid.
  let link = 1;
  let margin = 1;
  let cols = 1;
  let rows = 1;
  let cellOf = new Int32Array(0);
  let items = new Int32Array(0);
  let cellStart = new Int32Array(1);
  let cursor = new Int32Array(0);
  // Link segments (x0, y0, x1, y1) and their alpha bucket.
  let segs = new Float32Array(0);
  let bucket = new Uint8Array(0);
  let maxSegs = 0;
  let phase = 0;
  let last = -1;
  let bg = '#000';
  let ink: string | CanvasGradient = '#fff';
  let lineWidth = 1;
  let dot = 1;

  function layout() {
    const px = budget.dpr * budget.resolution; // backing px per CSS px
    link = LINK_CSS * px * cfg.scale;
    margin = link; // nodes wrap around off-screen, so links never pop at the edges
    const W = w + 2 * margin;
    const H = h + 2 * margin;
    const area = (W * H) / (px * px);
    n = Math.min(
      budget.maxParticles,
      Math.round((area / (CSS_AREA_PER_NODE * cfg.scale * cfg.scale)) * (0.3 + 0.7 * cfg.density)),
    );
    cols = Math.max(1, Math.ceil(W / link));
    rows = Math.max(1, Math.ceil(H / link));
    if (xs.length < n) {
      xs = new Float32Array(n);
      ys = new Float32Array(n);
      vxs = new Float32Array(n);
      vys = new Float32Array(n);
      rx = new Float32Array(n);
      ry = new Float32Array(n);
      cellOf = new Int32Array(n);
      items = new Int32Array(n);
    }
    if (cursor.length < cols * rows) {
      cellStart = new Int32Array(cols * rows + 1);
      cursor = new Int32Array(cols * rows);
    }
    maxSegs = n * 6; // generous for the average degree; extras are dropped (budget)
    if (bucket.length < maxSegs) {
      segs = new Float32Array(maxSegs * 4);
      bucket = new Uint8Array(maxSegs);
    }
    const rand = mulberry32(cfg.seed + 1);
    for (let i = 0; i < n; i++) {
      xs[i] = -margin + rand() * W;
      ys[i] = -margin + rand() * H;
      const a = rand() * TAU;
      const s = 0.5 + rand() * 0.5;
      vxs[i] = Math.cos(a) * s;
      vys[i] = Math.sin(a) * s;
    }
    lineWidth = Math.max(0.5, px);
    dot = Math.max(0.75, DOT_CSS * px);
  }

  function paintStyles() {
    if (!ctx) return;
    const [first, ...rest] = cfg.colors;
    bg = first ?? '#000';
    if (rest.length < 2) {
      ink = rest[0] ?? '#fff';
    } else {
      const g = ctx.createLinearGradient(0, h, w, 0);
      rest.forEach((c, i) => g.addColorStop(i / (rest.length - 1), c));
      ink = g;
    }
  }

  function applyConfig() {
    applyCalm(cfg, budget.still, motion);
    if (cfg.seed !== seededFor) {
      noise = createNoise3(cfg.seed);
      seededFor = cfg.seed;
    }
    paintStyles();
  }

  function simulate(dt: number, input: FrameInput) {
    const W = w + 2 * margin;
    const H = h + 2 * margin;
    phase += dt * motion.speed;
    const z = phase * 0.1;
    const unit = Math.min(w, h);
    const v = unit * 0.025 * motion.velocity * dt;
    const freq = 1.4 / (unit * cfg.scale);
    const wobble = motion.turbulence * 0.9;

    let mx = 0;
    let my = 0;
    let pull = 0;
    const mode = cfg.pointer;
    if (input.pointer && mode !== 'off') {
      mx = input.pointer[0] * w;
      my = input.pointer[1] * h;
      pull = input.presence * motion.pointer;
    }
    const r2 = (link * 1.6) ** 2;

    for (let i = 0; i < n; i++) {
      let x = xs[i];
      let y = ys[i];
      // Own drift plus a little noise-field wobble (turbulence).
      const a = noise(x * freq, y * freq, z) * TAU;
      x += (vxs[i] + Math.cos(a) * wobble) * v;
      y += (vys[i] + Math.sin(a) * wobble) * v;
      if (x < -margin) x += W;
      else if (x >= w + margin) x -= W;
      if (y < -margin) y += H;
      else if (y >= h + margin) y -= H;
      xs[i] = x;
      ys[i] = y;
      // Cursor lens: a render-time offset, so nodes never clump at the pointer.
      if (pull > 0 && mode !== 'light') {
        const dx = x - mx;
        const dy = y - my;
        const f = pull * Math.exp(-(dx * dx + dy * dy) / r2) * (mode === 'attract' ? -0.35 : 0.5);
        x += dx * f;
        y += dy * f;
      }
      rx[i] = x;
      ry[i] = y;
    }
    return pull;
  }

  function buildGrid() {
    const cells = cols * rows;
    cursor.fill(0, 0, cells);
    for (let i = 0; i < n; i++) {
      const cx = Math.min(cols - 1, Math.max(0, ((rx[i] + margin) / link) | 0));
      const cy = Math.min(rows - 1, Math.max(0, ((ry[i] + margin) / link) | 0));
      const c = cy * cols + cx;
      cellOf[i] = c;
      cursor[c]++;
    }
    let acc = 0;
    for (let c = 0; c < cells; c++) {
      cellStart[c] = acc;
      acc += cursor[c];
      cursor[c] = cellStart[c];
    }
    cellStart[cells] = acc;
    for (let i = 0; i < n; i++) items[cursor[cellOf[i]]++] = i;
  }

  /** Collect node–node links into `segs`; returns the segment count. */
  function collectLinks(): number {
    const link2 = link * link;
    let s = 0;
    for (let i = 0; i < n; i++) {
      const c = cellOf[i];
      const cx = c % cols;
      const cy = (c / cols) | 0;
      const xi = rx[i];
      const yi = ry[i];
      for (let o = 0; o < 10; o += 2) {
        const nx = cx + OFFSETS[o];
        const ny = cy + OFFSETS[o + 1];
        if (nx >= cols || ny < 0 || ny >= rows) continue;
        const cc = ny * cols + nx;
        for (let k = cellStart[cc], end = cellStart[cc + 1]; k < end; k++) {
          const j = items[k];
          if (o === 0 && j <= i) continue;
          const dx = rx[j] - xi;
          const dy = ry[j] - yi;
          const d2 = dx * dx + dy * dy;
          if (d2 >= link2 || s >= maxSegs) continue;
          const p = s * 4;
          segs[p] = xi;
          segs[p + 1] = yi;
          segs[p + 2] = rx[j];
          segs[p + 3] = ry[j];
          bucket[s++] = Math.min(BUCKETS - 1, ((1 - Math.sqrt(d2) / link) * BUCKETS) | 0);
        }
      }
    }
    return s;
  }

  function draw(input: FrameInput, pull: number) {
    const c = ctx!;
    c.globalAlpha = 1;
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);

    let s = collectLinks();
    // 'light': the cursor joins the network as one more node, faded by presence.
    let lx = 0;
    let ly = 0;
    if (pull > 0 && cfg.pointer === 'light' && input.pointer) {
      lx = input.pointer[0] * w;
      ly = input.pointer[1] * h;
      const reach = link * 1.3;
      const reach2 = reach * reach;
      for (let i = 0; i < n && s < maxSegs; i++) {
        const dx = rx[i] - lx;
        const dy = ry[i] - ly;
        const d2 = dx * dx + dy * dy;
        if (d2 >= reach2) continue;
        const p = s * 4;
        segs[p] = lx;
        segs[p + 1] = ly;
        segs[p + 2] = rx[i];
        segs[p + 3] = ry[i];
        bucket[s++] = Math.min(BUCKETS - 1, ((1 - Math.sqrt(d2) / reach) * BUCKETS * Math.min(1, pull * 2)) | 0);
      }
    }

    c.strokeStyle = ink;
    c.lineWidth = lineWidth;
    for (let b = 0; b < BUCKETS; b++) {
      const t = (b + 0.5) / BUCKETS;
      c.globalAlpha = 0.6 * t * t;
      c.beginPath();
      for (let q = 0; q < s; q++) {
        if (bucket[q] !== b) continue;
        const p = q * 4;
        c.moveTo(segs[p], segs[p + 1]);
        c.lineTo(segs[p + 2], segs[p + 3]);
      }
      c.stroke();
    }

    c.globalAlpha = 0.85;
    c.fillStyle = ink;
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const x = rx[i];
      const y = ry[i];
      if (x < -dot || x > w + dot || y < -dot || y > h + dot) continue;
      c.moveTo(x + dot, y);
      c.arc(x, y, dot, 0, TAU);
    }
    c.fill();
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
      const pull = simulate(dt, input);
      buildGrid();
      draw(input, pull);
    },

    resize(nw, nh) {
      if (!ctx) return;
      w = nw;
      h = nh;
      layout();
      paintStyles();
    },

    setConfig(partial) {
      const prev = cfg;
      cfg = { ...cfg, ...partial };
      applyConfig();
      if (w && (cfg.density !== prev.density || cfg.scale !== prev.scale || cfg.seed !== prev.seed)) layout();
    },

    destroy() {
      ctx = null;
      n = 0;
    },

    particles: () => n,
  };
}

export const particleMesh: RendererDef = { type: 'particle-mesh', webgl: false, create: createParticleMesh };
