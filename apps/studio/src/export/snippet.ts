/**
 * Builds the exported snippet: one self-contained HTML block per background.
 *
 *   <!-- credit (free tier) -->
 *   <div class="abs-bg" data-abs='{…}' style="…">     wrapper + CSS gradient
 *     <img class="abs-bg__poster" src="…" alt="" …>   poster frame
 *     <canvas class="abs-bg__canvas" aria-hidden="true"></canvas>
 *   </div>
 *   <script>(function(){…})();</script>             runtime for this type only
 *
 * Rules it keeps (they're what lets it run inside a locked-down CMS block):
 * - No external requests: the runtime is inline and the poster is either the
 *   user's own hosted file or an inline data URI.
 * - No modules and no globals: a classic script whose IIFE leaves nothing on
 *   `window`.
 * - No global CSS: the runtime injects only `.abs-bg*` rules. The no-JS path
 *   needs no stylesheet at all, because the wrapper and poster carry inline
 *   layout styles and the wrapper carries the CSS gradient.
 * - Paste it twice and both mount: each runtime copy mounts the elements of
 *   its type that aren't mounted yet and skips the rest.
 *
 * Pure string building, so it runs (and is tested) in Node.
 */
import type { Config } from '@abs/runtime/types';
import { DEFAULTS } from '@abs/runtime/core/config';
import { cssGradient } from '@abs/runtime/fallback/css-gradient';

export const CREDIT_COMMENT = '<!-- Background made with Ambient Background Studio (free tier) -->';

/** Layout the no-JS path needs; the runtime's scoped stylesheet repeats it. */
const WRAPPER_STYLE = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0';
const POSTER_STYLE = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';

const round = (v: number) => Math.round(v * 1000) / 1000;

/**
 * The config as the snippet carries it: `type` and `colors` always, every other
 * field only when it differs from the runtime's defaults. The runtime fills the
 * rest, and since each snippet ships its own runtime, its defaults never drift.
 */
export function snippetConfig(cfg: Config): Partial<Config> {
  const out: Record<string, unknown> = { type: cfg.type, colors: [...cfg.colors] };
  for (const key of Object.keys(DEFAULTS) as (keyof Config)[]) {
    if (key === 'type' || key === 'colors') continue;
    const v = cfg[key];
    const value = typeof v === 'number' ? round(v) : v;
    if (value !== DEFAULTS[key]) out[key] = value;
  }
  return out as Partial<Config>;
}

/** Escape for a double-quoted attribute value. */
export function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape for a single-quoted attribute value (the `data-abs` JSON). */
function escapeSingle(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface SnippetOptions {
  config: Config;
  /** Minified runtime for `config.type` (from `virtual:abs-runtimes`). */
  runtime: string;
  /** Poster URL or data URI. Empty: no poster, the CSS gradient covers the no-JS path. */
  posterSrc: string;
  /** Free tier: prepend the one-line credit comment. */
  credit: boolean;
}

export interface Snippet {
  html: string;
  /** UTF-8 bytes, split by part. `poster` counts only an inlined data URI. */
  bytes: { total: number; runtime: number; poster: number; markup: number };
}

const utf8 = (s: string) => new TextEncoder().encode(s).length;

export function buildSnippet(o: SnippetOptions): Snippet {
  if (/<\/script|<!--|<script/i.test(o.runtime)) throw new Error('runtime contains a sequence that breaks an inline <script>');
  const json = escapeSingle(JSON.stringify(snippetConfig(o.config)));
  const style = escapeAttr(`${WRAPPER_STYLE};background:${cssGradient(o.config)}`);
  const src = o.posterSrc.trim();
  const lines = [
    o.credit ? CREDIT_COMMENT : null,
    `<div class="abs-bg" data-abs='${json}' style="${style}">`,
    src ? `  <img class="abs-bg__poster" src="${escapeAttr(src)}" alt="" decoding="async" style="${POSTER_STYLE}">` : null,
    `  <canvas class="abs-bg__canvas" aria-hidden="true"></canvas>`,
    `</div>`,
    `<script>/*! Ambient Background Studio · ${o.config.type} */${o.runtime}</script>`,
  ];
  const html = lines.filter((l) => l !== null).join('\n');
  const total = utf8(html);
  const runtime = utf8(o.runtime);
  const poster = src.startsWith('data:') ? utf8(src) : 0;
  return { html, bytes: { total, runtime, poster, markup: total - runtime - poster } };
}

/** File name for a poster in the given format. */
export function posterFileName(format: PosterFormat): string {
  return format === 'png' ? 'poster.png' : 'poster.webp';
}

export type PosterFormat = 'webp' | 'png';
