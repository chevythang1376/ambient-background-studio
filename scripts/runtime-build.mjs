// Builds the per-type snippet runtimes: one entry (core + one renderer + grain
// + fallbacks) bundled as a classic-script IIFE, minified, with no exports and
// no globals. Shared by the studio's Vite plugin (export panel) and the size
// report, so both always measure the code that ships.
import { rolldown } from 'rolldown';
import { gzipSync } from 'node:zlib';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRIES_DIR = new URL('../packages/runtime/entries/', import.meta.url);

/** Snippet entries keyed by background type (the entry file name). */
export function runtimeEntries() {
  return Object.fromEntries(
    readdirSync(ENTRIES_DIR)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => [f.replace(/\.ts$/, ''), fileURLToPath(new URL(f, ENTRIES_DIR))]),
  );
}

/** Sequences that would end or corrupt an inline <script> element. */
const UNSAFE_IN_SCRIPT = /<\/script|<!--|<script/i;

/**
 * Bundle and minify one entry. Throws if the result can't be inlined safely.
 * `name` keeps the entry's exports on a global of that name (size report only;
 * snippet entries have no exports and leave no globals).
 */
export async function buildRuntime(entry, { name } = {}) {
  const bundle = await rolldown({ input: entry, transform: { target: 'es2020' }, logLevel: 'silent' });
  try {
    const { output } = await bundle.generate({ format: 'iife', minify: true, name });
    const chunk = output[0];
    const code = chunk.code.trim();
    if (UNSAFE_IN_SCRIPT.test(code)) throw new Error(`${entry}: output contains a sequence that breaks an inline <script>`);
    return {
      code,
      bytes: Buffer.byteLength(code),
      gzip: gzipSync(code, { level: 9 }).length,
      modules: chunk.moduleIds.filter((id) => !id.startsWith('\0')),
    };
  } finally {
    await bundle.close();
  }
}

/** Build every snippet runtime. */
export async function buildAllRuntimes() {
  const out = {};
  for (const [type, entry] of Object.entries(runtimeEntries())) out[type] = await buildRuntime(entry);
  return out;
}
