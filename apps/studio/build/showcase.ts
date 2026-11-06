/**
 * Builds the /showcase page's hero sections from the preset files, at dev and
 * build time, so the page ships as static, snippet-shaped HTML: each hero is
 * an `.abs-bg` wrapper with the CSS gradient inline, the preset's hosted poster
 * and a canvas. With no JavaScript every hero still shows its poster.
 */
import { runnerImport, type Plugin } from 'vite';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildAllRuntimes } from '../../../scripts/runtime-build.mjs';

const PRESET_DIR = fileURLToPath(new URL('../../../presets/', import.meta.url));
const CSS_GRADIENT = fileURLToPath(new URL('../../../packages/runtime/fallback/css-gradient.ts', import.meta.url));

/** The fields of a runtime config this page reads (the full config passes through as JSON). */
interface Config {
  type: string;
  colors: string[];
  seed: number;
}
type CssGradient = (cfg: Config) => string;
let gradient: Promise<CssGradient> | null = null;

/**
 * The runtime's CSS gradient, loaded through Vite's module runner when the page
 * is requested, so the runtime's sources never get bundled into the config.
 */
function loadGradient(): Promise<CssGradient> {
  gradient ??= runnerImport<{ cssGradient: CssGradient }>(CSS_GRADIENT, { configFile: false, logLevel: 'error' }).then((r) => r.module.cssGradient);
  return gradient;
}

interface PresetFile {
  name: string;
  mood: string;
  text: string;
  description: string;
  config: Config;
}

interface Hero {
  preset: string;
  layout: 'left' | 'center';
  eyebrow: string;
  title: string;
  sub: string;
  /** Real links (intro), or a decorative call to action (sample brands). */
  actions?: { label: string; href: string }[];
  cta?: string;
}

const MOOD_LABELS: Record<string, string> = { 'calm-saas': 'Calm SaaS', luxury: 'Luxury', playful: 'Playful', 'dark-tech': 'Dark tech' };
const TYPE_LABELS: Record<string, string> = { 'shader-gradient': 'Shader gradient', 'flow-field': 'Flow field', 'particle-mesh': 'Particle mesh' };

/** The page, top to bottom. Brands are fictional. */
const HEROES: Hero[] = [
  {
    preset: 'deep-field',
    layout: 'center',
    eyebrow: 'Ambient Background Studio',
    title: 'Backgrounds that move, and know when to stop.',
    sub: 'Every section on this page is a live background exported from the studio. Each one pauses when you scroll past, caps itself at 30 frames a second, and becomes a still poster for anyone who prefers reduced motion.',
    actions: [
      { label: 'Open the studio', href: '../' },
      { label: 'Browse the presets', href: '../?view=presets' },
    ],
  },
  { preset: 'morning-mist', layout: 'left', eyebrow: 'Fieldnote', title: 'Notes that file themselves.', sub: 'Write in one place. Fieldnote tags, links and sorts as you go, so the right note is there when you need it.', cta: 'Start free' },
  { preset: 'soft-network', layout: 'center', eyebrow: 'Ledgerline', title: 'Every account, finally in one place.', sub: 'Connect your banks and cards once. Ledgerline reconciles overnight and flags only what needs a person.', cta: 'Book a demo' },
  { preset: 'cognac', layout: 'left', eyebrow: 'Maison Arden', title: 'Leather goods, made slowly.', sub: 'Each bag is cut, stitched and burnished by one artisan in our Florence workshop. Expect to keep it for decades.', cta: 'Explore the collection' },
  { preset: 'onyx-gold', layout: 'center', eyebrow: 'Atelier Nord', title: 'Fine jewellery in recycled gold.', sub: 'Small pieces, made to order in Copenhagen, with every stone traced to the mine.', cta: 'View the pieces' },
  { preset: 'sherbet', layout: 'left', eyebrow: 'Pip', title: 'Saving money, but make it fun.', sub: 'Set a goal, round up your spending and watch the jar fill. Pip celebrates every small win with you.', cta: 'Get the app' },
  { preset: 'confetti-drift', layout: 'center', eyebrow: 'Kindred', title: 'Group trips, planned together.', sub: 'One shared board for dates, budgets and ideas. Everyone votes; nobody chases.', cta: 'Plan a trip' },
  { preset: 'signal', layout: 'left', eyebrow: 'Relay', title: 'See every event, from producer to sink.', sub: 'Trace messages across queues and services in real time, with alerts that fire before your customers notice.', cta: 'Start tracing' },
  { preset: 'midnight-grid', layout: 'center', eyebrow: 'Lattice', title: 'Private networking for distributed teams.', sub: 'Connect every laptop, server and cluster over an encrypted mesh. No VPN boxes, no open ports.', cta: 'Read the docs' },
];

const WRAPPER_STYLE = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0';
const POSTER_STYLE = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escSingle = (s: string) => s.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/</g, '&lt;');

function loadPresets(): Record<string, PresetFile> {
  return Object.fromEntries(
    readdirSync(PRESET_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(PRESET_DIR + f, 'utf8')) as PresetFile]),
  );
}

function hero(h: Hero, p: PresetFile, index: number, cssGradient: CssGradient): string {
  const first = index === 0;
  const onInk = p.text === '#ffffff' ? '#111111' : '#ffffff';
  const titleTag = first ? 'h1' : 'h2';
  const id = `hero-${h.preset}`;
  const actions = h.actions
    ? `<p class="sc-actions">${h.actions.map((a, i) => `<a class="sc-btn${i ? ' sc-btn--quiet' : ''}" href="${esc(a.href)}">${esc(a.label)}</a>`).join('')}</p>`
    : `<p class="sc-actions"><span class="sc-btn" aria-hidden="true">${esc(h.cta ?? '')}</span></p>`;
  return `
<section class="sc-hero sc-hero--${h.layout}" style="--ink:${p.text};--on-ink:${onInk}" aria-labelledby="${id}" data-preset="${h.preset}">
  <div class="abs-bg" data-abs='${escSingle(JSON.stringify(p.config))}' style="${WRAPPER_STYLE};background:${cssGradient(p.config)}">
    <img class="abs-bg__poster" src="/posters/${h.preset}.webp" alt="" decoding="async"${first ? ' fetchpriority="high"' : ' loading="lazy"'} style="${POSTER_STYLE}">
    <canvas class="abs-bg__canvas" aria-hidden="true"></canvas>
  </div>
  <div class="sc-hero__inner">
    <p class="sc-eyebrow">${esc(h.eyebrow)}</p>
    <${titleTag} class="sc-title" id="${id}">${esc(h.title)}</${titleTag}>
    <p class="sc-sub">${esc(h.sub)}</p>
    ${actions}
  </div>
  <p class="sc-credit">${esc(p.name)} · ${MOOD_LABELS[p.mood]} · ${TYPE_LABELS[p.config.type]} <a href="../?preset=${h.preset}">Open in the studio</a></p>
</section>`;
}

function presetIndex(presets: Record<string, PresetFile>): string {
  return Object.entries(MOOD_LABELS)
    .map(([mood, label]) => {
      const items = Object.entries(presets)
        .filter(([, p]) => p.mood === mood)
        .sort(([, a], [, b]) => a.name.localeCompare(b.name))
        .map(([id, p]) => `<li><a href="../?preset=${id}">${esc(p.name)}</a> <span>${TYPE_LABELS[p.config.type]}</span></li>`)
        .join('');
      return `<div class="sc-mood"><h3>${label}</h3><ul>${items}</ul></div>`;
    })
    .join('');
}

async function budget(): Promise<string> {
  const built = await buildAllRuntimes();
  const kb = (n: number) => (n / 1024).toFixed(2);
  return Object.entries(built)
    .map(([type, r]) => `<li><span>${TYPE_LABELS[type] ?? type}</span> <strong>${kb(r.gzip)} KB</strong> gzipped</li>`)
    .join('');
}

/** `/showcase` → `/showcase/`, so the page's relative links resolve (static hosts do this too). */
function redirect(req: { url?: string }, res: { statusCode: number; setHeader(k: string, v: string): void; end(): void }, next: () => void) {
  const [path, query] = (req.url ?? '').split('?');
  if (path !== '/showcase') return next();
  res.statusCode = 301;
  res.setHeader('Location', `/showcase/${query ? `?${query}` : ''}`);
  res.end();
}

export function showcase(): Plugin {
  return {
    name: 'abs-showcase',
    configureServer: (server) => void server.middlewares.use(redirect),
    configurePreviewServer: (server) => void server.middlewares.use(redirect),
    transformIndexHtml: {
      order: 'pre',
      async handler(html, ctx) {
        if (!ctx.filename.replace(/\\/g, '/').endsWith('/showcase/index.html')) return;
        const presets = loadPresets();
        const cssGradient = await loadGradient();
        const missing = HEROES.filter((h) => !presets[h.preset]).map((h) => h.preset);
        if (missing.length) throw new Error(`showcase: unknown presets ${missing.join(', ')}`);
        return html
          .replace('<!-- abs:heroes -->', HEROES.map((h, i) => hero(h, presets[h.preset]!, i, cssGradient)).join('\n'))
          .replace('<!-- abs:presets -->', presetIndex(presets))
          .replace('<!-- abs:count -->', String(Object.keys(presets).length))
          .replace('<!-- abs:hero-count -->', String(HEROES.length))
          .replace('<!-- abs:budget -->', await budget());
      },
    },
  };
}
