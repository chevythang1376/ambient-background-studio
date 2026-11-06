import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { buildAllRuntimes } from '../../scripts/runtime-build.mjs';
import { showcase } from './build/showcase.ts';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * `virtual:abs-runtimes`: the minified per-type snippet runtimes as strings, so
 * the export panel inlines exactly what `npm run size` measures. In dev the
 * runtime sources are watched, and editing one rebuilds the strings.
 */
function absRuntimes(): Plugin {
  const id = 'virtual:abs-runtimes';
  const resolved = '\0' + id;
  return {
    name: 'abs-runtimes',
    resolveId: (source) => (source === id ? resolved : undefined),
    async load(source) {
      if (source !== resolved) return;
      const built = await buildAllRuntimes();
      const out: Record<string, { code: string; bytes: number; gzip: number }> = {};
      for (const [type, r] of Object.entries(built)) {
        for (const m of r.modules) this.addWatchFile(m);
        out[type] = { code: r.code, bytes: r.bytes, gzip: r.gzip };
      }
      return `export default ${JSON.stringify(out)};`;
    },
  };
}

export default defineConfig({
  root: here('.'),
  plugins: [absRuntimes(), showcase()],
  build: {
    outDir: here('../../dist/studio'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: here('index.html'),
        prototype: here('prototype.html'),
        runtime: here('runtime.html'),
        showcase: here('showcase/index.html'),
      },
    },
  },
});
