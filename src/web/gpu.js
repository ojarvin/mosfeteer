/**
 * WebGL2 for the Atlas desk and the net beams: the context, and the shapes
 * they share (rounded boxes, soft shadows, beams of light). All coordinates
 * are CSS pixels from the canvas's top left; colors are premultiplied.
 *
 * A browser with no real GPU gets no context (`gpuContext` returns null) and
 * the caller keeps its 2D drawing. `localStorage['mosfeteer.gpu']`: `off`
 * never uses WebGL (Settings -> Hardware acceleration), `on` also accepts a
 * software renderer.
 */

const SETTING_KEY = 'mosfeteer.gpu';
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i;

function setting() {
  try { return globalThis.localStorage?.getItem(SETTING_KEY) || ''; } catch { return ''; }
}

const accelerationListeners = new Set();

/** Whether drawing may use the GPU (Settings -> Hardware acceleration). */
export function hardwareAcceleration() {
  return setting() !== 'off';
}

/** Turn the GPU on or off; those drawing with it start again (onAccelerationChange). */
export function setHardwareAcceleration(on) {
  try {
    if (!on) globalThis.localStorage?.setItem(SETTING_KEY, 'off');
    else if (setting() === 'off') globalThis.localStorage?.removeItem(SETTING_KEY);
  } catch { /* per-session only */ }
  for (const listener of accelerationListeners) listener(on);
}

export function onAccelerationChange(listener) {
  accelerationListeners.add(listener);
}

/** A WebGL2 context for `canvas`, or null. */
export function gpuContext(canvas, attributes = {}) {
  const mode = setting();
  if (mode === 'off') return null;
  const gl = canvas.getContext('webgl2', {
    antialias: false, depth: false, stencil: false, powerPreference: 'low-power',
    failIfMajorPerformanceCaveat: mode !== 'on', ...attributes,
  });
  if (!gl) return null;
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  if (mode !== 'on' && SOFTWARE.test(renderer)) {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return null;
  }
  return gl;
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(shader) || 'shader did not compile');
  return shader;
}

/** A linked program, with its uniform locations as `.u.<name>`. */
export function linkProgram(gl, vertex, fragment) {
  const handle = gl.createProgram();
  gl.attachShader(handle, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(handle, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(handle);
  if (!gl.getProgramParameter(handle, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(handle) || 'program did not link');
  const u = {};
  const count = gl.getProgramParameter(handle, gl.ACTIVE_UNIFORMS) || 0;
  for (let i = 0; i < count; i++) {
    const { name } = gl.getActiveUniform(handle, i);
    u[name] = gl.getUniformLocation(handle, name);
  }
  return { handle, u };
}

const colorCache = new Map();
let colorContext = null;

/** Any CSS color as straight `[r, g, b, a]`, each 0 to 1. */
export function cssColor(value) {
  let color = colorCache.get(value);
  if (color) return color;
  colorContext ||= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
  colorContext.clearRect(0, 0, 1, 1);
  colorContext.fillStyle = '#000';
  colorContext.fillStyle = value;
  colorContext.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = colorContext.getImageData(0, 0, 1, 1).data;
  color = [r / 255, g / 255, b / 255, a / 255];
  colorCache.set(value, color);
  return color;
}

/** `color` at `alpha`, premultiplied. */
export function premultiplied(color, alpha = 1) {
  const [r, g, b, a] = cssColor(color);
  const total = a * alpha;
  return [r * total, g * total, b * total, total];
}

/** Text widths, remembered: measured once at one size and scaled, since
 *  the desk asks for the same ones every frame. `read(text, font)` measures. */
export function textMeasure(fontOf) {
  const REFERENCE = 100;
  const widths = new Map();
  return (text, weight, size, read) => {
    const key = `${weight}|${text}`;
    let width = widths.get(key);
    if (width === undefined) {
      if (widths.size > 20000) widths.clear();
      width = read(text, fontOf(weight, REFERENCE));
      widths.set(key, width);
    }
    return (width * size) / REFERENCE;
  };
}

/** A unit rectangle stretched over `u_rect`; the fragment shaders get `v_p`
 *  in CSS pixels and `v_uv` from 0 to 1. */
export const QUAD_VERTEX = `#version 300 es
layout(location = 0) in vec2 a_corner;
uniform vec4 u_rect;
uniform vec2 u_pane;
out vec2 v_p;
out vec2 v_uv;
void main() {
  v_uv = a_corner;
  v_p = u_rect.xy + a_corner * u_rect.zw;
  vec2 clip = v_p / u_pane * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

/** The signed distance to a rounded box `b` (x, y, w, h) of radius `r`. */
export const ROUNDED_BOX = `
float sdBox(vec2 p, vec4 b, float r) {
  vec2 q = abs(p - b.xy - b.zw * 0.5) - b.zw * 0.5 + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}`;


/** Under one 8-bit step of noise, which hides banding in soft gradients
 *  (interleaved gradient noise). */
export const DITHER = `
float dither() {
  return (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0;
}`;

const BOX_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_p;
uniform vec4 u_box, u_fill, u_stroke, u_glow;
uniform float u_radius, u_width, u_sigma, u_px, u_sweep, u_sweepAt;
out vec4 color;
${ROUNDED_BOX}
${DITHER}
float erf(float x) {
  float a = abs(x);
  float t = 1.0 + (0.278393 + (0.230389 + 0.078108 * a * a) * a) * a;
  t *= t;
  return sign(x) * (1.0 - 1.0 / (t * t));
}
// How much of a pixel at distance d lies in the band |d| < w / 2.
float band(float d, float w) {
  return clamp((min(d + u_px * 0.5, w * 0.5) - max(d - u_px * 0.5, -w * 0.5)) / u_px, 0.0, 1.0);
}
void main() {
  float d = sdBox(v_p, u_box, u_radius);
  vec4 result = vec4(0.0);
  if (u_sigma > 0.0) {
    float s = 1.41421356 * u_sigma;
    float light = 0.5 * (erf((d + u_width * 0.5) / s) - erf((d - u_width * 0.5) / s));
    result = u_glow * max(0.0, light + (light > 0.002 ? dither() / max(u_glow.a, 0.01) : 0.0));
  }
  vec4 fill = u_fill * clamp(0.5 - d / u_px, 0.0, 1.0);
  result = fill + result * (1.0 - fill.a);
  if (u_width > 0.0) {
    vec4 stroke = u_stroke * band(d, u_width);
    if (u_sweep > 0.0) {
      // Only near one angle round the box, measured as if it were square.
      vec2 at = (v_p - u_box.xy - u_box.zw * 0.5) / (u_box.zw * 0.5);
      float off = mod(atan(at.y, at.x) - u_sweepAt + 3.14159265, 6.2831853) - 3.14159265;
      stroke *= exp(-(off * off) / (u_sweep * u_sweep));
    }
    result = stroke + result * (1.0 - stroke.a);
  }
  color = result;
}`;

// The Gaussian blur of a rounded box, in closed form along x and summed in
// four steps along y (Evan Wallace, "Fast Rounded Rectangle Shadows").
const SHADOW_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_p;
uniform vec4 u_box, u_color;
uniform float u_radius, u_sigma;
out vec4 color;
${DITHER}
vec2 erf(vec2 x) {
  vec2 s = sign(x), a = abs(x);
  x = 1.0 + (0.278393 + (0.230389 + 0.078108 * (a * a)) * a) * a;
  x *= x;
  return s - s / (x * x);
}
float gaussian(float x, float sigma) {
  return exp(-(x * x) / (2.0 * sigma * sigma)) / (2.5066282746 * sigma);
}
float shadowX(float x, float y, float sigma, float corner, vec2 half_) {
  float delta = min(half_.y - corner - abs(y), 0.0);
  float curved = half_.x - corner + sqrt(max(0.0, corner * corner - delta * delta));
  vec2 integral = 0.5 + 0.5 * erf((x + vec2(-curved, curved)) * (0.70710678 / sigma));
  return integral.y - integral.x;
}
void main() {
  vec2 half_ = u_box.zw * 0.5;
  vec2 point = v_p - u_box.xy - half_;
  float corner = min(u_radius, min(half_.x, half_.y));
  float low = point.y - half_.y, high = point.y + half_.y;
  float start = clamp(-3.0 * u_sigma, low, high);
  float end = clamp(3.0 * u_sigma, low, high);
  float step = (end - start) / 4.0;
  float y = start + step * 0.5;
  float value = 0.0;
  for (int i = 0; i < 4; i++) {
    value += shadowX(point.x, point.y - y, u_sigma, corner, half_) * gaussian(y, u_sigma) * step;
    y += step;
  }
  color = u_color * max(0.0, value + (value > 0.002 ? dither() / max(u_color.a, 0.01) : 0.0));
}`;

// A band along a spine, soft at its edges, its brightness a gradient along
// the straight line u_from to u_to as a canvas gradient is, with a bright
// core down its middle. Past the half plane at u_cut it is cut off.
const BEAM_VERTEX = `#version 300 es
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_across;
layout(location = 2) in float a_along;
uniform vec2 u_pane;
out vec2 v_p;
out vec2 v_across;
out float v_along;
void main() {
  v_p = a_position;
  v_across = a_across;
  v_along = a_along;
  vec2 clip = a_position / u_pane * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const BEAM_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_p;
in vec2 v_across;
in float v_along;
uniform vec2 u_from, u_to, u_cutAt, u_cutAlong;
uniform vec3 u_bandStops, u_coreStops;
uniform vec3 u_color;
uniform float u_bandMid, u_coreMid, u_coreWidth, u_alpha, u_px, u_additive, u_reach, u_pulse;
out vec4 color;
${DITHER}
float ramp(float t, vec3 stops, float mid) {
  return t < mid ? mix(stops.x, stops.y, t / mid) : mix(stops.y, stops.z, (t - mid) / (1.0 - mid));
}
void main() {
  vec2 axis = u_to - u_from;
  float t = clamp(dot(v_p - u_from, axis) / max(dot(axis, axis), 1e-6), 0.0, 1.0);
  float d = v_across.x, half_ = v_across.y;
  float inBand = clamp((half_ - abs(d)) / u_px + 0.5, 0.0, 1.0);
  float w = u_coreWidth * 0.5;
  float inCore = clamp((min(d + u_px * 0.5, w) - max(d - u_px * 0.5, -w)) / u_px, 0.0, 1.0);
  float band = ramp(t, u_bandStops, u_bandMid) * inBand;
  float core = ramp(t, u_coreStops, u_coreMid) * inCore;
  float cut = dot(u_cutAlong, u_cutAlong) > 0.0 ? clamp(0.5 - dot(v_p - u_cutAt, u_cutAlong) / u_px, 0.0, 1.0) : 1.0;
  float grown = u_reach >= 1.0 ? 1.0 : clamp((u_reach - v_along) / 0.05 + 0.5, 0.0, 1.0);
  float pulse = 0.0;
  if (u_pulse >= 0.0) {
    float off = (v_along - u_pulse) / 0.08;
    pulse = 0.45 * exp(-off * off) * inBand;
  }
  float light = min(1.0, band + core - (1.0 - u_additive) * band * core + pulse) * cut * grown * u_alpha;
  if (light > 0.002) light = max(0.0, light + dither());
  color = vec4(u_color * light, light);
}`;

export function createQuad(gl) {
  const array = gl.createVertexArray();
  gl.bindVertexArray(array);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return array;
}

/** What both the desk and the net beams draw with. `pane` and `px` are set
 *  per frame (`frame`). */
export function createShapes(gl) {
  const quad = createQuad(gl);
  const box = linkProgram(gl, QUAD_VERTEX, BOX_FRAGMENT);
  const shadow = linkProgram(gl, QUAD_VERTEX, SHADOW_FRAGMENT);
  const beam = linkProgram(gl, BEAM_VERTEX, BEAM_FRAGMENT);
  const beamArray = gl.createVertexArray();
  const beamBuffer = gl.createBuffer();
  gl.bindVertexArray(beamArray);
  gl.bindBuffer(gl.ARRAY_BUFFER, beamBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 8);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 20, 16);
  gl.bindVertexArray(null);
  let pane = { w: 1, h: 1 };
  let px = 1;
  // What is bound, so a run of alike draws does not set it again.
  let usedProgram = null;
  let boundArray = null;
  let blendMode = null;
  const paneOf = new Map();

  const use = (program, array) => {
    if (usedProgram !== program) {
      gl.useProgram(program.handle);
      usedProgram = program;
    }
    if (boundArray !== array) {
      gl.bindVertexArray(array);
      boundArray = array;
    }
    const seen = paneOf.get(program);
    if (!seen || seen.w !== pane.w || seen.h !== pane.h) {
      gl.uniform2f(program.u.u_pane, pane.w, pane.h);
      paneOf.set(program, pane);
    }
  };
  const blend = (additive) => {
    if (blendMode === additive) return;
    if (blendMode === null) gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
    blendMode = additive;
  };
  const stretch = (program, x, y, w, h) => {
    use(program, quad);
    gl.uniform4f(program.u.u_rect, x, y, w, h);
  };
  const paintQuad = () => gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  return {
    frame(w, h, dpr) {
      pane = { w, h };
      px = 1 / dpr;
    },
    blend,
    stretch,
    paintQuad,
    /** After GL state was changed behind these shapes' back. */
    invalidate() {
      usedProgram = null;
      boundArray = null;
      blendMode = null;
    },
    /** A rounded box: filled, stroked on its edge, the stroke blurred into a glow. */
    box({ rect, radius = 0, fill = null, fillAlpha = 1, stroke = null, strokeAlpha = 1, strokeWidth = 0, glow = null, glowAlpha = 1, glowBlur = 0, additive = false, sweep = null }) {
      const sigma = glow && glowBlur > 0 ? glowBlur / 2 : 0;
      const margin = strokeWidth / 2 + 3 * sigma + 2 * px;
      blend(additive);
      stretch(box, rect.x - margin, rect.y - margin, rect.w + 2 * margin, rect.h + 2 * margin);
      gl.uniform4f(box.u.u_box, rect.x, rect.y, rect.w, rect.h);
      gl.uniform1f(box.u.u_radius, Math.min(radius, rect.w / 2, rect.h / 2));
      gl.uniform1f(box.u.u_width, stroke ? strokeWidth : 0);
      gl.uniform1f(box.u.u_sigma, sigma);
      gl.uniform1f(box.u.u_px, px);
      gl.uniform1f(box.u.u_sweep, sweep ? sweep.width : 0);
      gl.uniform1f(box.u.u_sweepAt, sweep ? sweep.angle : 0);
      gl.uniform4fv(box.u.u_fill, fill ? premultiplied(fill, fillAlpha) : [0, 0, 0, 0]);
      gl.uniform4fv(box.u.u_stroke, stroke ? premultiplied(stroke, strokeAlpha) : [0, 0, 0, 0]);
      gl.uniform4fv(box.u.u_glow, sigma ? premultiplied(glow, glowAlpha) : [0, 0, 0, 0]);
      paintQuad();
    },
    /** The soft shadow a rounded box casts (a canvas's shadowBlur `blur`). */
    shadow({ rect, radius = 0, blur, drop = 0, color, alpha = 1 }) {
      const sigma = Math.max(0.01, blur / 2);
      const margin = 3 * sigma + 1;
      blend(false);
      stretch(shadow, rect.x - margin, rect.y + drop - margin, rect.w + 2 * margin, rect.h + 2 * margin);
      gl.uniform4f(shadow.u.u_box, rect.x, rect.y + drop, rect.w, rect.h);
      gl.uniform1f(shadow.u.u_radius, radius);
      gl.uniform1f(shadow.u.u_sigma, sigma);
      gl.uniform4fv(shadow.u.u_color, premultiplied(color, alpha));
      paintQuad();
    },
    /**
     * A beam along `spine` ([{ x, y, nx, ny, half }]). `band` and `core` are
     * `{ stops: [a0, a1, a2], mid }`, read along the line `from` to `to`;
     * `cut` is `{ at, along }`, past which nothing is drawn. `reach` (0 to 1)
     * is how far along it has grown, `pulse` where a pulse of light is on
     * it (negative: none).
     */
    beam({ spine, from, to, color, alpha = 1, band, core, coreWidth, cut = null, additive = false, reach = 1, pulse = -1 }) {
      const margin = coreWidth / 2 + 2 * px;
      const vertices = new Float32Array(spine.length * 10);
      const distances = [0];
      for (let i = 1; i < spine.length; i++) distances.push(distances[i - 1] + Math.hypot(spine[i].x - spine[i - 1].x, spine[i].y - spine[i - 1].y));
      const length = distances.at(-1) || 1;
      spine.forEach((p, i) => {
        const out = Math.max(p.half, coreWidth / 2) + margin;
        const along = distances[i] / length;
        vertices.set([p.x + p.nx * out, p.y + p.ny * out, out, p.half, along, p.x - p.nx * out, p.y - p.ny * out, -out, p.half, along], i * 10);
      });
      blend(additive);
      use(beam, beamArray);
      gl.bindBuffer(gl.ARRAY_BUFFER, beamBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
      const [r, g, b] = cssColor(color);
      const u = beam.u;
      gl.uniform2f(u.u_from, from.x, from.y);
      gl.uniform2f(u.u_to, to.x, to.y);
      gl.uniform3f(u.u_color, r, g, b);
      gl.uniform3fv(u.u_bandStops, band.stops);
      gl.uniform1f(u.u_bandMid, band.mid);
      gl.uniform3fv(u.u_coreStops, core.stops);
      gl.uniform1f(u.u_coreMid, core.mid);
      gl.uniform1f(u.u_coreWidth, coreWidth);
      gl.uniform1f(u.u_alpha, alpha);
      gl.uniform1f(u.u_px, px);
      gl.uniform1f(u.u_additive, additive ? 1 : 0);
      gl.uniform1f(u.u_reach, reach);
      gl.uniform1f(u.u_pulse, pulse);
      gl.uniform2f(u.u_cutAt, cut ? cut.at.x : 0, cut ? cut.at.y : 0);
      gl.uniform2f(u.u_cutAlong, cut ? cut.along.x : 0, cut ? cut.along.y : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, spine.length * 2);
    },
  };
}
