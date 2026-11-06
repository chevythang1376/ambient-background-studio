/**
 * requestAnimationFrame scheduler with an FPS cap and clean pause/resume.
 *
 * - Cap: display frames are skipped until the cap's interval has passed. The
 *   remainder is carried so 30 fps on a 144 Hz display averages to 30, not 28.8.
 * - Pause: `stop()` cancels the pending rAF, so a paused background makes zero
 *   rAF callbacks.
 * - Time: the clock only advances while running, and each step is clamped, so
 *   resuming (or a long jank) never makes the animation jump.
 */

export type Tick = (timeMs: number, dtMs: number) => void;
type Raf = (cb: (now: number) => void) => number;

export interface Scheduler {
  start(): void;
  stop(): void;
  setFps(fps: number): void;
  readonly running: boolean;
}

/** Largest clock step per frame. */
const MAX_STEP = 100;

export function createScheduler(
  tick: Tick,
  fps: number,
  raf: Raf = (cb) => requestAnimationFrame(cb),
  caf: (id: number) => void = (id) => cancelAnimationFrame(id),
): Scheduler {
  let interval = 1000 / fps;
  let id = 0;
  let running = false;
  let clock = 0;
  let last = -1;

  const loop = (now: number) => {
    id = raf(loop);
    if (last < 0) {
      // First frame after (re)start: draw at the current clock, no advance.
      last = now;
      tick(clock, 0);
      return;
    }
    const elapsed = now - last;
    if (elapsed < interval - 1) return; // 1 ms tolerance for timestamp jitter
    last = elapsed > interval * 2 || elapsed < interval ? now : now - (elapsed % interval);
    const dt = Math.min(elapsed, MAX_STEP);
    clock += dt;
    tick(clock, dt);
  };

  return {
    get running() {
      return running;
    },
    start() {
      if (running) return;
      running = true;
      last = -1;
      id = raf(loop);
    },
    stop() {
      if (!running) return;
      running = false;
      caf(id);
    },
    setFps(f) {
      interval = 1000 / f;
    },
  };
}
