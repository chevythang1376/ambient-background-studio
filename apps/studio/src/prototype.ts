/**
 * Phase 1 bare test page: one renderer at a time, every config param on a
 * slider. Plain rAF here on purpose; the capped scheduler arrives in phase 2.
 */
import './prototype.css';
import type { BackgroundType, Budget, Config, FrameInput, PointerMode, Renderer } from '@abs/runtime/types';
import { resolveConfig } from '@abs/runtime/core/config';
import { createShaderGradient } from '@abs/runtime/renderers/shader-gradient';
import { createFlowField } from '@abs/runtime/renderers/flow-field';
import { createParticleMesh } from '@abs/runtime/renderers/particle-mesh';

const factories: Partial<Record<BackgroundType, () => Renderer>> = {
  'shader-gradient': createShaderGradient,
  'flow-field': createFlowField,
  'particle-mesh': createParticleMesh,
};

/** Starting points per type so switching always looks reasonable. */
const STARTERS: Partial<Record<BackgroundType, Partial<Config>>> = {
  'shader-gradient': {
    colors: ['#1d1d1f', '#3b3346', '#96694c', '#d9b99b'],
    pointer: 'light',
    scale: 1,
    turbulence: 0.5,
  },
  'flow-field': {
    colors: ['#0f1115', '#3d5a80', '#98c1d9', '#e0e7ee'],
    pointer: 'light', // Canvas 2D renders 'light' as a gentle swirl
    scale: 1,
    turbulence: 0.35,
  },
  'particle-mesh': {
    colors: ['#0b0d12', '#5b6b8c', '#c9d4e8'],
    pointer: 'light',
    pointerStrength: 0.6,
    scale: 1,
    turbulence: 0.3,
  },
};

const stage = document.getElementById('stage')!;
const panel = document.getElementById('panel') as HTMLFormElement;
const stats = document.getElementById('stats')!;

let config: Config = resolveConfig({ type: 'shader-gradient', ...STARTERS['shader-gradient'] });
let renderer: Renderer | null = null;
let canvas: HTMLCanvasElement | null = null;
let resLabel = '';

const budget = (): Budget => ({
  resolution: config.resolution,
  dpr: Math.min(window.devicePixelRatio || 1, config.dprCap),
  fps: config.fps,
  maxParticles: 5000,
  still: false,
});

function size() {
  if (!renderer || !canvas) return;
  const b = budget();
  const w = Math.max(1, Math.round(stage.clientWidth * b.dpr * b.resolution));
  const h = Math.max(1, Math.round(stage.clientHeight * b.dpr * b.resolution));
  canvas.width = w;
  canvas.height = h;
  renderer.resize(w, h);
  resLabel = `${w}×${h} (${Math.round(b.resolution * 100)}% @ ${b.dpr}x)`;
}

/** A canvas can't switch context type, so every (re)mount gets a fresh one. */
function mount() {
  renderer?.destroy();
  canvas?.remove();
  canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  stage.append(canvas);
  renderer = factories[config.type]!();
  try {
    renderer.init(canvas, config, budget());
  } catch (err) {
    console.warn(err);
    renderer = null;
    return;
  }
  size();
}

// ── Controls ────────────────────────────────────────────────────────────────

type Slider = { key: keyof Config; label: string; min: number; max: number; step: number; remount?: boolean };
const SLIDERS: Slider[] = [
  { key: 'speed', label: 'Speed', min: 0, max: 3, step: 0.01 },
  { key: 'scale', label: 'Scale', min: 0.25, max: 4, step: 0.01 },
  { key: 'turbulence', label: 'Turbulence', min: 0, max: 1, step: 0.01 },
  { key: 'calm', label: 'Calm (0 = near-still)', min: 0, max: 1, step: 0.01 },
  { key: 'pointerStrength', label: 'Cursor strength', min: 0, max: 1, step: 0.01 },
  { key: 'density', label: 'Density (flow, mesh)', min: 0, max: 1, step: 0.01 },
  { key: 'trail', label: 'Trail (flow)', min: 0, max: 1, step: 0.01 },
  { key: 'seed', label: 'Seed', min: 0, max: 99, step: 1 },
  { key: 'resolution', label: 'Render resolution', min: 0.25, max: 1, step: 0.05, remount: true },
  { key: 'dprCap', label: 'DPR cap', min: 0.5, max: 3, step: 0.25, remount: true },
];

function renderPanel() {
  const swatches = [0, 1, 2, 3, 4]
    .map((i) => {
      const value = config.colors[i] ?? '#808080';
      const on = i < config.colors.length;
      return `<input type="color" name="color${i}" value="${value}" aria-label="Colour ${i + 1}" ${on ? '' : 'disabled'}>`;
    })
    .join('');

  panel.innerHTML = `
    <h1>Phase 1 prototype</h1>
    <label>Type
      <select name="type">
        ${Object.keys(factories).map((t) => `<option ${t === config.type ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
    </label>
    <fieldset>
      <legend>Palette</legend>
      <div class="swatches">${swatches}</div>
      <label>Stops <input type="range" name="stops" min="2" max="5" step="1" value="${config.colors.length}"></label>
    </fieldset>
    <label>Cursor
      <select name="pointer">
        ${(['off', 'attract', 'repel', 'light'] as PointerMode[])
          .map((m) => `<option ${m === config.pointer ? 'selected' : ''}>${m}</option>`)
          .join('')}
      </select>
    </label>
    ${SLIDERS.map(
      (s) => `<label><span class="row">${s.label} <b data-out="${s.key}">${config[s.key]}</b></span>
        <input type="range" name="${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${config[s.key]}">
      </label>`,
    ).join('')}
  `;
}

function readColors(stops: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < stops; i++) {
    const el = panel.elements.namedItem(`color${i}`) as HTMLInputElement;
    out.push(el.value);
  }
  return out;
}

panel.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement | HTMLSelectElement;
  const name = el.name;
  if (name === 'type') {
    const type = el.value as BackgroundType;
    config = resolveConfig({ ...config, ...STARTERS[type], type });
    renderPanel();
    mount();
    return;
  }
  if (name === 'stops') {
    const stops = Number(el.value);
    const prev = config.colors;
    const colors = Array.from({ length: stops }, (_, i) => prev[i] ?? prev[prev.length - 1]!);
    config = resolveConfig({ ...config, colors });
    renderer?.setConfig({ colors: config.colors });
    renderPanel();
    return;
  }
  if (name.startsWith('color')) {
    config = resolveConfig({ ...config, colors: readColors(config.colors.length) });
    renderer?.setConfig({ colors: config.colors });
    return;
  }
  if (name === 'pointer') {
    config.pointer = el.value as PointerMode;
    renderer?.setConfig({ pointer: config.pointer });
    return;
  }
  const slider = SLIDERS.find((s) => s.key === name);
  if (!slider) return;
  config = resolveConfig({ ...config, [name]: Number(el.value) });
  const out = panel.querySelector(`[data-out="${name}"]`);
  if (out) out.textContent = String(config[slider.key]);
  if (slider.remount) mount();
  else renderer?.setConfig({ [name]: config[slider.key] } as Partial<Config>);
});

// ── Pointer (eased, idle drift) ─────────────────────────────────────────────

const input: FrameInput = { pointer: null, presence: 0, scroll: 0 };
const eased: [number, number] = [0.5, 0.5];
let tx = 0.5;
let ty = 0.5;
let seen = false;
let lastMove = -Infinity;

window.addEventListener(
  'pointermove',
  (e) => {
    tx = e.clientX / stage.clientWidth;
    ty = e.clientY / stage.clientHeight;
    if (!seen) {
      eased[0] = tx;
      eased[1] = ty;
      input.pointer = eased;
      seen = true;
    }
    lastMove = performance.now();
  },
  { passive: true },
);

// ── Loop + stats ────────────────────────────────────────────────────────────

let prev = performance.now();
let frames = 0;
let cpu = 0;
let windowStart = prev;

function tick(now: number) {
  const dt = Math.min(now - prev, 100) / 1000;
  prev = now;

  // Lerp, never snap. Presence eases to 0 after 3 s idle → autonomous drift.
  const k = 1 - Math.exp(-dt * 3);
  eased[0] += (tx - eased[0]) * k;
  eased[1] += (ty - eased[1]) * k;
  const active = now - lastMove < 3000 ? 1 : 0;
  input.presence += (active - input.presence) * (1 - Math.exp(-dt * (active ? 2 : 0.7)));

  if (renderer) {
    const t0 = performance.now();
    renderer.frame(now, input);
    cpu += performance.now() - t0;
  }
  frames++;
  if (now - windowStart >= 500) {
    const fps = (frames * 1000) / (now - windowStart);
    stats.textContent = renderer
      ? `${config.type} · ${fps.toFixed(0)} fps · ${(cpu / frames).toFixed(2)} ms CPU/frame · ${resLabel}`
      : `${config.type} · unavailable on this device`;
    frames = 0;
    cpu = 0;
    windowStart = now;
  }
  requestAnimationFrame(tick);
}

new ResizeObserver(size).observe(stage);
renderPanel();
mount();
requestAnimationFrame(tick);
