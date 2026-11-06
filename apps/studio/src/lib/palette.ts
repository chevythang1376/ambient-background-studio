/**
 * Palette input: the user pastes hex values separated by commas or new lines
 * (spaces, semicolons and a pasted JSON array work too). Parsing is pure so it
 * can be unit-tested; the studio shows the message and the swatches.
 */
import { normalizeHex } from '@abs/runtime/lib/color';
import { MAX_COLORS, MIN_COLORS } from '@abs/runtime/core/config';

export interface ParsedPalette {
  /** Valid colours, normalised to `#rrggbb`, at most MAX_COLORS. */
  colors: string[];
  /** Tokens that aren't hex colours, as typed. */
  invalid: string[];
  /** Valid colours past MAX_COLORS that were left out. */
  dropped: number;
}

const SEPARATORS = /[\s,;"'[\]]+/;

export function parsePalette(text: string): ParsedPalette {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const token of text.split(SEPARATORS)) {
    if (!token) continue;
    const hex = normalizeHex(token);
    if (hex) valid.push(hex);
    else invalid.push(token);
  }
  return { colors: valid.slice(0, MAX_COLORS), invalid, dropped: Math.max(0, valid.length - MAX_COLORS) };
}

/** True when the palette can be applied (it may still carry a warning). */
export function isUsable(p: ParsedPalette): boolean {
  return p.colors.length >= MIN_COLORS;
}

/** One line for the user, or null when the input is clean. */
export function paletteMessage(p: ParsedPalette): string | null {
  if (p.invalid.length) {
    const shown = p.invalid.slice(0, 3).map((t) => `“${t}”`).join(', ');
    const more = p.invalid.length > 3 ? ` and ${p.invalid.length - 3} more` : '';
    const what = p.invalid.length === 1 ? 'isn’t a hex colour' : 'aren’t hex colours';
    return `${shown}${more} ${what}. Use #rgb or #rrggbb.`;
  }
  if (p.colors.length < MIN_COLORS) return `Add at least ${MIN_COLORS} colours.`;
  if (p.dropped) return `Only the first ${MAX_COLORS} colours are used.`;
  return null;
}

export const formatPalette = (colors: readonly string[]): string => colors.join(', ');
