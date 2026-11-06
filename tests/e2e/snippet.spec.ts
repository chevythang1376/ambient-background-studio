/**
 * Exported-snippet smoke test.
 *
 * `beforeAll` exports one snippet per background type from the studio, through
 * the real export dialog: once with the poster inlined as a data URI, once
 * pointing at a hosted `poster.webp` (with that file's bytes). Each test then
 * loads a snippet into a blank page on a fake origin (`http://abs.test/`) that
 * serves nothing else, so any request the snippet makes shows up.
 *
 * Counters come from an init script: rAF callbacks, and frames (the runtime
 * reads the wrapper's bounding box once per rendered frame, nowhere else).
 */
import { chromium, expect, test, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';

const STUDIO = 'http://localhost:5173/';
const SITE = 'http://abs.test/';
const VIEWPORT = { width: 1280, height: 720 };
const TYPES = [
  ['shader-gradient', 'Shader gradient'],
  ['flow-field', 'Flow field'],
  ['particle-mesh', 'Particle mesh'],
] as const;
type Type = (typeof TYPES)[number][0];

interface Exported {
  /** Poster inlined as a data URI. */
  inline: string;
  /** Poster at `poster.webp`. */
  hosted: string;
  poster: Buffer;
}
const exported = {} as Record<Type, Exported>;

test.describe.configure({ mode: 'serial' });

// ── Export through the studio ───────────────────────────────────────────────
test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(STUDIO);
  const dialog = page.locator('dialog.export');
  const code = dialog.getByLabel('Snippet code');
  const inlineSwitch = dialog.getByRole('switch', { name: 'Inline the poster as a data URI' });
  for (const [type, name] of TYPES) {
    await page.getByText(name, { exact: true }).click();
    await page.waitForFunction(
      (t) => {
        const s = (window as unknown as { __studio: { config: { type: string }; preview: { state: string } } }).__studio;
        return s.config.type === t && s.preview.state === 'animate';
      },
      type,
    );
    await page.waitForTimeout(1000); // let it run, so the poster is a frame from the middle of the motion
    await page.locator('#export').click();
    await expect(dialog).toHaveAttribute('data-ready', 'true');
    const hosted = await code.inputValue();
    const poster = await dialog.locator('a[download]').evaluate(async (a: HTMLAnchorElement) => {
      const blob = await (await fetch(a.href)).blob();
      return new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1]!);
        r.readAsDataURL(blob);
      });
    });
    await inlineSwitch.check();
    await expect(dialog).toHaveAttribute('data-ready', 'true');
    const inline = await code.inputValue();
    await inlineSwitch.uncheck();
    await dialog.getByRole('button', { name: 'Close' }).click();
    exported[type] = { inline, hosted, poster: Buffer.from(poster, 'base64') };
  }
  await page.close();
});

// ── Helpers ─────────────────────────────────────────────────────────────────
interface Site {
  page: Page;
  /** Requests other than the page itself. */
  requests: string[];
  errors: string[];
  close(): Promise<void>;
}

/** A blank page whose body is `body`, served from a fake origin. */
async function openSite(browser: Browser, body: string, options: BrowserContextOptions = {}, poster?: Buffer): Promise<Site> {
  const ctx = await browser.newContext({ viewport: VIEWPORT, ...options });
  const page = await ctx.newPage();
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', (r) => r.url() !== SITE && requests.push(r.url()));
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const w = window as unknown as { __raf: number; __frames: number; __keys: string[] };
    w.__raf = 0;
    w.__frames = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((t) => (w.__raf++, cb(t)));
    const rect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.classList.contains('abs-bg')) w.__frames++;
      return rect.call(this);
    };
    w.__keys = Object.keys(window);
  });
  await ctx.route('**/*', (route) => {
    const url = route.request().url();
    if (url === SITE) {
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Snippet</title></head><body style="margin:0">${body}</body></html>` });
    }
    if (url === `${SITE}poster.webp` && poster) return route.fulfill({ contentType: 'image/webp', body: poster });
    return route.abort();
  });
  await page.goto(SITE);
  return { page, requests, errors, close: () => ctx.close() };
}

/** Per-second rate of an init-script counter over `ms`. */
function rate(page: Page, counter: '__raf' | '__frames', ms = 2000): Promise<number> {
  return page.evaluate(
    async ([key, ms]) => {
      const w = window as unknown as Record<string, number>;
      const n0 = w[key]!;
      const t0 = performance.now();
      await new Promise((r) => setTimeout(r, ms));
      return ((w[key]! - n0) * 1000) / (performance.now() - t0);
    },
    [counter, ms] as const,
  );
}

/** Luminance spread (std dev, 0–255) of each screenshot, and the mean per-pixel change between the first two. */
async function pixels(page: Page, shots: Buffer[]): Promise<{ spread: number[]; change: number }> {
  return page.evaluate(async (b64s) => {
    const lum = await Promise.all(
      b64s.map(async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; // full resolution: thin lines would average away
        c.height = img.naturalHeight;
        const x = c.getContext('2d')!;
        x.drawImage(img, 0, 0, c.width, c.height);
        const d = x.getImageData(0, 0, c.width, c.height).data;
        const out = new Float32Array(d.length / 4);
        for (let i = 0; i < out.length; i++) out[i] = 0.2126 * d[i * 4]! + 0.7152 * d[i * 4 + 1]! + 0.0722 * d[i * 4 + 2]!;
        return out;
      }),
    );
    const spread = lum.map((l) => {
      const mean = l.reduce((a, b) => a + b, 0) / l.length;
      return Math.sqrt(l.reduce((a, b) => a + (b - mean) ** 2, 0) / l.length);
    });
    let change = 0;
    if (lum.length > 1) {
      for (let i = 0; i < lum[0]!.length; i++) change += Math.abs(lum[0]![i]! - lum[1]![i]!);
      change /= lum[0]!.length;
    }
    return { spread, change };
  }, shots.map((s) => s.toString('base64')));
}

const posterState = (page: Page) =>
  page.locator('.abs-bg__poster').first().evaluate((img: HTMLImageElement) => {
    const cs = getComputedStyle(img);
    const r = img.getBoundingClientRect();
    return { loaded: img.complete && img.naturalWidth > 0, natural: [img.naturalWidth, img.naturalHeight], visible: cs.visibility === 'visible' && cs.display !== 'none', box: [r.width, r.height] };
  });

// ── Smoke: renders, and the poster under reduced motion ─────────────────────
for (const [type] of TYPES) {
  test(`${type}: the exported snippet renders its canvas in a blank page`, async ({ browser }) => {
    const site = await openSite(browser, exported[type].inline);
    const { page } = site;
    const bg = page.locator('.abs-bg');
    await expect(bg).toHaveClass(/abs-bg--live/);
    const canvas = await page.locator('canvas.abs-bg__canvas').evaluate((c: HTMLCanvasElement) => ({ w: c.width, h: c.height, opacity: getComputedStyle(c).opacity }));
    expect(canvas.w).toBeGreaterThan(0);
    await page.waitForTimeout(800); // canvas fade-in
    expect((await posterState(page)).visible).toBe(false); // the canvas has taken over
    const a = await page.screenshot();
    await page.waitForTimeout(1000);
    const b = await page.screenshot();
    const px = await pixels(page, [a, b]);
    expect(px.spread[0]).toBeGreaterThan(1); // not a flat colour (line art on a dark ground is sparse)
    expect(px.change).toBeGreaterThan(0.05); // and moving
    const leaked = await page.evaluate(() => {
      const w = window as unknown as { __keys: string[] };
      return Object.keys(window).filter((k) => !w.__keys.includes(k) && k !== '__keys');
    });
    expect(leaked).toEqual([]); // no globals
    expect(site.requests).toEqual([]); // no external requests
    expect(site.errors).toEqual([]);
    console.log(`  ${type}: canvas ${canvas.w}×${canvas.h}, spread ${px.spread[0]!.toFixed(1)}, change/s ${px.change.toFixed(2)}`);
    await site.close();
  });

  test(`${type}: the poster shows under reducedMotion: 'reduce'`, async ({ browser }) => {
    const site = await openSite(browser, exported[type].inline, { reducedMotion: 'reduce' });
    const { page } = site;
    await page.waitForTimeout(600);
    const bg = page.locator('.abs-bg');
    await expect(bg).not.toHaveClass(/abs-bg--live|abs-bg--css/);
    const poster = await posterState(page);
    expect(poster.loaded).toBe(true);
    expect(poster.visible).toBe(true);
    expect(poster.box).toEqual([VIEWPORT.width, VIEWPORT.height]);
    expect(await page.locator('canvas.abs-bg__canvas').evaluate((c) => getComputedStyle(c).opacity)).toBe('0');
    expect(await rate(page, '__raf', 1000)).toBe(0);
    const px = await pixels(page, [await page.screenshot()]);
    expect(px.spread[0]).toBeGreaterThan(1);
    expect(site.errors).toEqual([]);
    await site.close();
  });
}

// ── The studio's copy button ────────────────────────────────────────────────
test('Copy snippet puts exactly the code panel on the clipboard', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  await page.goto(STUDIO);
  await page.locator('#export').click();
  const dialog = page.locator('dialog.export');
  await expect(dialog).toHaveAttribute('data-ready', 'true');
  await expect(dialog.getByRole('button', { name: 'Copy snippet' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Copy snippet' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Copied to the clipboard.');
  // Windows stores clipboard text with CRLF; the HTML parser turns CRLF back into LF on paste.
  const clip = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
  expect(clip).toBe(await dialog.getByLabel('Snippet code').inputValue());
  expect(clip.startsWith('<!-- Background made with Ambient Background Studio (free tier) -->\n<div class="abs-bg"')).toBe(true);
  await ctx.close();
});

// ── No JS, hosted poster ────────────────────────────────────────────────────
test('without JavaScript the poster still covers the section', async ({ browser }) => {
  const { hosted, poster } = exported['shader-gradient'];
  const site = await openSite(browser, hosted, { javaScriptEnabled: false }, poster);
  const { page } = site;
  await page.waitForLoadState('load');
  const state = await posterState(page);
  expect(state.loaded).toBe(true);
  expect(state.visible).toBe(true);
  expect(state.box).toEqual([VIEWPORT.width, VIEWPORT.height]);
  const wrapper = await page.locator('.abs-bg').evaluate((el: HTMLElement) => ({ position: getComputedStyle(el).position, background: el.style.backgroundImage }));
  expect(wrapper.position).toBe('absolute');
  expect(wrapper.background).toContain('gradient'); // the CSS gradient sits behind the poster
  await site.close();
});

test('with a hosted poster, the only request is the poster file', async ({ browser }) => {
  const { hosted, poster } = exported['flow-field'];
  const site = await openSite(browser, hosted, {}, poster);
  await expect(site.page.locator('.abs-bg')).toHaveClass(/abs-bg--live/);
  expect(site.requests).toEqual([`${SITE}poster.webp`]);
  expect(site.errors).toEqual([]);
  await site.close();
});

// ── Budget checks ───────────────────────────────────────────────────────────
test('pasted twice (plus another type), every copy mounts', async ({ browser }) => {
  const section = (html: string) => `<section style="position:relative;height:34vh">${html}</section>`;
  const shader = exported['shader-gradient'].inline;
  const site = await openSite(browser, section(shader) + section(shader) + section(exported['particle-mesh'].inline));
  const { page } = site;
  await expect(page.locator('.abs-bg.abs-bg--live')).toHaveCount(3);
  expect(await page.locator('style#abs-bg-css').count()).toBe(1);
  expect(await page.locator('canvas.abs-bg__canvas').count()).toBe(3);
  const fps = await rate(page, '__frames', 3000);
  console.log(`  three instances: ${fps.toFixed(1)} frames/s in total`);
  expect(fps).toBeGreaterThan(84);
  expect(fps).toBeLessThan(93);
  expect(site.errors).toEqual([]);
  await site.close();
});

test('zero rAF while off-screen or in a hidden tab', async ({ browser }) => {
  const body = `<div style="height:150vh"></div><section style="position:relative;height:100vh">${exported['flow-field'].inline}</section>`;
  const site = await openSite(browser, body);
  const { page } = site;
  await page.waitForTimeout(500);
  const below = await rate(page, '__raf', 1500);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.locator('.abs-bg')).toHaveClass(/abs-bg--live/);
  const inView = await rate(page, '__frames', 2000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const scrolledAway = await rate(page, '__raf', 1500);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hidden = await rate(page, '__raf', 1500);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const back = await rate(page, '__frames', 1500);
  console.log(`  rAF/s below the fold ${below}, after scrolling away ${scrolledAway}, hidden ${hidden}; frames/s in view ${inView.toFixed(1)}, after unhiding ${back.toFixed(1)}`);
  expect([below, scrolledAway, hidden]).toEqual([0, 0, 0]);
  expect(inView).toBeGreaterThan(27);
  expect(back).toBeGreaterThan(27);
  expect(site.errors).toEqual([]);
  await site.close();
});

for (const [type] of TYPES) {
  test(`${type}: holds the 30 fps cap`, async ({ browser }) => {
    const site = await openSite(browser, exported[type].inline);
    const { page } = site;
    await expect(page.locator('.abs-bg')).toHaveClass(/abs-bg--live/);
    await page.waitForTimeout(500);
    const [fps, raf] = await Promise.all([rate(page, '__frames', 4000), rate(page, '__raf', 4000)]);
    console.log(`  ${type}: ${fps.toFixed(1)} frames/s (display rAF ${raf.toFixed(0)}/s)`);
    expect(fps).toBeGreaterThan(28.5);
    expect(fps).toBeLessThan(31);
    await site.close();
  });
}

// ── WebGL disabled ──────────────────────────────────────────────────────────
test('with WebGL disabled: CSS gradient for the shader, canvas types still run, no console errors', async () => {
  const noGL = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-3d-apis'] });
  try {
    const shader = await openSite(noGL, exported['shader-gradient'].inline);
    await expect(shader.page.locator('.abs-bg')).toHaveClass(/abs-bg--css/);
    expect((await posterState(shader.page)).visible).toBe(false);
    expect(await rate(shader.page, '__raf', 1000)).toBe(0);
    expect(shader.errors).toEqual([]);
    await shader.close();

    const flow = await openSite(noGL, exported['flow-field'].inline);
    await expect(flow.page.locator('.abs-bg')).toHaveClass(/abs-bg--live/);
    expect(flow.errors).toEqual([]);
    await flow.close();
  } finally {
    await noGL.close();
  }
});
