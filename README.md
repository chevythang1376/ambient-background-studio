# Ambient Background Studio

A browser-based generator for living website backgrounds (shader gradients, flow fields, particle meshes and film grain) that react gently to the cursor and export as a small, motion-safe HTML snippet.

**Beautiful, but responsible.** Every background ships with a static poster, pauses when it's off-screen or the tab is hidden, caps its frame rate, renders at reduced resolution and has a reduced-motion version by default. When looks and the budget disagree, the budget wins.

- **Studio** (`/`): live preview with a sample hero, control panel, performance meter, fallback simulations, WCAG contrast check, preset gallery and export.
- **Showcase** (`/showcase/`): a portfolio page where every hero section is a live exported background.
- **Runtime** (`packages/runtime`): zero dependencies, vanilla TypeScript, WebGL1 and Canvas 2D, tree-shaken per background type.

## Setup

Requires Node 22+ (tested on Node 24) and, for the end-to-end tests and poster rendering, an installed Google Chrome (Playwright drives it with `channel: 'chrome'`).

```bash
npm install
npm run dev          # studio at http://localhost:5173/, showcase at /showcase/
```

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server for the studio, showcase and the two developer pages |
| `npm run build` | Production build into `dist/studio/` |
| `npm run typecheck` | `tsc --noEmit`, strict |
| `npm test` | Vitest unit tests |
| `npm run test:e2e` | Playwright: exported snippets, presets and gallery, showcase (starts or reuses the dev server) |
| `npm run size` | Minified and gzipped size of each per-type snippet runtime, against the 8 KB budget |
| `npm run posters` | Renders each preset's poster to `apps/studio/public/posters/` (run after editing a preset) |

## Using the snippet

The Export dialog produces one self-contained block per background:

```html
<!-- Background made with Ambient Background Studio (free tier) -->
<div class="abs-bg" data-abs='{"type":"shader-gradient","colors":["#17110e","#33201a","#5e3a24","#241812"],"speed":0.45,…}' style="position:absolute;inset:0;…;background:radial-gradient(…)">
  <img class="abs-bg__poster" src="poster.webp" alt="" decoding="async" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
  <canvas class="abs-bg__canvas" aria-hidden="true"></canvas>
</div>
<script>/*! Ambient Background Studio · shader-gradient */(function(){…})();</script>
```

Paste it as the first thing inside the section it should fill. That section needs `position: relative`, and so does your content, so the content sits above the background.

- **No external requests.** The runtime is inline. The poster is your own hosted file, or an inline data URI.
- **No modules, no globals, no global CSS.** The script is a classic IIFE and injects only `.abs-bg*` rules.
- **Works with JavaScript off.** The wrapper and poster carry their layout as inline styles, and the wrapper carries the CSS gradient approximation.
- **Paste it as often as you like.** Each copy mounts the elements of its own type that aren't mounted yet.
- **Content Security Policy.** The inline script needs `script-src 'unsafe-inline'`, which CMS HTML blocks normally allow.

## Architecture

```
packages/runtime/
  types.ts              Config, Budget, FrameInput, Renderer, RendererDef
  core/
    config.ts           defaults, ranges, resolveConfig() (validates untrusted input, never throws)
    budget.ts           render scale, DPR cap, 1.5 MP pixel cap, particle cap, near-still fps
    scheduler.ts        rAF loop with an fps cap; stop() cancels the pending rAF (zero callbacks)
    detect.ts           decide(): the pure fallback decision; reduced-motion media query
    mount.ts            wires it together for one .abs-bg element; autoMount() for snippets
    pointer.ts          eased pointer, passive window listeners, idle drift after 3 s
    calm.ts             the calm master: one 0–1 value scales speed, turbulence, cursor, velocity
    styles.ts           the scoped .abs-bg stylesheet
  renderers/            shader-gradient.ts (WebGL), flow-field.ts, particle-mesh.ts (Canvas 2D)
  post/grain.ts         film grain: a CSS overlay on any type
  fallback/             css-gradient.ts (layered radial gradients), poster.ts (broken-poster guard)
  entries/              one snippet entry per type: autoMount([thatRenderer])
apps/studio/
  index.html, src/studio.ts      the studio
  src/ui/                        controls, meter, export dialog, preset gallery
  src/export/                    snippet builder (pure, tested), gzip size
  src/poster.ts                  poster capture (preview, export, presets)
  src/renderers.ts               the studio's list of types (renderer defs and names)
  showcase/, build/showcase.ts   the showcase page, generated from the presets at dev and build time
  public/posters/                preset posters + manifest (npm run posters)
presets/*.json                   one file per preset
scripts/                         runtime-build.mjs (per-type IIFE via Rolldown), size.mjs, posters.mjs
tests/e2e/                       Playwright
```

**Decision flow.** `mount()` runs it on load and again whenever an input changes: the reduced-motion preference, WebGL availability, or a lost context.

```
prefers-reduced-motion?  yes → poster frame (or the near-still version, per export)
  no → needs WebGL and none? yes → CSS gradient approximation
    no → animate, capped
         off-screen or tab hidden → paused (zero rAF), resume with no time jump
```

The poster is in the markup first, so there's no layout shift and no blank flash. The canvas fades in only after its first frame. A lost WebGL context falls back to the poster, and the background recovers if the browser restores the context.

**Renderers** implement one interface:

```ts
interface Renderer {
  init(canvas, config, budget): void;      // throw if the context isn't available
  frame(timeMs, input): void;              // input: eased pointer, presence, scroll
  resize(w, h): void;                      // backing-store pixels, already scaled by the budget
  setConfig(partial): void;                // live updates from the studio
  destroy(): void;
  particles?(): number;                    // for the performance meter
}
```

- **WebGL types** draw one full-screen quad. Every parameter arrives as a uniform.
- **Canvas 2D types** keep their state in preallocated `Float32Array`s and draw each frame in one pass, with no per-frame allocation. The particle mesh finds neighbours with a spatial grid.

**Per-type snippets.** `scripts/runtime-build.mjs` bundles each file in `packages/runtime/entries/` with Rolldown into a minified classic-script IIFE. It fails if the output contains anything that would break an inline `<script>`. The studio loads the result through a virtual module (`virtual:abs-runtimes`), so the Export dialog inlines exactly the code `npm run size` measures.

**Studio.** It's vanilla TypeScript with native inputs (keyboard support and labels come built in) and plain CSS with custom properties, in light and dark themes. The preview is the real runtime: the meter, the fallback simulations and the export all show what a visitor would get.
- **Live poster:** the preview wraps its renderer defs so the export can redraw the live shader frame at poster size.
- **Contrast check:** samples the poster pixels behind the headline's actual line boxes.

## Adding a background type

The runtime is built so that new types (aurora, topographic, dot grid wave, metaballs) are additions, not rewrites.

1. **Name it.** Add the name to the `BackgroundType` union in `packages/runtime/types.ts` and to `TYPES` in `core/config.ts`. If it needs new parameters, add them to `Config`, `DEFAULTS` and `RANGES`, so `resolveConfig()` validates them.
2. **Write the renderer.** Create `packages/runtime/renderers/<type>.ts` exporting a `RendererDef` (`{ type, webgl, create }`). Read the render scale and DPR from the `Budget` you're given. Route motion through `applyCalm()` so the calm slider and the near-still mode work. Don't allocate per frame. If `init` throws, the runtime falls back.
3. **Add the snippet entry.** Create `packages/runtime/entries/<type>.ts` calling `autoMount([yourDef])`. `npm run size`, the studio's export and its size display pick it up automatically.
4. **Fallback.** If the CSS approximation in `fallback/css-gradient.ts` doesn't suit the new look, give the type its own branch.
5. **Studio.** Add the def and display name to `apps/studio/src/renderers.ts` and a card to the type picker in `studio.ts`. If the cursor's soft-light mode behaves differently for the type, also update `LIGHT_LABEL` and `MODE_HINT`. Add the type's label in `apps/studio/build/showcase.ts`.
6. **Presets.** Add some to `presets/`, then run `npm run posters`. The preset tests check every file, the budget defaults and palette contrast, and fail on a stale poster.
7. **Tests.** Add the type to the `TYPES` list in `tests/e2e/snippet.spec.ts`. Its exported snippet then gets the render, reduced-motion, frame-rate cap and no-WebGL checks.

## Budget rules, measured

Measured on Windows 11 in headless Chrome 156 (ANGLE on Direct3D 11, NVIDIA RTX 5070 Ti desktop). This is faster than a mid-range laptop, so the frame times are also shown with Chrome's CPU throttled 4×. Frame time is CPU time per frame: simulation, drawing and draw-call submission. WebGL1 can't time the GPU without vendor extensions; GPU cost would show up as a lower frame rate.

| Rule | Default | Measured |
|---|---|---|
| Runtime per type, gzipped (target under ~8 KB) | one renderer per snippet | shader gradient **6.85 KB**, flow field **5.31 KB**, particle mesh **5.98 KB** |
| Whole snippet, hosted poster, gzipped | runtime + markup | 7.16 KB, 5.62 KB, 6.28 KB |
| Frame-rate cap | 30 fps | 29.9–30.2 fps per type in a blank page (Chrome fires rAF about 84 times a second here); 3 instances on one page total 89.9 |
| Reduced resolution | 0.5× of element size, upscaled by CSS | a 1032 × 686 preview renders at 516 × 343 |
| DPR cap | min(devicePixelRatio, 1.5) | a 2× screen renders at 0.75× (0.5 × 1.5): 1134 × 649 for a 1512 px wide preview |
| Pixel and particle caps | 1.5 MP backing store, 4,000 particles | always enforced |
| Off-screen or hidden tab | paused | **0 rAF callbacks** (snippet below the fold, scrolled away, hidden tab, showcase past every hero) |
| Reduced motion | poster frame | poster visible, canvas hidden, 0 rAF |
| No WebGL | CSS gradient | shader shows the gradient with 0 rAF; Canvas 2D types keep running; no console errors |

Frame times, one preset per type, in the studio preview:

| Preview | Type (preset) | CPU 1× avg / p95 | CPU 4× avg / p95 | FPS |
|---|---|---|---|---|
| 1440 × 900 at 1× | Shader gradient (Cognac) | 0.10 / 0.20 ms | 0.39 / 1.20 ms | 30 |
| | Flow field (Onyx and Gold, 969 lines) | 0.25 / 0.40 ms | 1.11 / 1.50 ms | 30 |
| | Particle mesh (Midnight Grid, 152 nodes) | 0.19 / 0.30 ms | 1.09 / 1.70 ms | 30 |
| 1920 × 1080 at 2× | Shader gradient | 0.11 / 0.20 ms | 0.45 / 0.80 ms | 30 |
| | Flow field (1,791 lines) | 0.34 / 0.60 ms | 1.49 / 2.20 ms | 30 |
| | Particle mesh (251 nodes) | 0.25 / 0.40 ms | 1.53 / 2.90 ms | 30 |

The 33 ms frame budget is never close: the worst p95 is 2.9 ms with the CPU slowed 4×.

**Posters.** These are WebP. Shader and mesh presets render at 1280 × 720 (4.5–10 KB). Flow fields render at 960 × 540 (45–71 KB), because fine trails compress poorly and the canvas renders at half size anyway. The 24 preset posters total 437 KB. In the Export dialog the default poster is 1280 wide, and it warns when a hosted poster passes 120 KB or an inlined one passes 64 KB.

**The gallery follows the rules too.** A thumbnail animates only while it's on screen or hovered or focused, with at most 8 at once. Each one is a real `mount()` that gets destroyed (renderer, WebGL context and listeners) when it stops. The rest show posters rendered at the thumbnail's own budget, and reduced motion turns every card into a poster.

## Presets

There are 24 presets in `presets/`, six per mood: Calm SaaS, Luxury, Playful and Dark tech. Each mood uses at least two types. Every file carries a name, a mood, the headline colour it was tuned for (`text`), a description and a full config.

The tests enforce the brief's tuning rules:
- **Budget defaults kept:** 30 fps, 0.5× render scale, DPR cap 1.5, poster for reduced motion.
- **Subtle motion:** speed ≤ 1, cursor strength ≤ 0.35, grain ≤ 0.3.
- **No garish palettes:** OKLCH chroma ≤ 0.15.
- **Contrast by palette:** at least 4.5:1 against every colour the background paints large areas with.

The end-to-end suite also renders each preset on the studio's sample hero and measures the headline. Across all 24, the lowest 5% of pixels give 8.79:1 to 18.82:1, so every preset passes AA for both large and body text.

## Decisions and deviations

- **Export posters.** For the shader gradient, the export poster is the frame on screen, redrawn at poster size without the cursor effect. Flow fields and particle meshes are simulations whose frame can't be redrawn at another size, so their poster is a freshly settled frame with the same settings and seed.
- **Contrast check.** It judges the lowest 5% of pixels behind the headline, not the average, and truncates ratios so a near miss never shows as a pass.
- **The studio's own reduced-motion setting.** If your system asks for reduced motion, the studio follows it: the preview and gallery start on posters, with an opt-out.
- **No `backdrop-filter`.** The meter and badge overlays don't use it, so they don't make the browser recomposite behind them on every frame.
- **Gallery thumbnails are miniature heroes.** They're laid out at twice the card size and scaled down. Particle counts and line spacing are set per CSS pixel, so a thumbnail at its own size would look nothing like the hero. At the default 0.5 render scale they still draw no more pixels than the card shows.
- **One rAF loop per instance.** Each instance runs its own loop, firing at the display's rate and skipping frames to hold the cap. Several instances on one page each make rAF calls while visible. A shared loop across instances would cut that and is a possible later optimisation.
- **Free tier.** There's no billing in v1: every export carries the credit comment, and the snippet builder takes a `credit` flag for later tiers.

## Not in v1 (extension points only)

- **More types** (aurora, topographic, dot grid wave, metaballs): see "Adding a background type".
- **Image palette extraction:** the palette input is a plain list of hex values, so an extractor only has to produce one.
- **Layering and blend modes:** grain already shows the overlay pattern, a layer on top of any type.
- **Scroll-linked colour:** `FrameInput.scroll` is already passed to every renderer.
- **Click ripples:** these would be another field on `FrameInput`.
- **Adaptive quality, per-device cost estimates, battery-saver mode:** these would plug into `computeBudget()`.
- **MP4/WebM export:** this would sit beside the poster capture.
- **Framer and Webflow components:** these would wrap `mount()`.

## Tests

- **Unit tests (Vitest):**
  - config validation and defaults, hex parsing, the calm mapping, simplex noise;
  - the fallback decision, the budget, the scheduler, CSS gradient generation;
  - contrast math and sampling, palette parsing;
  - the snippet builder (shape, escaping, sizes);
  - every preset file, and poster freshness.
- **End-to-end tests (Playwright), against the dev server:**
  - **Exported snippets in a blank page:** each type renders and moves, the poster shows under `reducedMotion: 'reduce'`, the poster shows without JavaScript, there are no requests apart from the poster, pasting twice works, there are 0 rAF off-screen or in a hidden tab, the 30 fps cap holds, and with WebGL disabled there are no console errors.
  - **Studio:** Copy puts the snippet on the clipboard.
  - **Presets and gallery:** the gallery's budget behaviour, picking presets by mouse and keyboard, and every preset's measured contrast.
  - **Showcase:** the off-screen pause, reduced motion and the no-JS path.
