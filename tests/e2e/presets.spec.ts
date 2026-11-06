/**
 * Presets and the gallery: the gallery follows the budget rules, picking a
 * preset loads it, and every preset measures good contrast for its headline
 * colour on the studio's sample hero.
 */
import { expect, test, type Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';

const STUDIO = 'http://localhost:5173/';
const MAX_LIVE = 8;
const presetIds = readdirSync('presets')
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, -5));

type Studio = {
  preset: string;
  text: string;
  config: Record<string, unknown>;
  gallery: { live(): string[] };
  preview: { state: string };
};
const snapshot = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __studio: Studio }).__studio;
    return { preset: s.preset, text: s.text, config: s.config };
  });
const live = (page: Page) => page.evaluate(() => (window as unknown as { __studio: Studio }).__studio.gallery.live());

test.describe.configure({ mode: 'serial' });

test('gallery: only cards on screen (at most 8) animate; the rest are posters', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(m.text()));
  await page.goto(STUDIO);
  expect(await live(page)).toEqual([]); // nothing mounted while the gallery is hidden

  await page.getByRole('tab', { name: /Presets/ }).click();
  await page.waitForTimeout(1500);
  const visibleIds = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.gallery__grid li')]
      .filter((li) => {
        const r = li.getBoundingClientRect();
        const view = document.getElementById('view-presets')!.getBoundingClientRect();
        return r.bottom > Math.max(0, view.top) && r.top < Math.min(innerHeight, view.bottom);
      })
      .map((li) => li.querySelector('.card__name')!.textContent),
  );
  const atTop = await live(page);
  expect(atTop.length).toBeGreaterThan(0);
  expect(atTop.length).toBeLessThanOrEqual(MAX_LIVE);
  expect(atTop.length).toBe(Math.min(MAX_LIVE, visibleIds.length));
  // Cards that animate show a live canvas; their posters were rendered first.
  expect(await page.locator('.card .abs-bg--live').count()).toBe(atTop.length);
  expect(await page.locator('.card img.abs-bg__poster').count()).toBeGreaterThanOrEqual(atTop.length);

  // Scroll to the end: the first cards stop and keep only their posters.
  await page.locator('#view-presets').evaluate((v) => (v.scrollTop = v.scrollHeight));
  await page.waitForTimeout(1200);
  const atEnd = await live(page);
  expect(atEnd.length).toBeLessThanOrEqual(MAX_LIVE);
  expect(atEnd).not.toContain(atTop[0]);

  // Hovering a card keeps it live even when the policy is full.
  const card = page.locator('.card').last();
  await card.hover();
  await page.waitForTimeout(300);
  const lastId = await card.locator('.card__name').textContent();
  expect((await live(page)).length).toBeLessThanOrEqual(MAX_LIVE);
  expect(await card.locator('.abs-bg').getAttribute('data-abs-on')).not.toBeNull();
  expect(lastId).toBeTruthy();

  // Back to the preview: every thumbnail is torn down.
  await page.getByRole('tab', { name: 'Preview' }).click();
  await page.waitForTimeout(300);
  expect(await live(page)).toEqual([]);
  expect(errors).toEqual([]);
  await page.close();
});

test('gallery: with reduced motion nothing animates, posters only', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(STUDIO);
  await page.getByRole('tab', { name: /Presets/ }).click();
  await page.waitForTimeout(1500);
  await page.locator('.card').first().hover();
  await page.waitForTimeout(300);
  expect(await live(page)).toEqual([]);
  expect(await page.locator('.card img.abs-bg__poster').count()).toBeGreaterThan(0);
  await ctx.close();
});

test('picking a preset loads it, from the mouse or the keyboard', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(STUDIO);
  const tab = page.getByRole('tab', { name: /Presets/ });
  await tab.click();
  await page.getByRole('button', { name: /^Signal/ }).click();
  await expect(page.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Preview' })).toBeFocused();
  const signal = JSON.parse(readFileSync('presets/signal.json', 'utf8'));
  expect(await snapshot(page)).toEqual({ preset: 'signal', text: signal.text, config: signal.config });
  await expect(page.locator('.preset__name')).toHaveText('Signal');

  // Arrow keys move between the tabs; Enter on a card applies it.
  await page.getByRole('tab', { name: 'Preview' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: /^Linen/ }).focus();
  await page.keyboard.press('Enter');
  expect((await snapshot(page)).preset).toBe('linen');

  // Editing marks it; Reset returns to the preset.
  await page.getByRole('slider', { name: 'Speed' }).focus();
  await page.keyboard.press('End');
  await expect(page.locator('.preset__name')).toHaveText('Linen (edited)');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.locator('.preset__name')).toHaveText('Linen');
  await page.close();
});

test('every preset passes WCAG AA for its headline colour on the sample hero', async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const rows: string[] = [];
  const fails: string[] = [];
  for (const id of presetIds) {
    await page.goto(`${STUDIO}?preset=${id}`);
    await page.waitForFunction(() => /:1$/.test(document.querySelector('.contrast__ratio')?.textContent ?? ''), null, { timeout: 15_000 });
    const r = await page.evaluate(() => ({
      ratio: document.querySelector('.contrast__ratio')!.textContent!,
      pass: [...document.querySelectorAll<HTMLElement>('.contrast .pill')].map((p) => p.dataset.pass === 'true'),
    }));
    rows.push(`${id.padEnd(20)} ${r.ratio}`);
    if (!r.pass.every(Boolean)) fails.push(`${id} ${r.ratio}`);
  }
  console.log(`  headline contrast (lowest 5% of pixels):\n  ${rows.join('\n  ')}`);
  expect(fails).toEqual([]);
  await page.close();
});
