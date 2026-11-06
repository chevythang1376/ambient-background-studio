/**
 * Live performance meter, pinned to a corner of the preview.
 *
 * Frame samples go into a fixed ring buffer (no allocation per frame). The
 * readout refreshes on a 500 ms timer, never on rAF, so the meter itself never
 * keeps the page's rAF loop alive and the "rAF/s" row stays honest.
 *
 * Frame time is CPU time per frame (simulation, drawing and draw-call
 * submission). WebGL1 can't time GPU work without vendor extensions; the
 * shader's GPU cost shows up as a dropped frame rate, which the FPS row shows.
 */
import { h } from './controls';

const SAMPLES = 150; // 5 s at 30 fps

export interface MeterInfo {
  /** Seconds since the last render. */
  dt: number;
  running: boolean;
  fpsCap: number;
  /** Backing-store size, [0, 0] when nothing renders. */
  size: readonly [number, number];
  cssWidth: number;
  dpr: number;
  /** Particle count, or null for types without particles. */
  particles: number | null;
  rafPerSec: number;
  pointer: string;
}

export interface Meter {
  frame(cpuMs: number): void;
  reset(): void;
  render(info: MeterInfo): void;
}

const ROWS = [
  ['fps', 'FPS'],
  ['avg', 'Frame avg'],
  ['p95', 'Frame p95'],
  ['res', 'Render'],
  ['particles', 'Particles'],
  ['raf', 'rAF/s'],
  ['pointer', 'Cursor'],
] as const;

type Row = (typeof ROWS)[number][0];

export function createMeter(root: HTMLElement): Meter {
  const ring = new Float32Array(SAMPLES);
  const scratch = new Float32Array(SAMPLES);
  let count = 0;
  let next = 0;
  let frames = 0;
  // FPS over the last two refreshes (~1 s), so a single 500 ms window's ±1 frame doesn't jitter it.
  let prevFrames = 0;
  let prevDt = 0;
  const cells = {} as Record<Row, HTMLElement>;
  for (const [key, label] of ROWS) {
    cells[key] = h('dd');
    root.append(h('dt', null, label), cells[key]);
  }
  root.querySelector('dt')!.title = 'Rendered frames per second, against the cap';
  cells.avg.previousElementSibling!.setAttribute('title', 'CPU time per frame: simulation, drawing and draw-call submission');

  const ms = (v: number) => `${v < 10 ? v.toFixed(2) : v.toFixed(1)} ms`;

  return {
    frame(cpuMs) {
      ring[next] = cpuMs;
      next = (next + 1) % SAMPLES;
      if (count < SAMPLES) count++;
      frames++;
    },

    reset() {
      count = next = frames = prevFrames = prevDt = 0;
    },

    render(i) {
      const span = i.dt + prevDt;
      const fps = span > 0 ? (frames + prevFrames) / span : 0;
      prevFrames = frames;
      prevDt = i.dt;
      frames = 0;
      if (!i.running) count = next = 0;
      cells.fps.textContent = `${fps.toFixed(1)} / ${i.fpsCap}`;
      if (count) {
        scratch.set(ring);
        const s = scratch.subarray(0, count).sort();
        let sum = 0;
        for (let k = 0; k < count; k++) sum += s[k]!;
        cells.avg.textContent = ms(sum / count);
        cells.p95.textContent = ms(s[Math.min(count - 1, Math.floor(count * 0.95))]!);
      } else {
        cells.avg.textContent = cells.p95.textContent = '—';
      }
      const [w, hgt] = i.size;
      cells.res.textContent = w ? `${w}×${hgt} · ${(w / (i.cssWidth || 1)).toFixed(2)}×` : 'none';
      cells.res.title = w ? `Backing store ${w}×${hgt} px for a ${i.cssWidth} px wide element (DPR cap applied: ${i.dpr})` : '';
      cells.particles.textContent = i.particles == null ? 'n/a' : i.particles.toLocaleString('en-US');
      cells.raf.textContent = String(Math.round(i.rafPerSec));
      cells.pointer.textContent = i.pointer;
      root.dataset.running = String(i.running);
    },
  };
}
