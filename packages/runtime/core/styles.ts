/**
 * Scoped base styles. Only `.abs-bg*` selectors: safe inside a locked-down CMS.
 * Injected once per page, however many snippets run. The no-JS path doesn't
 * need it: the exported wrapper and poster carry their layout as inline styles.
 *
 * Layering, bottom to top: wrapper background (CSS gradient approximation) →
 * poster image → canvas (fades in after its first frame) → grain.
 */
export const BASE_CSS =
  '.abs-bg{position:absolute;inset:0;overflow:hidden;pointer-events:none;isolation:isolate;z-index:0}' +
  '.abs-bg>*{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;user-select:none}' +
  '.abs-bg__poster{display:block;object-fit:cover}' +
  '.abs-bg__canvas{display:block;opacity:0;transition:opacity .6s ease}' +
  '.abs-bg--live>.abs-bg__canvas{opacity:1}' +
  // Once the canvas has faded in, stop compositing the poster underneath it.
  '.abs-bg--live>.abs-bg__poster{visibility:hidden;transition:visibility 0s .6s}' +
  '.abs-bg--css>.abs-bg__poster{display:none}' +
  '.abs-bg__grain{inset:-128px;width:auto;height:auto;mix-blend-mode:overlay;will-change:transform}' +
  '@media (prefers-reduced-motion:reduce){.abs-bg__canvas{transition:none}}';

export function ensureStyles(doc: Document = document): void {
  if (doc.getElementById('abs-bg-css')) return;
  const style = doc.createElement('style');
  style.id = 'abs-bg-css';
  style.textContent = BASE_CSS;
  doc.head.append(style);
}
