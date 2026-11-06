/**
 * Shared types for the Ambient Background runtime.
 *
 * A background is a small renderer plus a JSON config. The config is what the
 * studio edits, what presets store and what an exported snippet carries in its
 * `data-abs` attribute, so it stays flat and JSON-serialisable.
 */

/** Background types shipped in v1. New types (aurora, topographic, …) extend this union. */
export type BackgroundType = 'shader-gradient' | 'flow-field' | 'particle-mesh';

/**
 * How the cursor influences the background.
 * - `attract` / `repel`: gently pull or push the field around the eased pointer.
 * - `light`: a soft glow (WebGL). Canvas 2D types can't glow cheaply (it would
 *   accumulate in the flow field's trail buffer), so the flow field renders it as
 *   a gentle swirl and the particle mesh makes the cursor a node of the network.
 */
export type PointerMode = 'off' | 'attract' | 'repel' | 'light';

/** What to show for `prefers-reduced-motion: reduce`. */
export type ReducedMotionMode = 'poster' | 'still';

export interface Config {
  type: BackgroundType;
  /**
   * 2–5 hex colours. Shader gradient blends all of them. Canvas 2D types use
   * `colors[0]` as the background and the rest as ink.
   */
  colors: string[];
  /** Motion speed multiplier, 0–3 (1 = default ambient pace). */
  speed: number;
  /** Feature size, 0.25–4 (bigger = larger, softer shapes). */
  scale: number;
  /** How folded / chaotic the noise field is, 0–1. */
  turbulence: number;
  /**
   * Calm master, 0–1. Scales speed, turbulence, cursor strength and particle
   * velocity down together. 1 = the configured motion, 0 = near-still.
   */
  calm: number;
  /** Film grain amount, 0–1 (applied by the grain post layer). */
  grain: number;
  pointer: PointerMode;
  /** Cursor influence, 0–1. Defaults low. */
  pointerStrength: number;
  /** Canvas 2D types: how many particles / lines, 0–1 of the budget's cap. */
  density: number;
  /** Flow field: trail length, 0–1 (higher = slower fade). */
  trail: number;
  /** Seed for noise offsets and particle layout. */
  seed: number;

  // ── Budget overrides (the budget rules always clamp these) ──
  /** Backing-store size as a fraction of the element's CSS size × DPR. Default 0.5. */
  resolution: number;
  /** Device-pixel-ratio cap. Default 1.5. */
  dprCap: number;
  /** Frame-rate cap. Default 30. */
  fps: number;
  /** Reduced-motion behaviour. Default `poster`. */
  reducedMotion: ReducedMotionMode;
}

/**
 * What the runtime decided this device and visitor can afford. Computed once at
 * load (and again when preferences change) and handed to the renderer.
 */
export interface Budget {
  /**
   * Effective backing-store scale relative to CSS size × dpr. Mount may lower it
   * below `config.resolution` to respect the pixel cap; renderers read it at
   * `resize()` to convert CSS sizes to backing pixels.
   */
  resolution: number;
  /** Effective device pixel ratio after the cap. */
  dpr: number;
  /** Frame-rate cap. */
  fps: number;
  /** Upper bound on simulated particles / lines for Canvas 2D types. */
  maxParticles: number;
  /** Near-still variant for reduced motion: renderers keep drawing but motion ≈ 0. */
  still: boolean;
}

/**
 * Per-frame input. The caller owns and reuses this object (and the pointer
 * tuple) so the hot path never allocates.
 */
export interface FrameInput {
  /** Eased pointer in element space, 0–1 with y down. `null` when it never entered. */
  pointer: [number, number] | null;
  /** Eased pointer presence, 0–1. Falls to 0 after ~3 s idle so motion drifts back. */
  presence: number;
  /** Normalised scroll offset (0 at top). Used for a gentle parallax shift. */
  scroll: number;
}

export interface Renderer {
  init(canvas: HTMLCanvasElement, config: Config, budget: Budget): void;
  /** Draw one frame. `timeMs` is scheduler time: it never jumps across pauses. */
  frame(timeMs: number, input: FrameInput): void;
  /** Backing-store size in device pixels (already scaled by dpr × resolution). */
  resize(w: number, h: number): void;
  /** Live updates from studio sliders. */
  setConfig(partial: Partial<Config>): void;
  destroy(): void;
  /** Simulated particles / nodes, for the studio's performance meter. */
  particles?(): number;
}

/**
 * A renderer module as the mount sees it. Entry points pass only the defs they
 * need, which is what keeps each exported snippet to a single renderer.
 */
export interface RendererDef {
  type: BackgroundType;
  /** Needs WebGL (drives the no-WebGL → CSS gradient fallback). */
  webgl: boolean;
  create(): Renderer;
}
