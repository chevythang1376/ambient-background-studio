/**
 * Cursor follow + idle drift. One passive window listener is shared by every
 * instance (the canvas itself never receives events: pointer-events: none).
 * Each instance eases its own pointer (lerp, never snap) and a presence value
 * that falls to 0 after ~3 s without input, so motion drifts back to autonomous.
 */
import type { FrameInput } from '../types';

export const IDLE_MS = 3000;
const FOLLOW = 3; // position easing rate, 1/s
const RISE = 2; // presence easing in, 1/s
const FALL = 0.7; // presence easing out, 1/s

const last = { x: 0, y: 0, t: -1e9 };
let bound = false;

function bind() {
  if (bound) return;
  bound = true;
  const move = (e: PointerEvent) => {
    last.x = e.clientX;
    last.y = e.clientY;
    last.t = performance.now();
  };
  const opts = { passive: true } as const;
  addEventListener('pointermove', move, opts);
  addEventListener('pointerdown', move, opts);
  document.documentElement.addEventListener('mouseleave', () => (last.t = -1e9), opts);
}

export interface EasedPointer {
  readonly input: FrameInput;
  /** Advance easing by `dt` seconds against the element's current rect. */
  update(rect: DOMRect, dt: number): void;
}

export function createPointer(): EasedPointer {
  bind();
  const pos: [number, number] = [0.5, 0.5];
  const input: FrameInput = { pointer: null, presence: 0, scroll: 0 };

  return {
    input,
    update(rect, dt) {
      const tx = (last.x - rect.left) / (rect.width || 1);
      const ty = (last.y - rect.top) / (rect.height || 1);
      const near = tx > -0.1 && tx < 1.1 && ty > -0.1 && ty < 1.1;
      const active = near && performance.now() - last.t < IDLE_MS;
      if (active) {
        if (!input.pointer) {
          pos[0] = tx;
          pos[1] = ty;
          input.pointer = pos; // presence is 0 here, so this never shows as a snap
        }
        const k = 1 - Math.exp(-dt * FOLLOW);
        pos[0] += (tx - pos[0]) * k;
        pos[1] += (ty - pos[1]) * k;
      }
      input.presence += ((active ? 1 : 0) - input.presence) * (1 - Math.exp(-dt * (active ? RISE : FALL)));
      input.scroll = -rect.top / (innerHeight || 1);
    },
  };
}
