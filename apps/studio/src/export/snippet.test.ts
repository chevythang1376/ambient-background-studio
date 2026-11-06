import { describe, expect, it } from 'vitest';
import { DEFAULTS, resolveConfig } from '@abs/runtime/core/config';
import { buildSnippet, CREDIT_COMMENT, escapeAttr, snippetConfig } from './snippet';
import { formatSize, gzipSize } from './gzip';

const RUNTIME = '(function(){document.documentElement.dataset.ran="1"})();';

/** Pull `data-abs` back out of the HTML and decode it as a browser would. */
function dataAbs(html: string): unknown {
  const m = /data-abs='([^']*)'/.exec(html);
  if (!m) throw new Error('no data-abs');
  const decoded = m[1]!.replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return JSON.parse(decoded);
}

describe('snippetConfig', () => {
  it('keeps only type and colours for the defaults', () => {
    expect(snippetConfig(resolveConfig(DEFAULTS))).toEqual({ type: DEFAULTS.type, colors: DEFAULTS.colors });
  });

  it('keeps changed fields, rounded, and round-trips through resolveConfig', () => {
    const cfg = resolveConfig({ ...DEFAULTS, type: 'flow-field', speed: 1.35000001, calm: 0.42, fps: 24, pointer: 'off', seed: 77 });
    const out = snippetConfig(cfg);
    expect(out).toEqual({ type: 'flow-field', colors: DEFAULTS.colors, speed: 1.35, calm: 0.42, fps: 24, pointer: 'off', seed: 77 });
    expect(resolveConfig(out)).toEqual({ ...cfg, speed: 1.35 });
  });
});

describe('buildSnippet', () => {
  const cfg = resolveConfig({ ...DEFAULTS, colors: ['#0b1020', '#4d5fa8', '#b7c3f0'] });

  it('has the documented shape: wrapper, poster, canvas, inline script', () => {
    const { html } = buildSnippet({ config: cfg, runtime: RUNTIME, posterSrc: 'poster.webp', credit: true });
    const lines = html.split('\n');
    expect(lines[0]).toBe(CREDIT_COMMENT);
    expect(lines[1]).toMatch(/^<div class="abs-bg" data-abs='\{.*\}' style="position:absolute;inset:0;[^"]*background:[^"]+">$/);
    expect(lines[2]).toMatch(/^ {2}<img class="abs-bg__poster" src="poster\.webp" alt="" decoding="async" style="[^"]*object-fit:cover">$/);
    expect(lines[3]).toBe('  <canvas class="abs-bg__canvas" aria-hidden="true"></canvas>');
    expect(lines[4]).toBe('</div>');
    expect(lines[5]).toBe(`<script>/*! Ambient Background Studio · shader-gradient */${RUNTIME}</script>`);
    expect(dataAbs(html)).toEqual({ type: 'shader-gradient', colors: ['#0b1020', '#4d5fa8', '#b7c3f0'] });
  });

  it('makes no external requests beyond the poster src it was given', () => {
    const { html } = buildSnippet({ config: cfg, runtime: RUNTIME, posterSrc: 'data:image/webp;base64,AAAA', credit: false });
    expect(html.match(/\b(src|href)=/g)).toEqual(['src=']);
    expect(html).not.toMatch(/https?:|<link|@import|type="module"|import\(/);
  });

  it('leaves out the credit comment when asked', () => {
    const { html } = buildSnippet({ config: cfg, runtime: RUNTIME, posterSrc: '', credit: false });
    expect(html).not.toContain('<!--');
    expect(html).not.toContain('<img');
  });

  it('escapes the poster URL so it cannot break out of the attribute', () => {
    const { html } = buildSnippet({ config: cfg, runtime: RUNTIME, posterSrc: 'a.webp" onerror="alert(1)', credit: false });
    expect(html).toContain('src="a.webp&quot; onerror=&quot;alert(1)"');
    expect(html).not.toMatch(/" onerror="/);
    expect(escapeAttr(`<&"'>`)).toBe('&lt;&amp;&quot;\'&gt;');
  });

  it('refuses a runtime that would end the script element early', () => {
    expect(() => buildSnippet({ config: cfg, runtime: 'var s="</script>"', posterSrc: '', credit: false })).toThrow();
  });

  it('splits the byte count into runtime, poster and markup', () => {
    const poster = 'data:image/webp;base64,' + 'A'.repeat(1000);
    const { html, bytes } = buildSnippet({ config: cfg, runtime: RUNTIME, posterSrc: poster, credit: true });
    expect(bytes.total).toBe(new TextEncoder().encode(html).length);
    expect(bytes.runtime).toBe(RUNTIME.length);
    expect(bytes.poster).toBe(poster.length);
    expect(bytes.markup).toBe(bytes.total - bytes.runtime - bytes.poster);
    expect(bytes.markup).toBeGreaterThan(0);
  });
});

describe('gzipSize', () => {
  it('matches what zlib produces for the same text', async () => {
    const { gzipSync } = await import('node:zlib');
    const text = 'abs-bg '.repeat(500) + RUNTIME;
    const size = await gzipSize(text);
    expect(size).not.toBeNull();
    // Same deflate, different header bytes and level: within a few percent.
    expect(Math.abs(size! - gzipSync(text).length)).toBeLessThan(gzipSync(text).length * 0.05 + 8);
  });

  it('formats sizes', () => {
    expect(formatSize(7290)).toBe('7.12 KB');
    expect(formatSize(48_000)).toBe('46.9 KB');
    expect(formatSize(1_604_506)).toBe('1.53 MB');
  });
});
