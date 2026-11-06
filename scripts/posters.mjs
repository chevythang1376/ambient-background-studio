// Renders every preset's poster frame to apps/studio/public/posters/<id>.webp
// (WebP, 1280×720; flow fields 960×540) and records a manifest of config hashes, so the tests can
// tell when a preset changed and its poster is stale.
//
//   npm run posters
//
// Rendering needs a real browser: this starts the studio's Vite dev server on
// a spare port and drives the installed Chrome headless through Playwright.
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { configHash, POSTER_DIR, POSTER_QUALITY, posterSize, PRESET_DIR } from './poster-manifest.mjs';

const presets = readdirSync(PRESET_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ id: f.slice(0, -5), ...JSON.parse(readFileSync(PRESET_DIR + f, 'utf8')) }));

const server = await createServer({
  configFile: fileURLToPath(new URL('../apps/studio/vite.config.ts', import.meta.url)),
  server: { port: 5190, strictPort: false },
  logLevel: 'error',
});
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: 'chrome', headless: true });

try {
  const page = await browser.newPage();
  await page.goto(`${url}prototype.html`); // any page on the dev server: it only provides module loading
  rmSync(POSTER_DIR, { recursive: true, force: true });
  mkdirSync(POSTER_DIR, { recursive: true });
  const manifest = {};
  for (const p of presets) {
    const [w, h] = posterSize(p.config.type);
    const b64 = await page.evaluate(
      async ([config, w, h, q]) => (await import('/src/preset-poster.ts')).presetPoster(config, w, h, q),
      [p.config, w, h, POSTER_QUALITY],
    );
    if (!b64) throw new Error(`${p.id}: poster render failed`);
    const bytes = Buffer.from(b64, 'base64');
    writeFileSync(`${POSTER_DIR}${p.id}.webp`, bytes);
    manifest[p.id] = { hash: configHash(p.config), width: w, height: h, bytes: bytes.length };
    console.log(`  ${p.id.padEnd(20)} ${(bytes.length / 1024).toFixed(1).padStart(6)} KB`);
  }
  writeFileSync(`${POSTER_DIR}manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
  const total = Object.values(manifest).reduce((n, m) => n + m.bytes, 0);
  console.log(`\n${presets.length} posters, ${(total / 1024).toFixed(0)} KB in total → ${POSTER_DIR}`);
} finally {
  await browser.close();
  await server.close();
}
