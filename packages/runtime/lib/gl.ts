/** Minimal WebGL helpers shared by WebGL renderers. */

/** Vertex shader for a full-screen quad drawn as a 4-vertex triangle strip. */
export const QUAD_VERT = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;

export function getGL(canvas: HTMLCanvasElement): WebGLRenderingContext | null {
  // Low-power hint and no depth/stencil/AA: we draw one opaque quad.
  return canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'low-power',
  });
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    throw new Error('abs: shader compile failed: ' + gl.getShaderInfoLog(s));
  }
  return s;
}

/** Compile + link a program and bind a full-screen quad to attribute `p`. */
export function createQuadProgram(gl: WebGLRenderingContext, frag: string): WebGLProgram {
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, QUAD_VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error('abs: program link failed: ' + gl.getProgramInfoLog(prog));
  }
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  return prog;
}
