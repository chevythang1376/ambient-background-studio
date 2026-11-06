/**
 * Ambient Background Studio: live preview + control panel.
 *
 * The preview is the real runtime (`mount()` from @abs/runtime), so the meter,
 * the fallback simulations and the budget numbers show exactly what an exported
 * snippet does. The studio only adds what a designer needs on top: controls,
 * a sample hero, a poster frame and the contrast check.
 */
import './studio.css';
import type { BackgroundType, Config, PointerMode } from '@abs/runtime/types';
import { MIN_COLORS, RANGES, resolveConfig } from '@abs/runtime/core/config';
import { applyCalm } from '@abs/runtime/core/calm';
import { backingSize, MAX_PARTICLES, MAX_PIXELS, STILL_FPS } from '@abs/runtime/core/budget';
import { mount, type Mounted } from '@abs/runtime/core/mount';
import { REDUCED_MOTION_QUERY } from '@abs/runtime/core/detect';
import { IDLE_MS } from '@abs/runtime/core/pointer';
import { normalizeHex } from '@abs/runtime/lib/color';
import { defFor, RENDERERS as renderers, TYPE_NAMES } from './renderers';
import { AA_LARGE, AA_NORMAL, LOW_PERCENTILE, assessContrast, formatRatio, hexLuminance, sampleLuminance } from './lib/contrast';
import { formatPalette, isUsable, paletteMessage, parsePalette } from './lib/palette';
import { copyCanvas, renderStill, trackRenderers } from './poster';
import runtimes from 'virtual:abs-runtimes';
import { formatSize } from './export/gzip';
import { createExport } from './ui/export';
import { createMeter } from './ui/meter';
import { createGallery } from './ui/gallery';
import { loadPresets, matchesPreset, MOODS, type Preset } from './lib/presets';
import { $, choice, h, hint, pressable, section, slider, toggle, uidFor, type Control } from './ui/controls';

// ── rAF counter ─────────────────────────────────────────────────────────────
// Wraps the global the runtime's scheduler calls, so the meter can prove that
// a paused background does zero rAF work. The studio itself never uses rAF.
let rafCalls = 0;
const nativeRaf = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (cb) =>
  nativeRaf((t) => {
    rafCalls++;
    cb(t);
  });

// ── State ───────────────────────────────────────────────────────────────────
// The preview mounts tracked copies, so the export can redraw the live frame at poster size.
const tracker = trackRenderers(renderers);
const mq = matchMedia(REDUCED_MOTION_QUERY);

type ActiveMode = Exclude<PointerMode, 'off'>;

// Presets: /presets/*.json, bundled at build time.
const presetFiles = import.meta.glob('../../../presets/*.json', { eager: true, import: 'default' });
const presets = loadPresets(Object.fromEntries(Object.entries(presetFiles).map(([path, json]) => [path.replace(/^.*\/|\.json$/g, ''), json])));
const presetById = (id: string | null) => presets.find((p) => p.id === id);
/** The studio opens on this preset (or on `?preset=<id>`). */
const DEFAULT_PRESET = 'cognac';
let preset: Preset = presetById(new URLSearchParams(location.search).get('preset')) ?? presetById(DEFAULT_PRESET) ?? presets[0]!;

let cfg: Config = resolveConfig(preset.config);
let lastMode: ActiveMode = cfg.pointer === 'off' ? 'light' : cfg.pointer;
const ui = {
  hero: true,
  meter: true,
  text: preset.text,
  /** Explicit reduced-motion choice. `undefined` follows the system setting. */
  reduced: undefined as boolean | undefined,
  noWebGL: false,
  offscreen: false,
};
const reducedNow = () => ui.reduced ?? mq.matches;
const simulate = () => ({ reducedMotion: ui.reduced, noWebGL: ui.noWebGL, offscreen: ui.offscreen });

const LIGHT_LABEL: Record<BackgroundType, string> = {
  'shader-gradient': 'Soft light',
  'flow-field': 'Swirl',
  'particle-mesh': 'Connect',
};
const MODE_HINT: Record<BackgroundType, Record<ActiveMode, string>> = {
  'shader-gradient': {
    attract: 'The colour field bends gently toward the cursor.',
    repel: 'The colour field eases away from the cursor.',
    light: 'A soft glow, tinted by the lightest colour, follows the cursor.',
  },
  'flow-field': {
    attract: 'Lines curve toward the cursor.',
    repel: 'Lines part around the cursor.',
    light: 'Lines swirl around the cursor. A glow would build up in the trails, so it swirls instead.',
  },
  'particle-mesh': {
    attract: 'Nearby dots lean toward the cursor.',
    repel: 'Nearby dots make room for the cursor.',
    light: 'The cursor becomes a node and links to the dots around it.',
  },
};

// ── Preview ─────────────────────────────────────────────────────────────────
const stage = $('#stage');
const bg = $('#bg');
const heroTitle = $('#hero-title');
const badge = $('#badge');
const badgeText = $('#badge-text');
const caption = $('#caption');
const meterEl = $('#meter');
const meter = createMeter(meterEl);

let m: Mounted | undefined;
let wantGrab = false;

m =
  mount(bg, {
    renderers: tracker.defs,
    config: cfg,
    simulate: simulate(),
    onFrame(ms) {
      meter.frame(ms);
      if (wantGrab) grabLive();
    },
    onState(state) {
      refreshStatus();
      // A live grab was requested but the preview stopped first: render one instead.
      if (wantGrab && state !== 'animate' && state !== 'still') {
        wantGrab = false;
        renderOffscreen();
      }
    },
  }) ?? undefined;
if (!m) throw new Error('studio: preview failed to mount');
const preview: Mounted = m;

/** Apply a config change to the studio state and the live preview. */
function set(partial: Partial<Config>, posterDelay = 400) {
  const prevType = cfg.type;
  cfg = resolveConfig({ ...cfg, ...partial });
  preview.setConfig(partial);
  if (cfg.type !== prevType) {
    meter.reset();
    posterDelay = 1200;
  }
  refreshPanel();
  refreshStatus();
  requestPoster(posterDelay);
}

// ── Poster frame + contrast sampling ────────────────────────────────────────
const posterCanvas = document.createElement('canvas');
const posterCtx = posterCanvas.getContext('2d', { willReadFrequently: true })!;
const posterImg = h('img', { class: 'abs-bg__poster', alt: '', decoding: 'async' });
let posterUrl = '';
let posterTimer = 0;
/** Headline line boxes in poster pixels, from the last sample. */
let sampledRects: [number, number, number, number][] = [];
let lums: Float32Array | null = null;

function requestPoster(delay: number) {
  clearTimeout(posterTimer);
  posterTimer = window.setTimeout(() => {
    if (preview.state === 'animate' || preview.state === 'still') wantGrab = true;
    else renderOffscreen();
  }, delay);
}

function grabLive() {
  wantGrab = false;
  const live = bg.querySelector<HTMLCanvasElement>('canvas.abs-bg__canvas');
  if (!live || !live.width) return renderOffscreen();
  copyCanvas(live, posterCanvas);
  publishPoster();
}

function renderOffscreen() {
  const dpr = Math.min(devicePixelRatio || 1, cfg.dprCap);
  const [w, hgt, res] = backingSize(bg.clientWidth, bg.clientHeight, cfg.resolution, dpr);
  if (renderStill(defFor(cfg.type), cfg, w, hgt, { resolution: res, dpr }, posterCanvas)) publishPoster();
  else {
    lums = null;
    renderContrast();
  }
}

function publishPoster() {
  lums = sampleHeadline();
  renderContrast();
  drawThumb();
  posterCanvas.toBlob(
    (blob) => {
      if (!blob) return;
      const old = posterUrl;
      posterUrl = URL.createObjectURL(blob);
      posterImg.onload = () => old && URL.revokeObjectURL(old);
      posterImg.src = posterUrl;
      // Poster goes underneath the canvas, as in an exported snippet.
      if (!posterImg.isConnected) bg.prepend(posterImg);
    },
    'image/webp',
    0.9,
  );
}

/** Luminance of the poster pixels behind each line of the headline. */
function sampleHeadline(): Float32Array | null {
  const cw = bg.clientWidth;
  const ch = bg.clientHeight;
  if (!cw || !ch || !posterCanvas.width) return null;
  const sx = posterCanvas.width / cw;
  const sy = posterCanvas.height / ch;
  const base = bg.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(heroTitle);
  const parts: Float32Array[] = [];
  sampledRects = [];
  for (const r of range.getClientRects()) {
    const x = Math.max(0, Math.floor((r.left - base.left) * sx));
    const y = Math.max(0, Math.floor((r.top - base.top) * sy));
    const w = Math.min(posterCanvas.width - x, Math.ceil(r.width * sx));
    const hgt = Math.min(posterCanvas.height - y, Math.ceil(r.height * sy));
    if (w < 1 || hgt < 1) continue;
    sampledRects.push([x, y, w, hgt]);
    parts.push(sampleLuminance(posterCtx.getImageData(x, y, w, hgt), 2048));
  }
  if (!parts.length) return null;
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ── Panel ───────────────────────────────────────────────────────────────────
const panel = $('#panel');
const controls: Control[] = [];
const add = <T extends Control>(c: T): T => (controls.push(c), c);
const pct = (v: number) => `${Math.round(v * 100)}%`;
const times = (v: number) => `${v.toFixed(2)}×`;

// Background type
const typeChoice = add(
  choice<BackgroundType>({
    legend: 'Background type',
    hideLegend: true,
    variant: 'cards',
    options: [
      { value: 'shader-gradient', label: 'Shader gradient', detail: 'Liquid colour blending · WebGL' },
      { value: 'flow-field', label: 'Flow field', detail: 'Lines on a noise field · Canvas 2D' },
      { value: 'particle-mesh', label: 'Particle mesh', detail: 'A drifting network · Canvas 2D' },
    ],
    get: () => cfg.type,
    onChange: (type) => set({ type }),
  }),
);

// Palette
const palette = (() => {
  const id = uidFor('pal');
  const area = h('textarea', {
    id,
    rows: 3,
    spellcheck: 'false',
    autocomplete: 'off',
    autocapitalize: 'off',
    'aria-describedby': `${id}-hint ${id}-msg`,
  });
  const help = hint('', `${id}-hint`);
  const msg = h('p', { class: 'hint hint--msg', id: `${id}-msg`, 'aria-live': 'polite' });
  const list = h('ul', { class: 'swatches', 'aria-label': 'Swatches' });
  const paint = (colors: readonly string[]) => {
    const canvasType = !defFor(cfg.type).webgl;
    list.replaceChildren(
      ...colors.map((c, i) =>
        h(
          'li',
          { class: 'swatch' },
          h('span', { class: 'swatch__chip', style: `background:${c}`, 'aria-hidden': 'true' }),
          h('span', { class: 'swatch__hex' }, c),
          canvasType && i === 0 ? h('span', { class: 'swatch__role' }, 'bg') : null,
        ),
      ),
    );
  };
  area.addEventListener('input', () => {
    const p = parsePalette(area.value);
    const message = paletteMessage(p);
    msg.textContent = message ?? '';
    area.setAttribute('aria-invalid', String(p.invalid.length > 0 || !isUsable(p)));
    if (isUsable(p)) {
      set({ colors: p.colors });
      paint(p.colors);
    }
  });
  area.addEventListener('blur', () => {
    const p = parsePalette(area.value);
    if (isUsable(p) && !p.invalid.length) area.value = formatPalette(p.colors);
  });
  const root = h(
    'div',
    { class: 'field palette' },
    h('div', { class: 'field__row' }, h('label', { for: id }, 'Hex colours')),
    area,
    msg,
    list,
    help,
  );
  return add({
    root,
    sync() {
      area.value = formatPalette(cfg.colors);
      area.removeAttribute('aria-invalid');
      msg.textContent = '';
      help.textContent = defFor(cfg.type).webgl
        ? `${MIN_COLORS}–5 colours, separated by commas or new lines. They blend in the order given.`
        : `${MIN_COLORS}–5 colours, separated by commas or new lines. The first is the background; the rest are ink.`;
      paint(cfg.colors);
    },
  });
})();

// Calm
const calmEffect = hint('');
const calm = add(
  slider({
    label: 'Calm',
    min: 0,
    max: 1,
    step: 0.01,
    get: () => cfg.calm,
    format: pct,
    ends: ['Near-still', 'As set'],
    onInput: (calm) => set({ calm }),
  }),
);
calm.root.append(calmEffect);

// Motion
const speed = add(
  slider({ label: 'Speed', min: RANGES.speed[0], max: RANGES.speed[1], step: 0.05, get: () => cfg.speed, format: times, onInput: (speed) => set({ speed }) }),
);
const scale = add(
  slider({ label: 'Scale', min: RANGES.scale[0], max: RANGES.scale[1], step: 0.05, get: () => cfg.scale, format: times, onInput: (scale) => set({ scale }) }),
);
const turbulence = add(
  slider({ label: 'Turbulence', min: 0, max: 1, step: 0.01, get: () => cfg.turbulence, format: pct, onInput: (turbulence) => set({ turbulence }) }),
);
const density = add(
  slider({
    label: 'Density',
    min: 0,
    max: 1,
    step: 0.01,
    get: () => cfg.density,
    format: pct,
    onInput: (density) => set({ density }),
    hint: `Share of the particle budget. Never more than ${MAX_PARTICLES.toLocaleString('en-US')}.`,
  }),
);
const trail = add(
  slider({ label: 'Trail length', min: 0, max: 1, step: 0.01, get: () => cfg.trail, format: pct, onInput: (trail) => set({ trail }) }),
);
const seed = (() => {
  const id = uidFor('seed');
  const input = h('input', { type: 'number', id, min: RANGES.seed[0], max: RANGES.seed[1], step: 1, inputmode: 'numeric' });
  input.addEventListener('change', () => {
    if (Number.isFinite(input.valueAsNumber)) set({ seed: Math.round(input.valueAsNumber) });
    input.value = String(cfg.seed);
  });
  const shuffle = h('button', { type: 'button', class: 'btn' }, 'Shuffle');
  shuffle.addEventListener('click', () => {
    set({ seed: Math.floor(Math.random() * (RANGES.seed[1] + 1)) });
    input.value = String(cfg.seed);
  });
  const root = h('div', { class: 'field' }, h('div', { class: 'field__row' }, h('label', { for: id }, 'Seed')), h('div', { class: 'inline' }, input, shuffle));
  return add({ root, sync: () => (input.value = String(cfg.seed)) });
})();

// Texture
const grain = add(
  slider({
    label: 'Grain',
    min: 0,
    max: 1,
    step: 0.01,
    get: () => cfg.grain,
    format: pct,
    onInput: (grain) => set({ grain }, 0),
    hint: 'A CSS overlay on top of any type. It animates only while the background does.',
  }),
);

// Interactivity
const follow = add(
  toggle({
    label: 'Cursor follow',
    get: () => cfg.pointer !== 'off',
    onChange: (on) => set({ pointer: on ? lastMode : 'off' }),
    hint: `Eased, never snapped. After ${IDLE_MS / 1000} s without input it drifts back to idle motion. Listeners are passive and the background never takes clicks.`,
  }),
);
const mode = add(
  choice<ActiveMode>({
    legend: 'Cursor effect',
    options: [
      { value: 'attract', label: 'Attract' },
      { value: 'repel', label: 'Repel' },
      { value: 'light', label: 'Soft light' },
    ],
    get: () => (cfg.pointer === 'off' ? lastMode : cfg.pointer),
    onChange: (v) => {
      lastMode = v;
      set({ pointer: v });
    },
    hint: ' ',
  }),
);
const strength = add(
  slider({ label: 'Strength', min: 0, max: 1, step: 0.01, get: () => cfg.pointerStrength, format: pct, onInput: (pointerStrength) => set({ pointerStrength }) }),
);

// Contrast
const contrast = (() => {
  const id = uidFor('text');
  const picker = h('input', { type: 'color', id: `${id}-pick`, 'aria-label': 'Pick text colour' });
  const hex = h('input', { type: 'text', id, class: 'mono', spellcheck: 'false', autocomplete: 'off', maxlength: 7, size: 8 });
  const apply = (c: string) => {
    ui.text = c;
    picker.value = c;
    stage.style.setProperty('--hero-ink', c);
    stage.style.setProperty('--hero-cta-ink', (hexLuminance(c) ?? 1) > 0.4 ? '#111111' : '#ffffff');
    renderContrast();
  };
  picker.addEventListener('input', () => {
    hex.value = picker.value;
    hex.removeAttribute('aria-invalid');
    apply(picker.value);
  });
  hex.addEventListener('input', () => {
    const c = normalizeHex(hex.value);
    hex.setAttribute('aria-invalid', String(!c));
    if (c) apply(c);
  });
  hex.addEventListener('blur', () => {
    hex.value = ui.text;
    hex.removeAttribute('aria-invalid');
  });
  const quick = (label: string, c: string) => {
    const b = h('button', { type: 'button', class: 'btn btn--small' }, label);
    b.addEventListener('click', () => {
      hex.value = c;
      apply(c);
    });
    return b;
  };

  const ratio = h('p', { class: 'contrast__ratio' }, '—');
  const large = h('span', { class: 'pill' });
  const body = h('span', { class: 'pill' });
  const detail = hint('');
  const suggest = h('p', { class: 'hint contrast__suggest' });
  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  const thumb = h('canvas', { class: 'contrast__thumb', width: 240, height: 135, 'aria-hidden': 'true' });
  const recapture = h('button', { type: 'button', class: 'btn btn--small' }, 'Capture current frame');
  recapture.addEventListener('click', () => requestPoster(0));

  const root = h(
    'div',
    { class: 'contrast' },
    h(
      'div',
      { class: 'field' },
      h('div', { class: 'field__row' }, h('label', { for: id }, 'Headline text colour')),
      h('div', { class: 'inline' }, h('span', { class: 'colorwell' }, picker), hex, quick('White', '#ffffff'), quick('Ink', '#111111')),
    ),
    h('div', { class: 'contrast__result' }, thumb, h('div', null, ratio, h('div', { class: 'pills' }, large, body))),
    detail,
    suggest,
    h('div', { class: 'inline' }, recapture),
    live,
  );
  // Outline the measured headline in the preview while the section is in use.
  const show = (on: boolean) => stage.toggleAttribute('data-sample', on);
  root.addEventListener('pointerenter', () => show(true));
  root.addEventListener('pointerleave', () => show(root.contains(document.activeElement)));
  root.addEventListener('focusin', () => show(true));
  root.addEventListener('focusout', (e) => show(root.contains(e.relatedTarget as Node)));

  let liveTimer = 0;
  const pill = (el: HTMLElement, pass: boolean, text: string) => {
    el.textContent = `${pass ? '✓' : '✕'} ${text}`;
    el.dataset.pass = String(pass);
  };
  return Object.assign(
    add({
      root,
      sync() {
        hex.value = ui.text;
        apply(ui.text);
      },
    }),
    {
      thumb,
      render() {
        const text = hexLuminance(ui.text);
        if (!lums || text == null) {
          ratio.textContent = '—';
          large.textContent = body.textContent = '';
          detail.textContent = 'The poster frame isn’t available, so contrast can’t be measured.';
          suggest.textContent = '';
          return;
        }
        const r = assessContrast(text, lums);
        ratio.textContent = formatRatio(r.low);
        pill(large, r.passLarge, `AA large ${AA_LARGE}:1`);
        pill(body, r.passNormal, `AA body ${AA_NORMAL}:1`);
        detail.textContent = `Lowest ratio across ${100 - LOW_PERCENTILE * 100}% of the poster pixels behind the headline (average ${formatRatio(r.average)}). The headline is large text, so it needs ${AA_LARGE}:1.`;
        suggest.textContent = '';
        if (!r.passNormal) {
          const options = (['#ffffff', '#111111'] as const)
            .filter((c) => c !== ui.text)
            .map((c) => [c, assessContrast(hexLuminance(c)!, lums!).low] as const)
            .sort((a, b) => b[1] - a[1]);
          const best = options[0];
          if (best && best[1] > r.low) suggest.textContent = `${best[0] === '#ffffff' ? 'White' : 'Ink'} text reaches ${formatRatio(best[1])} here.`;
        }
        clearTimeout(liveTimer);
        liveTimer = window.setTimeout(() => {
          live.textContent = `Contrast ${formatRatio(r.low)}. AA large text ${r.passLarge ? 'passes' : 'fails'}, AA body text ${r.passNormal ? 'passes' : 'fails'}.`;
        }, 800);
      },
    },
  );
})();

function renderContrast() {
  contrast.render();
}

function drawThumb() {
  const t = contrast.thumb;
  const ctx = t.getContext('2d');
  if (!ctx || !posterCanvas.width) return;
  t.height = Math.round((t.width * posterCanvas.height) / posterCanvas.width);
  ctx.drawImage(posterCanvas, 0, 0, t.width, t.height);
  const k = t.width / posterCanvas.width;
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#ffffff';
  for (const [x, y, w, hgt] of sampledRects) ctx.strokeRect(x * k + 0.75, y * k + 0.75, w * k - 1.5, hgt * k - 1.5);
  ctx.lineDashOffset = 3.5;
  ctx.strokeStyle = '#111111';
  for (const [x, y, w, hgt] of sampledRects) ctx.strokeRect(x * k + 0.75, y * k + 0.75, w * k - 1.5, hgt * k - 1.5);
}

// Budget
const dprHint = hint('');
const resolution = add(
  slider({
    label: 'Render scale',
    min: RANGES.resolution[0],
    max: RANGES.resolution[1],
    step: 0.05,
    get: () => cfg.resolution,
    format: times,
    onInput: (resolution) => set({ resolution }),
    hint: 'The canvas renders at this share of the element size and CSS scales it up. Soft backgrounds hide it.',
  }),
);
const dprCap = add(
  slider({
    label: 'DPR cap',
    min: RANGES.dprCap[0],
    max: RANGES.dprCap[1],
    step: 0.25,
    get: () => cfg.dprCap,
    format: (v) => String(+v.toFixed(2)),
    onInput: (dprCap) => set({ dprCap }),
  }),
);
dprCap.root.append(dprHint);
const fps = add(
  choice<'15' | '24' | '30' | '60'>({
    legend: 'Frame-rate cap',
    options: [
      { value: '15', label: '15' },
      { value: '24', label: '24' },
      { value: '30', label: '30' },
      { value: '60', label: '60' },
    ],
    get: () => String(cfg.fps) as '15' | '24' | '30' | '60',
    onChange: (v) => set({ fps: Number(v) }),
    hint: 'Ambient motion looks fine at 30 fps, at half the work of 60.',
  }),
);
const reducedMode = add(
  choice<Config['reducedMotion']>({
    legend: 'With reduced motion, show',
    options: [
      { value: 'poster', label: 'Poster frame' },
      { value: 'still', label: 'Near-still' },
    ],
    get: () => cfg.reducedMotion,
    onChange: (reducedMotion) => set({ reducedMotion }),
    hint: `Near-still keeps the canvas but almost stops the motion and drops to ${STILL_FPS} fps.`,
  }),
);

// Export
const exporter = createExport({ config: () => cfg, def: defFor, live: () => tracker.live, typeName: (t) => TYPE_NAMES[t] });
document.body.append(exporter.dialog);
const exportHint = hint('');
const exportBtn = h('button', { type: 'button', class: 'btn btn--primary' }, 'Export snippet');
exportBtn.addEventListener('click', () => exporter.open());
$('#export').addEventListener('click', () => exporter.open());

// Preset readout: where the current settings came from.
const presetName = h('p', { class: 'preset__name' });
const presetMeta = h('p', { class: 'hint preset__meta' });
const browse = h('button', { type: 'button', class: 'btn btn--small' }, 'Browse presets');
browse.addEventListener('click', () => selectView('presets', true));
const presetRoot = h('div', { class: 'preset' }, h('div', { class: 'preset__row' }, presetName, browse), presetMeta);

// ── Workspace views: Preview | Presets (tabs) ──────────────────────────────
type View = 'preview' | 'presets';
const VIEWS: readonly View[] = ['preview', 'presets'];
const tabs: Record<View, HTMLElement> = { preview: $('#tab-preview'), presets: $('#tab-presets') };
const views: Record<View, HTMLElement> = { preview: $('#view-preview'), presets: $('#view-presets') };
$('#preset-count').textContent = String(presets.length);

const gallery = createGallery($('#gallery'), {
  presets,
  renderers,
  reduced: reducedNow,
  current: () => preset.id,
  onPick(p) {
    applyPreset(p);
    selectView('preview', true);
  },
});

function selectView(v: View, focus = false) {
  for (const k of VIEWS) {
    const on = k === v;
    tabs[k].setAttribute('aria-selected', String(on));
    tabs[k].tabIndex = on ? 0 : -1;
    views[k].hidden = !on;
  }
  gallery.setShown(v === 'presets');
  if (focus) tabs[v].focus();
}
for (const k of VIEWS) {
  tabs[k].addEventListener('click', () => selectView(k));
  tabs[k].addEventListener('keydown', (e) => {
    const i = VIEWS.indexOf(k);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: VIEWS.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    selectView(VIEWS[(next + VIEWS.length) % VIEWS.length]!, true);
  });
}

panel.append(
  section('Preset', presetRoot),
  section('Background', typeChoice.root),
  section('Palette', palette.root),
  section('Calm', calm.root),
  section('Motion', speed.root, scale.root, turbulence.root, density.root, trail.root, seed.root),
  section('Texture', grain.root),
  section('Interactivity', follow.root, mode.root, strength.root),
  section('Contrast', contrast.root),
  section(
    'Budget',
    resolution.root,
    dprCap.root,
    fps.root,
    reducedMode.root,
    hint(
      `Hard limits whatever the settings: ${(MAX_PIXELS / 1e6).toFixed(1)} MP backing store, ${MAX_PARTICLES.toLocaleString('en-US')} particles. Off-screen and hidden tabs pause with zero rAF callbacks.`,
    ),
  ),
  section('Export', exportHint, h('div', { class: 'inline export-cta' }, exportBtn)),
);

/** Refresh what depends on the type or on derived values (not the inputs themselves). */
function refreshPanel() {
  const canvasType = !defFor(cfg.type).webgl;
  density.root.hidden = !canvasType;
  trail.root.hidden = cfg.type !== 'flow-field';
  mode.setLabel('light', LIGHT_LABEL[cfg.type]);
  mode.setDisabled(cfg.pointer === 'off');
  strength.input.disabled = cfg.pointer === 'off';
  mode.hintEl!.textContent = cfg.pointer === 'off' ? 'The background ignores the cursor and only drifts.' : MODE_HINT[cfg.type][cfg.pointer];
  const e = applyCalm({ speed: 1, turbulence: 1, pointerStrength: 1, calm: cfg.calm });
  calmEffect.textContent = `Speed and particle velocity ×${e.speed.toFixed(2)} · turbulence ×${e.turbulence.toFixed(2)} · cursor ×${e.pointer.toFixed(2)}.`;
  const screen = devicePixelRatio || 1;
  const edited = !matchesPreset(cfg, preset);
  presetName.textContent = edited ? `${preset.name} (edited)` : preset.name;
  presetMeta.textContent = `${MOODS.find((m) => m.id === preset.mood)!.label} · ${edited ? 'Reset goes back to the preset.' : preset.description}`;
  exportHint.textContent =`One HTML block: the poster and the ${TYPE_NAMES[cfg.type].toLowerCase()} runtime only, ${formatSize(runtimes[cfg.type].gzip)} gzipped.`;
  dprHint.textContent =`This screen is ${+screen.toFixed(2)}×, so the canvas uses ${+Math.min(screen, cfg.dprCap).toFixed(2)}×.`;
}

function syncAll() {
  for (const c of controls) c.sync();
  refreshPanel();
}

// ── Toolbar: show + simulate ────────────────────────────────────────────────
const chips: Control[] = [
  pressable($<HTMLButtonElement>('#t-hero'), () => ui.hero, (v) => {
    ui.hero = v;
    stage.dataset.hero = v ? 'on' : 'off';
    refreshChips();
  }),
  pressable($<HTMLButtonElement>('#t-meter'), () => ui.meter, (v) => {
    ui.meter = v;
    meterEl.hidden = !v;
    refreshChips();
  }),
  pressable($<HTMLButtonElement>('#t-rm'), reducedNow, (v) => {
    ui.reduced = v;
    preview.simulate(simulate());
    refreshChips();
  }),
  pressable($<HTMLButtonElement>('#t-nogl'), () => ui.noWebGL, (v) => {
    ui.noWebGL = v;
    preview.simulate(simulate());
    refreshChips();
  }),
  pressable($<HTMLButtonElement>('#t-off'), () => ui.offscreen, (v) => {
    ui.offscreen = v;
    preview.simulate(simulate());
    refreshChips();
  }),
];

function refreshChips() {
  for (const c of chips) c.sync();
  refreshStatus();
  gallery.refresh(); // reduced motion (simulated or system) turns the gallery to posters
}

/** Badge in the preview corner and the caption under it: what the runtime decided, and why. */
function refreshStatus() {
  if (!m) return;
  const name = TYPE_NAMES[cfg.type];
  let tone = 'live';
  let label: string;
  let text: string;
  switch (m.state) {
    case 'animate':
      label = `Live · ${cfg.fps} fps cap`;
      text =
        ui.noWebGL && !defFor(cfg.type).webgl
          ? `${name} draws with Canvas 2D, so it keeps animating without WebGL.`
          : `Animating, capped at ${cfg.fps} fps. It pauses off-screen and in hidden tabs.`;
      if (ui.reduced === false && mq.matches) text += ' Your system asks for reduced motion; visitors with that setting get the fallback.';
      break;
    case 'still':
      tone = 'fallback';
      label = 'Near-still · reduced motion';
      text = `Reduced motion: the near-still variant, with motion almost stopped at ${STILL_FPS} fps.`;
      break;
    case 'poster':
      tone = 'fallback';
      label = 'Poster frame';
      text = reducedNow()
        ? 'Reduced motion: visitors see the poster frame. No canvas, no rAF.'
        : 'The renderer stopped (lost WebGL context), so the poster frame shows.';
      break;
    case 'css':
      tone = 'fallback';
      label = 'CSS gradient';
      text = 'No WebGL: visitors see the CSS gradient approximation. No canvas, no rAF.';
      break;
    default:
      tone = 'paused';
      label = 'Paused';
      text = ui.offscreen
        ? 'Off-screen: paused, with zero rAF callbacks. It resumes with no time jump.'
        : 'Paused while the tab is hidden.';
  }
  if (ui.reduced === undefined && mq.matches) text += ' Reduced motion is on because your system asks for it.';
  badge.dataset.tone = tone;
  badgeText.textContent = label;
  if (caption.textContent !== text) caption.textContent = text;
}

mq.addEventListener('change', refreshChips);
document.addEventListener('visibilitychange', refreshStatus);

// ── Meter refresh (timer, not rAF) ──────────────────────────────────────────
const lastPointer = { x: 0, y: 0, t: -1e9 };
addEventListener(
  'pointermove',
  (e) => {
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    lastPointer.t = performance.now();
  },
  { passive: true },
);

function pointerStatus(): string {
  if (cfg.pointer === 'off') return 'off';
  const r = bg.getBoundingClientRect();
  const tx = (lastPointer.x - r.left) / (r.width || 1);
  const ty = (lastPointer.y - r.top) / (r.height || 1);
  const near = tx > -0.1 && tx < 1.1 && ty > -0.1 && ty < 1.1;
  return near && performance.now() - lastPointer.t < IDLE_MS ? 'following' : 'idle drift';
}

let lastMeter = performance.now();
let lastRaf = 0;
setInterval(() => {
  const now = performance.now();
  const dt = (now - lastMeter) / 1000;
  lastMeter = now;
  const rafPerSec = (rafCalls - lastRaf) / (dt || 1);
  lastRaf = rafCalls;
  const running = preview.state === 'animate' || preview.state === 'still';
  meter.render({
    dt,
    running,
    fpsCap: preview.state === 'still' ? Math.min(cfg.fps, STILL_FPS) : cfg.fps,
    size: preview.size,
    cssWidth: bg.clientWidth,
    dpr: Math.min(devicePixelRatio || 1, cfg.dprCap),
    particles: defFor(cfg.type).webgl ? null : preview.particles,
    rafPerSec,
    pointer: running ? pointerStatus() : 'n/a',
  });
}, 500);

// ── Reset, resize, start ────────────────────────────────────────────────────
/** Load a preset into the studio: config, headline colour, every control. */
function applyPreset(p: Preset) {
  preset = p;
  cfg = resolveConfig(p.config);
  lastMode = cfg.pointer === 'off' ? 'light' : cfg.pointer;
  ui.text = p.text;
  preview.setConfig(cfg);
  meter.reset();
  syncAll();
  refreshStatus();
  gallery.refresh();
  requestPoster(1200);
}

// Reset goes back to the current preset's own settings.
$('#reset').addEventListener('click', () => applyPreset(preset));

// Re-capture when the preview changes size: the headline lands on different pixels.
let firstResize = true;
new ResizeObserver(() => {
  if (firstResize) return void (firstResize = false);
  requestPoster(500);
}).observe(bg);

stage.dataset.hero = 'on';
syncAll();
refreshChips();
requestPoster(preview.state === 'animate' ? 1200 : 0);
if (new URLSearchParams(location.search).get('view') === 'presets') selectView('presets');

// Dev hook for automated checks (headless verification scripts).
Object.assign(window, {
  __studio: {
    preview,
    gallery,
    get config() { return cfg; },
    get preset() { return preset.id; },
    get rafCalls() { return rafCalls; },
    get lums() { return lums; },
    get text() { return ui.text; },
  },
});
