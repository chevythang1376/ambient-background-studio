/**
 * Export dialog: poster capture at export size, the per-type snippet in a
 * copyable code panel, and its size against the budget.
 *
 * Every option change rebuilds the snippet from the same captured frame;
 * only "Capture again" and a size change take a new frame. Work is async
 * (encoding, data URI, gzip), so each run carries a generation number and a
 * stale run never overwrites a newer one. `data-ready` on the dialog marks
 * when the code panel and the sizes are final (automated checks wait on it).
 */
import type { BackgroundType, Config, RendererDef } from '@abs/runtime/types';
import { STILL_FPS } from '@abs/runtime/core/budget';
import runtimes from 'virtual:abs-runtimes';
import { buildSnippet, posterFileName, type PosterFormat, type Snippet } from '../export/snippet';
import { formatSize, gzipSize } from '../export/gzip';
import { blobToDataUrl, capturePoster, encodeCanvas, type LiveRenderer, type PosterSource } from '../poster';
import { choice, h, hint, toggle, uidFor } from './controls';

/**
 * Poster sizes (16:9). The default is 1280: at the default render scale the
 * canvas draws a 1600 px hero at 800–1200 px, so a bigger poster would be
 * sharper than the animation it stands in for, and only heavier.
 */
const SIZES = { '960': [960, 540], '1280': [1280, 720], '1600': [1600, 900], '1920': [1920, 1080] } as const;
type SizeKey = keyof typeof SIZES;
const DEFAULT_SIZE: SizeKey = '1280';
const WEBP_QUALITY = 0.8;
/** Above this, an inline poster costs more than it saves: say so. */
const INLINE_WARN = 64 * 1024;
/** Above this, a hosted poster is heavy for a background image. */
const HOSTED_WARN = 120 * 1024;
const RUNTIME_BUDGET = 8 * 1024;

export interface ExportDeps {
  config(): Config;
  /** The unwrapped renderer def, for fresh renders. */
  def(type: BackgroundType): RendererDef;
  live(): LiveRenderer | null;
  typeName(type: BackgroundType): string;
}

export function createExport(deps: ExportDeps): { dialog: HTMLDialogElement; open(): void } {
  const opts = { format: 'webp' as PosterFormat, size: DEFAULT_SIZE, inline: false, url: posterFileName('webp'), urlEdited: false };
  const posterCanvas = document.createElement('canvas');
  let cfg: Config = deps.config();
  let source: PosterSource | null = null;
  let blob: Blob | null = null;
  let blobUrl = '';
  let dataUrl: string | null = null;
  let webpFailed = false;
  let snippet: Snippet | null = null;
  let gen = 0;

  // ── Poster column ─────────────────────────────────────────────────────────
  const preview = h('img', { class: 'export__poster', alt: 'Poster frame', decoding: 'async' });
  const posterMeta = h('p', { class: 'export__meta' });
  const sourceNote = hint('');
  const format = choice<PosterFormat>({
    legend: 'Format',
    options: [
      { value: 'webp', label: 'WebP' },
      { value: 'png', label: 'PNG' },
    ],
    get: () => opts.format,
    onChange: (v) => {
      opts.format = v;
      if (!opts.urlEdited) {
        opts.url = posterFileName(v);
        urlInput.value = opts.url;
      }
      void encode();
    },
    hint: 'WebP is a fraction of the size and looks the same on soft backgrounds. PNG is lossless.',
  });
  const size = choice<SizeKey>({
    legend: 'Size',
    options: (Object.keys(SIZES) as SizeKey[]).map((k) => ({ value: k, label: `${SIZES[k][0]}` })),
    get: () => opts.size,
    onChange: (v) => {
      opts.size = v;
      void capture();
    },
    hint: 'Width in px, 16:9. On the page it covers the section and crops to fit. The canvas renders at half size by default, so 1280 is as sharp as the animation.',
  });
  const inline = toggle({
    label: 'Inline the poster as a data URI',
    get: () => opts.inline,
    onChange: (v) => {
      opts.inline = v;
      urlInput.disabled = v;
      void render();
    },
    hint: 'One self-contained block with nothing to host, but the image can’t be cached apart from the page.',
  });
  const urlId = uidFor('url');
  const urlInput = h('input', { type: 'text', id: urlId, class: 'export__url', spellcheck: 'false', autocomplete: 'off', 'aria-describedby': `${urlId}-hint` });
  urlInput.value = opts.url;
  urlInput.addEventListener('input', () => {
    opts.url = urlInput.value;
    opts.urlEdited = true;
    void render();
  });
  const urlField = h(
    'div',
    { class: 'field' },
    h('div', { class: 'field__row' }, h('label', { for: urlId }, 'Poster file URL')),
    urlInput,
    hint('Upload the poster file, then put its address here.', `${urlId}-hint`),
  );
  const download = h('a', { class: 'btn', download: posterFileName('webp') }, 'Download poster');
  const again = h('button', { type: 'button', class: 'btn' }, 'Capture again');
  again.addEventListener('click', () => void capture());

  // ── Snippet column ────────────────────────────────────────────────────────
  const codeId = uidFor('code');
  const code = h('textarea', { id: codeId, class: 'export__code', readonly: true, spellcheck: 'false', wrap: 'soft', rows: 14 });
  const gz = h('p', { class: 'export__gz' }, '—');
  const raw = h('p', { class: 'export__raw' });
  const budget = h('span', { class: 'pill' });
  const warn = h('p', { class: 'hint hint--msg' });
  const copyBtn = h('button', { type: 'button', class: 'btn btn--primary', autofocus: true }, 'Copy snippet');
  const copyStatus = h('p', { class: 'export__status', role: 'status' });
  copyBtn.addEventListener('click', () => void copy());
  const motionNote = h('li');

  const title = h('h2', { id: uidFor('export') }, 'Export');
  const dialog = h(
    'dialog',
    { class: 'export', 'aria-labelledby': title.id, 'data-ready': 'false' },
    h(
      'div',
      { class: 'export__head' },
      title,
      h('form', { method: 'dialog' }, h('button', { class: 'btn', value: 'close' }, 'Close')),
    ),
    h(
      'div',
      { class: 'export__body' },
      // Snippet first: it's what people came for, and on a phone it shouldn't sit below every option.
      h(
        'section',
        { class: 'export__main', 'aria-label': 'Snippet' },
        h('div', { class: 'export__sizes' }, h('div', null, h('h3', null, 'Snippet'), gz, raw, h('div', { class: 'pills' }, budget)), h('div', { class: 'export__copy' }, copyBtn, copyStatus)),
        warn,
        h('label', { for: codeId, class: 'sr-only' }, 'Snippet code'),
        code,
        h(
          'ul',
          { class: 'export__how' },
          h('li', null, 'Paste it as the first thing inside the section it should fill. Give that section ', h('code', null, 'position: relative'), ', and your content too, so the content sits above the background.'),
          h('li', null, 'It needs nothing else: no external files apart from the poster, no modules, no global CSS. Paste it more than once and every copy runs.'),
          motionNote,
          h('li', null, 'Free tier: the first line is a small credit comment.'),
        ),
      ),
      h(
        'section',
        { class: 'export__side', 'aria-label': 'Poster' },
        h('h3', null, 'Poster frame'),
        h('div', { class: 'export__frame' }, preview),
        posterMeta,
        sourceNote,
        h('div', { class: 'inline' }, download, again),
        format.root,
        size.root,
        inline.root,
        urlField,
      ),
    ),
  );
  dialog.addEventListener('close', () => (copyStatus.textContent = ''));

  // ── Pipeline: capture → encode → render ───────────────────────────────────
  async function capture() {
    const [w, hgt] = SIZES[opts.size];
    source = capturePoster(deps.def(cfg.type), cfg, w, hgt, deps.live(), posterCanvas);
    const name = deps.typeName(cfg.type);
    sourceNote.textContent =
      source === 'frame'
        ? `The frame on screen now, redrawn at ${w} × ${hgt} without the cursor effect.`
        : source === 'render'
          ? deps.def(cfg.type).webgl
            ? `The preview isn’t animating, so this is a fresh frame with the same settings at ${w} × ${hgt}.`
            : `${name} simulates its ${cfg.type === 'flow-field' ? 'lines' : 'dots'}, so the poster is a freshly settled frame with the same settings and seed at ${w} × ${hgt}. They sit in different places than in the preview.`
          : 'This browser can’t render the poster (no WebGL). The snippet still works: the CSS gradient stands in.';
    await encode();
  }

  async function encode() {
    const run = ++gen;
    setReady(false);
    blob = null;
    dataUrl = null;
    if (source) {
      const type = opts.format === 'png' ? 'image/png' : 'image/webp';
      let b = await encodeCanvas(posterCanvas, type, opts.format === 'webp' ? WEBP_QUALITY : undefined);
      webpFailed = !b && opts.format === 'webp';
      if (webpFailed) b = await encodeCanvas(posterCanvas, 'image/png');
      if (run !== gen) return;
      blob = b;
    }
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = blob ? URL.createObjectURL(blob) : '';
    preview.src = blobUrl;
    preview.hidden = !blob;
    download.hidden = !blob;
    const file = blob?.type === 'image/png' ? posterFileName('png') : posterFileName('webp');
    download.href = blobUrl;
    download.download = file;
    download.textContent = `Download ${file}`;
    const [w, hgt] = SIZES[opts.size];
    posterMeta.textContent = blob ? `${file} · ${w} × ${hgt} · ${formatSize(blob.size)}${webpFailed ? ' · PNG, as this browser can’t encode WebP' : ''}` : 'No poster';
    await render(run);
  }

  async function render(run = ++gen) {
    setReady(false);
    if (opts.inline && blob && !dataUrl) {
      const url = await blobToDataUrl(blob);
      if (run !== gen) return;
      dataUrl = url;
    }
    const src = !blob ? '' : opts.inline ? dataUrl! : opts.url;
    snippet = buildSnippet({ config: cfg, runtime: runtimes[cfg.type].code, posterSrc: src, credit: true });
    code.value = snippet.html;
    const b = snippet.bytes;
    raw.textContent = `${formatSize(b.total)} raw: runtime ${formatSize(b.runtime)}, markup ${formatSize(b.markup)}${b.poster ? `, inline poster ${formatSize(b.poster)}` : ''}.`;
    const rt = runtimes[cfg.type].gzip;
    budget.textContent = `${rt <= RUNTIME_BUDGET ? '✓' : '✕'} Runtime ${formatSize(rt)} of the ${formatSize(RUNTIME_BUDGET).replace('.00', '')} budget`;
    budget.dataset.pass = String(rt <= RUNTIME_BUDGET);
    warn.textContent =
      b.poster > INLINE_WARN
        ? `The inline poster adds ${formatSize(b.poster)}. Host the file instead, or pick ${opts.format === 'png' ? 'WebP or ' : ''}a smaller size.`
        : !opts.inline && blob && blob.size > HOSTED_WARN
          ? `A ${formatSize(blob.size)} poster is heavy for a background. ${blob.type === 'image/png' ? 'WebP looks the same here at a fraction of the size.' : 'A smaller size cuts it, and the canvas renders at half size anyway.'}`
          : !opts.inline && blob && !opts.url.trim()
          ? 'With no poster URL, the snippet has no poster: the CSS gradient covers reduced motion and the no-JS path.'
          : '';
    gz.textContent = '…';
    const g = await gzipSize(snippet.html);
    if (run !== gen) return;
    gz.textContent = g == null ? `${formatSize(b.total)} (gzip size unavailable here)` : `${formatSize(g)} gzipped`;
    gz.dataset.bytes = String(g ?? '');
    setReady(true);
  }

  function setReady(v: boolean) {
    dialog.dataset.ready = String(v);
    code.setAttribute('aria-busy', String(!v));
  }

  async function copy() {
    if (!snippet) return;
    let ok = false;
    try {
      await navigator.clipboard.writeText(snippet.html);
      ok = true;
    } catch {
      code.focus();
      code.select();
      ok = document.execCommand('copy');
    }
    copyStatus.textContent = ok ? 'Copied to the clipboard.' : 'Couldn’t copy. Select the code and copy it by hand.';
  }

  return {
    dialog,
    open() {
      cfg = deps.config();
      title.textContent = `Export · ${deps.typeName(cfg.type)}`;
      const reduced =
        cfg.reducedMotion === 'poster'
          ? 'Visitors who ask for reduced motion see the poster frame.'
          : `Visitors who ask for reduced motion see the near-still version at ${STILL_FPS} fps.`;
      const noGL = deps.def(cfg.type).webgl
        ? 'Without WebGL it shows the CSS gradient.'
        : 'It draws with Canvas 2D, so it also runs without WebGL.';
      motionNote.textContent = `${reduced} ${noGL}`;
      for (const c of [format, size, inline]) c.sync();
      urlInput.disabled = opts.inline;
      copyStatus.textContent = '';
      if (!dialog.open) dialog.showModal();
      void capture();
    },
  };
}
