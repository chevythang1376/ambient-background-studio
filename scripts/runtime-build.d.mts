export interface BuiltRuntime {
  /** Minified IIFE, safe to inline in a <script> element. */
  code: string;
  /** UTF-8 bytes of `code`. */
  bytes: number;
  /** gzip -9 bytes of `code`. */
  gzip: number;
  /** Absolute paths of the source modules in the bundle (for watching). */
  modules: string[];
}

export const ROOT: string;
export function runtimeEntries(): Record<string, string>;
export function buildRuntime(entry: string, options?: { name?: string }): Promise<BuiltRuntime>;
export function buildAllRuntimes(): Promise<Record<string, BuiltRuntime>>;
