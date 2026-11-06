/**
 * Poster frame handling. The poster `<img>` is in the markup from the start (no
 * layout shift, no blank flash); this only makes sure a broken or missing
 * poster gives way to the CSS gradient behind it instead of a broken-image icon.
 */
export function guardPoster(el: HTMLElement): HTMLImageElement | null {
  const img = el.querySelector<HTMLImageElement>('.abs-bg__poster');
  if (!img) return null;
  const drop = () => img.remove();
  if (!img.getAttribute('src') || (img.complete && !img.naturalWidth)) {
    drop();
    return null;
  }
  img.addEventListener('error', drop, { once: true });
  return img;
}
