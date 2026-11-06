/**
 * /showcase: every hero is a live background, only the ones on screen
 * animate, and the static markup still shows posters with reduced motion and
 * without JavaScript.
 */
import { expect, test, type Page } from '@playwright/test';

const SHOWCASE = 'http://localhost:5173/showcase';

const states = (page: Page) =>
  page.evaluate(() => (window as unknown as { __showcase: { mounted: { state: string }[] } }).__showcase.mounted.map((m) => m.state));

/** rAF callbacks per second over `ms` (the page counts them). */
const rafRate = (page: Page, ms = 1200) =>
  page.evaluate(async (ms) => {
    const s = (window as unknown as { __showcase: { rafCalls: number } }).__showcase;
    const n0 = s.rafCalls;
    await new Promise((r) => setTimeout(r, ms));
    return ((s.rafCalls - n0) * 1000) / ms;
  }, ms);

test('serves at /showcase with a live background behind every hero', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(m.text()));
  page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()}`));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(SHOWCASE);
  expect(page.url()).toMatch(/\/showcase\/$/);
  const heroes = page.locator('.sc-hero');
  const n = await heroes.count();
  expect(n).toBeGreaterThanOrEqual(8);
  expect(await page.locator('.sc-hero > .abs-bg[data-abs] > img.abs-bg__poster + canvas.abs-bg__canvas').count()).toBe(n);
  // The three types all appear.
  const types = await page.locator('.sc-hero .abs-bg').evaluateAll((els) => [...new Set(els.map((el) => JSON.parse(el.getAttribute('data-abs')!).type))].sort());
  expect(types).toEqual(['flow-field', 'particle-mesh', 'shader-gradient']);

  // Top of the page: only what's on screen animates.
  await page.waitForTimeout(1200);
  const top = await states(page);
  expect(top[0]).toBe('animate');
  expect(top.filter((s) => s === 'animate').length).toBeLessThanOrEqual(2);
  expect(top.slice(2).every((s) => s === 'paused')).toBe(true);

  // Each hero animates once scrolled to.
  for (let i = 0; i < n; i++) {
    await heroes.nth(i).evaluate((el) => window.scrollTo(0, (el as HTMLElement).offsetTop));
    await expect.poll(async () => (await states(page))[i]).toBe('animate');
  }

  // Past every hero: zero rAF.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);
  expect(await rafRate(page)).toBe(0);
  expect((await states(page)).every((s) => s === 'paused')).toBe(true);
  expect(errors).toEqual([]);
});

test('with reduced motion every hero shows its poster, with zero rAF', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(SHOWCASE);
  await page.waitForTimeout(800);
  expect((await states(page)).every((s) => s === 'poster')).toBe(true);
  expect(await rafRate(page)).toBe(0);
  const first = await page.locator('.sc-hero img.abs-bg__poster').first().evaluate((img: HTMLImageElement) => ({
    loaded: img.complete && img.naturalWidth > 0,
    visible: getComputedStyle(img).visibility === 'visible',
  }));
  expect(first).toEqual({ loaded: true, visible: true });
  await expect(page.locator('#hud')).toHaveText(/Reduced motion/);
  await ctx.close();
});

test('without JavaScript the heroes are posters over CSS gradients', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(SHOWCASE.replace(/$/, '/'));
  const first = page.locator('.sc-hero').first();
  const img = first.locator('img.abs-bg__poster');
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  const box = await img.boundingBox();
  const hero = await first.boundingBox();
  expect(box).toEqual(hero);
  expect(await first.locator('.abs-bg').evaluate((el: HTMLElement) => el.style.backgroundImage)).toContain('gradient');
  await ctx.close();
});
