// Size report: minified and gzip -9 bytes for each snippet runtime (exactly the
// code the export inlines) and for each renderer on its own.
//   node scripts/size.mjs          table
//   node scripts/size.mjs --json   machine-readable
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildRuntime, runtimeEntries } from './runtime-build.mjs';

const BUDGET_GZIP = 8 * 1024; // per type, from the brief

const renderersDir = new URL('../packages/runtime/renderers/', import.meta.url);
const renderers = readdirSync(renderersDir)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => [f.replace(/\.ts$/, ''), fileURLToPath(new URL(f, renderersDir))]);

const report = { snippet: {}, renderer: {} };
for (const [type, entry] of Object.entries(runtimeEntries())) {
  const { bytes, gzip } = await buildRuntime(entry);
  report.snippet[type] = { bytes, gzip };
}
for (const [name, entry] of renderers) {
  const { bytes, gzip } = await buildRuntime(entry, { name: 'r' });
  report.renderer[name] = { bytes, gzip };
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const kb = (n) => (n / 1024).toFixed(2).padStart(6) + ' KB';
  console.log('\nsnippet runtime (core + one renderer + grain + fallbacks)');
  for (const [type, { bytes, gzip }] of Object.entries(report.snippet)) {
    console.log(`  ${type.padEnd(18)} ${kb(bytes)} min  ${kb(gzip)} gzip  ${gzip <= BUDGET_GZIP ? 'within' : 'OVER'} the 8 KB budget`);
  }
  console.log('\nrenderer only');
  for (const [name, { bytes, gzip }] of Object.entries(report.renderer)) console.log(`  ${name.padEnd(18)} ${kb(bytes)} min  ${kb(gzip)} gzip`);
}
if (Object.values(report.snippet).some((s) => s.gzip > BUDGET_GZIP)) process.exitCode = 1;
