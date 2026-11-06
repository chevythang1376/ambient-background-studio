/**
 * Phase 2 runtime test page. Dev-only switches (query string):
 *   ?reduced   fake prefers-reduced-motion: reduce (toggleable at runtime)
 *   ?still     use the near-still reduced-motion variant
 *   ?nowebgl   make getContext('webgl') return null, as on a device without WebGL
 * The HUD updates on a timer, never via rAF, so the rAF counter only sees the runtime.
 */
import './runtime-test.css';
import type { Config, RendererDef } from '@abs/runtime/types';
import { mount, type Mounted } from '@abs/runtime/core/mount';
import { resolveConfig } from '@abs/runtime/core/config';
import { REDUCED_MOTION_QUERY } from '@abs/runtime/core/detect';
import { shaderGradient } from '@abs/runtime/renderers/shader-gradient';
import { flowField } from '@abs/runtime/renderers/flow-field';
import { particleMesh } from '@abs/runtime/renderers/particle-mesh';
import { renderStill } from './poster';

const params = new URLSearchParams(location.search);
const renderers: RendererDef[] = [shaderGradient, flowField, particleMesh];

// ── rAF counter (wraps the global the scheduler calls) ──────────────────────
const rafLog: number[] = [];
let rafCount = 0;
const nativeRaf = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (cb) => nativeRaf((t) => (rafLog.push(performance.now()), rafCount++, cb(t)));
Object.assign(window, { __rafLog: rafLog, __rafCount: () => rafCount });

// ── Dev switches ────────────────────────────────────────────────────────────
// A toggleable stand-in for the reduced-motion query. It starts from (and
// follows) the real preference, so OS settings and browser emulation still work.
const nativeMatchMedia = window.matchMedia.bind(window);
const realMq = nativeMatchMedia(REDUCED_MOTION_QUERY);
let fakeReduced = params.has('reduced') || realMq.matches;
const fakeMq = new EventTarget() as MediaQueryList & EventTarget;
Object.defineProperty(fakeMq, 'matches', { get: () => fakeReduced });
Object.defineProperty(fakeMq, 'media', { value: REDUCED_MOTION_QUERY });
realMq.addEventListener('change', () => {
  fakeReduced = realMq.matches;
  fakeMq.dispatchEvent(new Event('change'));
});
window.matchMedia = (q) => (q === REDUCED_MOTION_QUERY ? fakeMq : nativeMatchMedia(q));

if (params.has('nowebgl')) {
  const native = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
    if (/webgl/.test(type)) return null;
    return (native as (...a: unknown[]) => unknown).call(this, type, ...rest);
  } as typeof native;
}

document.getElementById('flags')!.textContent =
  'flags: ' + (['reduced', 'still', 'nowebgl'].filter((f) => params.has(f)).join(', ') || 'none');

// ── Mount every instance (posters first, as an export would ship them) ─────
type Entry = { m: Mounted; frames: number; fps: number; total: number; samples: number[] };
const instances: Entry[] = [];
(window as unknown as { __abs: Entry[] }).__abs = instances;

document.querySelectorAll<HTMLElement>('.abs-bg').forEach((el) => {
  const overrides: Partial<Config> = params.has('still') ? { reducedMotion: 'still' } : {};
  const cfg = resolveConfig({ ...JSON.parse(el.dataset.abs!), ...overrides });
  const def = renderers.find((d) => d.type === cfg.type)!;
  const still = document.createElement('canvas');
  if (renderStill(def, cfg, Math.round(el.clientWidth), Math.round(el.clientHeight), { resolution: 1, dpr: 1 }, still)) {
    el.querySelector('img')!.src = still.toDataURL('image/webp', 0.85);
  }

  const entry: Entry = { m: null as unknown as Mounted, frames: 0, fps: 0, total: 0, samples: [] };
  const onFrame = (ms: number) => {
    entry.frames++;
    entry.total++;
    entry.samples.push(ms);
    if (entry.samples.length > 600) entry.samples.shift();
  };
  const m = mount(el, { renderers, config: overrides, onFrame });
  if (m) {
    entry.m = m;
    instances.push(entry);
  }
});

// ── HUD ─────────────────────────────────────────────────────────────────────
const rows = document.getElementById('rows')!;
const rafOut = document.getElementById('raf')!;
let lastHud = performance.now();
setInterval(() => {
  const now = performance.now();
  const secs = (now - lastHud) / 1000;
  lastHud = now;
  rows.innerHTML = instances
    .map(({ m }, i) => {
      const e = instances[i]!;
      e.fps = e.frames / secs;
      e.frames = 0;
      const [w, h] = m.size;
      return `<tr><td>${i + 1}</td><td>${m.config.type}</td><td class="s-${m.state}">${m.state}</td><td>${w ? `${w}×${h}` : '—'}</td><td>${e.fps.toFixed(0)}</td></tr>`;
    })
    .join('');
  const recent = rafLog.filter((t) => t > now - 1000).length;
  rafOut.textContent = String(recent);
  if (rafLog.length > 5000) rafLog.splice(0, rafLog.length - 2000);
}, 500);

// ── Context loss / reduced-motion controls ─────────────────────────────────
let loseExt: WEBGL_lose_context | null = null;
document.getElementById('lose')!.addEventListener('click', () => {
  const canvas = instances[0]?.m.el.querySelector('canvas');
  const gl = canvas?.getContext('webgl');
  loseExt = gl?.getExtension('WEBGL_lose_context') ?? null;
  loseExt?.loseContext();
});
document.getElementById('restore')!.addEventListener('click', () => loseExt?.restoreContext());
document.getElementById('toggle-rm')!.addEventListener('click', () => {
  fakeReduced = !fakeReduced;
  fakeMq.dispatchEvent(new Event('change'));
});
