import { describe, expect, it } from 'vitest';
import { decide, type DecisionInput } from './detect';
import { backingSize, computeBudget, MAX_PIXELS, STILL_FPS } from './budget';
import { createScheduler } from './scheduler';
import { DEFAULTS, resolveConfig } from './config';
import { cssGradient } from '../fallback/css-gradient';

describe('fallback decision', () => {
  const base: DecisionInput = { reducedMotion: false, mode: 'poster', needsWebGL: true, webgl: true };

  it('animates by default', () => {
    expect(decide(base)).toBe('animate');
  });
  it('shows the poster for reduced motion (poster mode), even without WebGL', () => {
    expect(decide({ ...base, reducedMotion: true })).toBe('poster');
    expect(decide({ ...base, reducedMotion: true, webgl: false })).toBe('poster');
  });
  it('runs near-still for reduced motion in still mode', () => {
    expect(decide({ ...base, reducedMotion: true, mode: 'still' })).toBe('still');
  });
  it('falls back to the CSS gradient without WebGL, only for WebGL types', () => {
    expect(decide({ ...base, webgl: false })).toBe('css');
    expect(decide({ ...base, webgl: false, reducedMotion: true, mode: 'still' })).toBe('css');
    expect(decide({ ...base, webgl: false, needsWebGL: false })).toBe('animate');
  });
  it('falls back to the poster when the context is lost', () => {
    expect(decide({ ...base, broken: true })).toBe('poster');
    expect(decide({ ...base, broken: true, needsWebGL: false })).toBe('poster');
  });
});

describe('budget', () => {
  it('caps DPR and applies the still fps cap', () => {
    const cfg = resolveConfig({});
    expect(computeBudget(cfg, 3, false)).toMatchObject({ dpr: 1.5, fps: 30, resolution: 0.5, still: false });
    expect(computeBudget(cfg, 1, true).fps).toBe(STILL_FPS);
    expect(computeBudget(cfg, 0, false).dpr).toBe(1);
  });
  it('sizes the backing store at CSS × dpr × resolution', () => {
    expect(backingSize(1920, 1080, 0.5, 1)).toEqual([960, 540, 0.5]);
    expect(backingSize(1000, 500, 0.5, 1.5)).toEqual([750, 375, 0.5]);
  });
  it('shrinks to the pixel cap on huge screens', () => {
    const [w, h, res] = backingSize(3840, 2160, 1, 1.5);
    expect(w * h).toBeLessThanOrEqual(MAX_PIXELS * 1.01);
    expect(res).toBeLessThan(1);
    expect(w / h).toBeCloseTo(3840 / 2160, 2);
  });
  it('never returns a zero size', () => {
    expect(backingSize(1, 1, 0.25, 0.5).slice(0, 2)).toEqual([1, 1]);
  });
});

/** A fake rAF clock: `advance(ms)` fires callbacks at a given display refresh. */
function fakeRaf(hz: number) {
  let queue: ((t: number) => void)[] = [];
  let now = 0;
  let requested = 0;
  return {
    raf: (cb: (t: number) => void) => {
      requested++;
      queue.push(cb);
      return requested;
    },
    caf: () => {
      queue = [];
    },
    advance(ms: number) {
      const end = now + ms;
      while (now + 1000 / hz <= end + 1e-9) {
        now += 1000 / hz;
        const q = queue;
        queue = [];
        q.forEach((cb) => cb(now));
      }
      now = end;
    },
    get requested() {
      return requested;
    },
  };
}

describe('scheduler', () => {
  it.each([60, 120, 144])('holds 30 fps on a %i Hz display', (hz) => {
    const r = fakeRaf(hz);
    let ticks = 0;
    const s = createScheduler(() => ticks++, 30, r.raf, r.caf);
    s.start();
    r.advance(10_000);
    expect(ticks / 10).toBeGreaterThan(29.5);
    expect(ticks / 10).toBeLessThanOrEqual(30.2);
  });

  it('makes zero rAF calls while stopped', () => {
    const r = fakeRaf(60);
    const s = createScheduler(() => {}, 30, r.raf, r.caf);
    s.start();
    r.advance(1000);
    s.stop();
    const before = r.requested;
    r.advance(5000);
    expect(r.requested).toBe(before);
    expect(s.running).toBe(false);
  });

  it('resumes with no time jump', () => {
    const r = fakeRaf(60);
    const times: number[] = [];
    const s = createScheduler((t) => times.push(t), 30, r.raf, r.caf);
    s.start();
    r.advance(1000);
    const paused = times[times.length - 1]!;
    s.stop();
    r.advance(60_000); // a minute in a background tab
    s.start();
    r.advance(100);
    expect(times[times.length - 1]! - paused).toBeLessThan(150);
  });

  it('clamps a long jank to one small step', () => {
    let fire: (t: number) => void = () => {};
    const times: number[] = [];
    const s = createScheduler((t) => times.push(t), 30, (cb) => ((fire = cb), 1), () => {});
    s.start();
    fire(0);
    fire(5000); // the main thread was blocked for 5 s
    expect(times[1]! - times[0]!).toBeLessThanOrEqual(100);
  });
});

describe('CSS gradient approximation', () => {
  it('layers radial gradients from the palette and ends in a solid colour', () => {
    const css = cssGradient(DEFAULTS);
    expect(css.match(/radial-gradient\(/g)?.length).toBe(DEFAULTS.colors.length - 1);
    expect(css).toMatch(/linear-gradient\(\d+deg,#1d1d1f,/);
    for (const c of DEFAULTS.colors) expect(css).toContain(c);
    expect(css.endsWith(DEFAULTS.colors[2]!)).toBe(true);
  });
  it('uses the background colour + faint ink glows for canvas types', () => {
    const colors = ['#0f1115', '#3d5a80', '#98c1d9'];
    const css = cssGradient({ type: 'flow-field', colors, seed: 3 });
    expect(css.endsWith(',#0f1115')).toBe(true);
    expect(css).toContain('#3d5a8038');
    expect(css).toContain('#98c1d900');
  });
  it('is deterministic per seed', () => {
    expect(cssGradient({ ...DEFAULTS, seed: 4 })).toBe(cssGradient({ ...DEFAULTS, seed: 4 }));
    expect(cssGradient({ ...DEFAULTS, seed: 4 })).not.toBe(cssGradient({ ...DEFAULTS, seed: 5 }));
  });
  it('works with the minimum two colours', () => {
    const css = cssGradient({ type: 'shader-gradient', colors: ['#000000', '#ffffff'], seed: 1 });
    expect(css).toContain('radial-gradient(');
    expect(css).toContain('linear-gradient(');
  });
});
