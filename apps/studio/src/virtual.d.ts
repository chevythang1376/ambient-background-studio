declare module 'virtual:abs-runtimes' {
  import type { BackgroundType } from '@abs/runtime/types';
  /** Minified per-type snippet runtimes, built by apps/studio/vite.config.ts. */
  const runtimes: Record<BackgroundType, { code: string; bytes: number; gzip: number }>;
  export default runtimes;
}
