/**
 * Shader gradient: liquid, silky colour blending with soft waves.
 * One full-screen quad, one fragment shader, domain-warped fbm noise mapped
 * through a 2–5 stop palette.
 */
import type { Budget, Config, FrameInput, Renderer, RendererDef } from '../types';
import { applyCalm, type Motion } from '../core/calm';
import { hexToRgb, type RGB } from '../lib/color';
import { createQuadProgram, getGL } from '../lib/gl';

const FRAG = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uTime;   // integrated phase: seconds x effective speed
uniform vec2 uPointer; // eased pointer, 0-1, y up
uniform float uWarp;   // signed cursor warp: + attract, - repel
uniform float uGlow;   // cursor soft-light amount
uniform vec3 uLight;   // lightest palette colour, tints the glow
uniform float uScale;
uniform float uTurb;
uniform float uSeed;
uniform float uScroll;
uniform vec3 uColors[5];
uniform float uCount;

// 2D simplex noise, Ian McEwan / Ashima Arts (MIT). Returns about -1..1.
vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 a0 = x - floor(x + 0.5);
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g = vec3(a0.x * x0.x + h.x * x0.y, a0.yz * x12.xz + h.yz * x12.yw);
  return 130.0 * dot(m, g);
}

// fbm: 3 octaves. Each octave is rotated ~37 deg and doubled (the mat2 is
// 2 x rotation) so the simplex grid never lines up between layers. A low gain
// (0.35) keeps the high octaves faint: soft, silky, never marbled.
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.6;
  for (int i = 0; i < 3; i++) {
    v += a * snoise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.3;
    a *= 0.35;
  }
  return v;
}

// Walk the palette: f in 0-1 eases between neighbouring stops.
vec3 palette(float f) {
  f = clamp(f, 0.0, 1.0) * (uCount - 1.0);
  vec3 c = uColors[0];
  for (int i = 1; i < 5; i++) {
    if (float(i) >= uCount) break;
    c = mix(c, uColors[i], smoothstep(float(i) - 1.0, float(i), f));
  }
  return c;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 aspect = vec2(uRes.x / uRes.y, 1.0);
  float zoom = 0.75 / uScale;
  // Centred, aspect-correct domain, stretched sideways so folds run long and
  // silky rather than blobby. Scrolling slides it gently (parallax).
  vec2 p = (uv - 0.5) * aspect * zoom * vec2(0.6, 1.0);
  p.y -= uScroll * 0.25;
  float t = uTime * 0.07;

  // Cursor falloff (gaussian), used for both warp and glow.
  vec2 d = (uv - uPointer) * aspect;
  float near = exp(-dot(d, d) * 7.0);
  p -= d * zoom * near * uWarp * 0.5;

  // Domain warping (after Inigo Quilez): fbm displaces fbm twice, folding the
  // field into slow liquid swirls. uTurb sets how far each layer pushes the next.
  vec2 o = vec2(uSeed * 1.7, uSeed * 3.1);
  vec2 q = vec2(fbm(p + o + vec2(0.0, t)), fbm(p + o + vec2(5.2, 1.3) - vec2(t * 0.8, 0.0)));
  vec2 w = p + uTurb * 1.1 * q;
  vec2 r = vec2(fbm(w + vec2(1.7, 9.2) + t * 0.6), fbm(w + vec2(8.3, 2.8) - t * 0.5));
  float n = fbm(p + uTurb * 1.3 * r);

  // Soft waves: a long, slow sine band bent by the warp adds a silky sheen.
  float wave = sin(p.y * 2.4 + r.x * 1.6 + t * 2.0) * 0.07;

  vec3 col = palette(0.5 + 0.85 * n + wave);
  col = mix(col, uLight, near * uGlow * 0.35);

  // Sub-LSB dither breaks up 8-bit banding in smooth gradients.
  col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

const UNIFORMS = [
  'uRes', 'uTime', 'uPointer', 'uWarp', 'uGlow', 'uLight', 'uScale', 'uTurb', 'uSeed', 'uScroll',
  'uColors', 'uCount',
] as const;
type UniformName = (typeof UNIFORMS)[number];

export function createShaderGradient(): Renderer {
  let gl: WebGLRenderingContext | null = null;
  let cfg: Config;
  let budget: Budget;
  const u = {} as Record<UniformName, WebGLUniformLocation | null>;
  const motion: Motion = { speed: 0, turbulence: 0, pointer: 0, velocity: 0 };
  const colors = new Float32Array(15);
  const rgb: RGB = [0, 0, 0];
  let phase = 0;
  let last = -1;
  // Pointer in shader space (y up); holds its last value while presence fades out.
  let px = 0.5;
  let py = 0.5;

  /** Push everything that only changes with config. */
  function applyStatic() {
    if (!gl) return;
    applyCalm(cfg, budget.still, motion);
    let lightest = 0;
    let lum = -1;
    cfg.colors.forEach((hex, i) => {
      hexToRgb(hex, rgb);
      colors.set(rgb, i * 3);
      const l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
      if (l > lum) { lum = l; lightest = i; }
    });
    gl.uniform3fv(u.uColors, colors);
    gl.uniform1f(u.uCount, cfg.colors.length);
    gl.uniform3f(u.uLight, colors[lightest * 3]!, colors[lightest * 3 + 1]!, colors[lightest * 3 + 2]!);
    gl.uniform1f(u.uScale, cfg.scale);
    gl.uniform1f(u.uTurb, motion.turbulence);
    gl.uniform1f(u.uSeed, (cfg.seed % 97) * 0.37);
  }

  return {
    init(canvas, config, b) {
      cfg = config;
      budget = b;
      gl = getGL(canvas);
      if (!gl) throw new Error('abs: WebGL unavailable');
      const prog = createQuadProgram(gl, FRAG);
      for (const name of UNIFORMS) u[name] = gl.getUniformLocation(prog, name);
      applyStatic();
    },

    frame(time: number, input: FrameInput) {
      if (!gl) return;
      // Integrate phase on the CPU so live speed changes never make the field jump.
      const dt = last < 0 ? 0 : Math.min(time - last, 100) / 1000;
      last = time;
      phase += dt * motion.speed;

      if (input.pointer) {
        px = input.pointer[0];
        py = 1 - input.pointer[1];
      }
      const amt = cfg.pointer === 'off' ? 0 : input.presence * motion.pointer;
      const mode = cfg.pointer;
      gl.uniform1f(u.uTime, phase);
      gl.uniform2f(u.uPointer, px, py);
      gl.uniform1f(u.uWarp, mode === 'attract' ? amt : mode === 'repel' ? -amt : amt * 0.3);
      gl.uniform1f(u.uGlow, mode === 'light' ? amt : 0);
      gl.uniform1f(u.uScroll, input.scroll);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },

    resize(w, h) {
      if (!gl) return;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(u.uRes, w, h);
    },

    setConfig(partial) {
      cfg = { ...cfg, ...partial };
      applyStatic();
    },

    destroy() {
      // Free the GPU context now rather than waiting for GC.
      if (gl && !gl.isContextLost()) gl.getExtension('WEBGL_lose_context')?.loseContext();
      gl = null;
    },
  };
}

export const shaderGradient: RendererDef = { type: 'shader-gradient', webgl: true, create: createShaderGradient };
