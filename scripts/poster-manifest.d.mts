export const POSTER_DIR: string;
export const PRESET_DIR: string;
export function posterSize(type: string): [number, number];
export const POSTER_QUALITY: number;
export function configHash(config: Record<string, unknown>): string;
