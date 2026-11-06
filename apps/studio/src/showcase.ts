/**
 * Showcase page: mounts the runtime on every hero (the markup is already in
 * the page, poster first) and keeps a small live readout of how many
 * backgrounds are animating and how many rAF callbacks they make, so the
 * off-screen pause is visible as you scroll.
 */
import { mount, type Mounted } from '@abs/runtime/core/mount';
import { RENDERERS } from './renderers';

let rafCalls = 0;
const nativeRaf = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (cb) =>
  nativeRaf((t) => {
    rafCalls++;
    cb(t);
  });

const mounted: Mounted[] = [];
document.querySelectorAll<HTMLElement>('.abs-bg[data-abs]').forEach((el) => {
  const m = mount(el, { renderers: RENDERERS });
  if (m) mounted.push(m);
});

// Readout on a timer, never rAF, so it doesn't count itself.
const hud = document.getElementById('hud')!;
let last = performance.now();
let lastRaf = 0;
setInterval(() => {
  const now = performance.now();
  const perSec = Math.round(((rafCalls - lastRaf) * 1000) / (now - last));
  last = now;
  lastRaf = rafCalls;
  const animating = mounted.filter((m) => m.state === 'animate' || m.state === 'still').length;
  const reduced = mounted.length > 0 && mounted.every((m) => m.state === 'poster' || m.state === 'css');
  const text = reduced
    ? `Reduced motion · ${mounted.length} posters, 0 rAF/s`
    : `${animating} of ${mounted.length} animating · ${perSec} rAF/s`;
  if (hud.textContent !== text) hud.textContent = text;
  hud.dataset.idle = String(animating === 0);
}, 500);

Object.assign(window, { __showcase: { mounted, get rafCalls() { return rafCalls; } } });
