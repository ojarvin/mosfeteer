/**
 * The Atlas desk in WebGL2: the same drawing operations as the 2D painter
 * (atlas-paint-2d.js). Each design is a mipmapped texture, which zooms
 * smoothly at any scale; the grid, shadows, glows, and beams are shaders.
 * Once uploaded, a design's bitmap is closed: the texture is its one copy.
 */

import { DITHER, QUAD_VERTEX, ROUNDED_BOX, createQuad, createShapes, linkProgram, premultiplied, textMeasure } from './gpu.js';

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
/** Pixels of design images uploaded in one frame: the rest wait, so a burst
 *  of arrivals costs no frames. */
const UPLOAD_BYTES_PER_FRAME = 12 * 1024 * 1024;
/** A finer mipmap level than the pixel calls for, its detail averaged over
 *  the pixel by the four taps in the image shader: thin lines stay crisp. */
const LOD_BIAS = -1;
/** Each design is drawn from an image this many times its size on screen,
 *  then scaled down. */
const IMAGE_SCALE = 3;
/** Large images kept: textures take no room in the page, and a desk at rest
 *  can show many designs from them. */
const MAX_LARGE_IMAGES = 72;
/** How far each smaller mipmap level leans from the average of its four
 *  pixels toward the darkest of them, so thin lines survive zooming out. */
const INK_KEPT = 0.45;
const MAX_CAPTIONS = 800;
const TEXT_PAD = 2;

/** How far a design's ink has come up at `uv` (0 to 1 across it): from the
 *  middle out, along an uneven soft edge. */
const REVEAL = `
float revealed(vec2 uv, float reveal, float seed) {
  if (reveal >= 1.0) return 1.0;
  vec2 p = uv - 0.5;
  float a = atan(p.y, p.x);
  float r = length(p) * 1.41421356 + 0.05 * sin(a * 5.0 + seed) + 0.03 * sin(a * 9.0 - seed * 1.7);
  float edge = reveal * 1.5 - 0.2;
  return 1.0 - smoothstep(edge - 0.18, edge, r);
}`;

// A design's ink (atlas-ink.js): one instance a shape, its quad drawn round
// it on screen, its edge smoothed over a pixel by its distance. A line
// thinner than a pixel stays a pixel wide and fades by as much instead.
const INK_VERTEX = `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_a;
layout(location = 2) in vec4 a_b;
layout(location = 3) in vec4 a_color;
uniform vec2 u_pane;
uniform vec4 u_map;
uniform float u_px, u_soft;
out vec2 v_p;
flat out vec4 v_a;
flat out vec4 v_b;
flat out vec4 v_color;
flat out float v_fade;
vec2 place(vec2 p) { return p * u_map.x + u_map.zw; }
void main() {
  int kind = int(a_b.w + 0.5);
  float k = u_map.x;
  float margin = u_soft + u_px;
  vec2 p;
  v_color = a_color;
  v_fade = 1.0;
  if (kind == 0) {
    vec2 p0 = place(a_a.xy), p1 = place(a_a.zw);
    float half_ = a_b.x * k;
    if (half_ < 0.5 * u_px) { v_fade = half_ / (0.5 * u_px); half_ = 0.5 * u_px; }
    vec2 d = p1 - p0;
    float len = length(d);
    vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
    vec2 n = vec2(-dir.y, dir.x);
    float out_ = half_ + margin;
    p = mix(p0 - dir * out_, p1 + dir * out_, a_corner.x) + n * out_ * (a_corner.y * 2.0 - 1.0);
    v_a = vec4(p0, p1);
    v_b = vec4(half_, a_b.y, a_b.z, 0.0);
  } else if (kind == 1 || kind == 2) {
    vec2 c = place(a_a.xy);
    float r = a_a.z * k;
    float half_ = kind == 2 ? a_b.x * k : 0.0;
    if (kind == 2 && half_ < 0.5 * u_px) { v_fade = half_ / (0.5 * u_px); half_ = 0.5 * u_px; }
    if (kind == 1 && r < 0.5 * u_px) { v_fade = (r * r) / (0.25 * u_px * u_px); r = 0.5 * u_px; }
    float out_ = r + half_ + margin;
    p = c + (a_corner * 2.0 - 1.0) * out_;
    v_a = vec4(c, r, half_);
    v_b = vec4(0.0, 0.0, 0.0, float(kind));
  } else {
    vec2 p0 = place(a_a.xy), p1 = place(a_a.zw), p2 = place(a_b.xy);
    vec2 lo = min(p0, min(p1, p2)) - margin, hi = max(p0, max(p1, p2)) + margin;
    p = mix(lo, hi, a_corner);
    v_a = vec4(p0, p1);
    v_b = vec4(p2, a_b.z, 3.0);
  }
  v_p = p;
  vec2 clip = p / u_pane * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const INK_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_p;
flat in vec4 v_a;
flat in vec4 v_b;
flat in vec4 v_color;
flat in float v_fade;
uniform vec4 u_rect;
uniform float u_soft, u_alpha, u_reveal, u_seed;
out vec4 color;
${REVEAL}
float capped(float t, float v, float half_, float cap) {
  if (cap > 1.5) return length(vec2(t, v)) - half_;
  return max(abs(v) - half_, cap > 0.5 ? t - half_ : t);
}
// Outside the edge a to b, by how far (the triangle wound by s).
float side(vec2 a, vec2 b, float s) {
  vec2 e = b - a;
  return -s * (e.x * (v_p.y - a.y) - e.y * (v_p.x - a.x)) / max(length(e), 1e-6);
}
void main() {
  int kind = int(v_b.w + 0.5);
  float d;
  if (kind == 0) {
    vec2 p0 = v_a.xy, p1 = v_a.zw;
    vec2 e = p1 - p0;
    float len = length(e);
    vec2 dir = len > 1e-6 ? e / len : vec2(1.0, 0.0);
    vec2 q = v_p - p0;
    float u = dot(q, dir), v = dot(q, vec2(-dir.y, dir.x));
    float half_ = v_b.x;
    // An end at a mitered corner is cut hard: the corner's wedge takes over.
    if ((u < 0.0 && v_b.y > 2.5) || (u > len && v_b.z > 2.5)) discard;
    if (u < 0.0) d = capped(-u, v, half_, v_b.y);
    else if (u > len) d = capped(u - len, v, half_, v_b.z);
    else d = abs(v) - half_;
  } else if (kind == 1) {
    d = length(v_p - v_a.xy) - v_a.z;
  } else if (kind == 2) {
    d = abs(length(v_p - v_a.xy) - v_a.z) - v_a.w;
  } else {
    vec2 p0 = v_a.xy, p1 = v_a.zw, p2 = v_b.xy;
    float s = sign((p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x));
    int edges = int(v_b.z + 0.5);
    d = -1e6;
    float e0 = side(p0, p1, s), e1 = side(p1, p2, s), e2 = side(p2, p0, s);
    // An edge inside the shape cuts hard at the pixel's middle, so the
    // triangle next to it takes the pixel: no seam between them.
    if ((edges & 1) != 0) d = max(d, e0); else if (e0 > 0.0) discard;
    if ((edges & 2) != 0) d = max(d, e1); else if (e1 > 0.0) discard;
    if ((edges & 4) != 0) d = max(d, e2); else if (e2 > 0.0) discard;
  }
  float cover = clamp(0.5 - d / u_soft, 0.0, 1.0) * v_fade;
  if (cover <= 0.0) discard;
  float shown = revealed((v_p - u_rect.xy) / u_rect.zw, u_reveal, u_seed);
  color = v_color * (cover * shown * u_alpha);
}`;

// A faded design's ink, drawn whole into a layer first, laid on the desk at
// once: where its shapes overlap it is no darker than elsewhere.
const LAYER_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_p;
uniform sampler2D u_layer;
uniform vec4 u_rect;
uniform float u_alpha, u_reveal, u_seed;
out vec4 color;
${REVEAL}
void main() {
  color = texelFetch(u_layer, ivec2(gl_FragCoord.xy), 0) * (u_alpha * revealed((v_p - u_rect.xy) / u_rect.zw, u_reveal, u_seed));
}`;

const IMAGE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_image;
uniform float u_alpha, u_bias, u_blur, u_reveal, u_seed;
out vec4 color;
${REVEAL}
void main() {
  vec4 ink;
  if (u_blur > 0.0) {
    // Out of focus: a coarser mipmap level, four taps around the pixel so
    // its texels do not show.
    vec2 reach = 0.75 * pow(2.0, u_blur) * max(abs(dFdx(v_uv)), abs(dFdy(v_uv)));
    float bias = u_bias + u_blur;
    ink = 0.25 * (texture(u_image, v_uv + reach * vec2(-1.0, -1.0), bias) + texture(u_image, v_uv + reach * vec2(1.0, -1.0), bias)
      + texture(u_image, v_uv + reach * vec2(-1.0, 1.0), bias) + texture(u_image, v_uv + reach * vec2(1.0, 1.0), bias));
  } else {
    // Four taps across the pixel, on a rotated grid.
    vec2 dx = dFdx(v_uv), dy = dFdy(v_uv);
    ink = 0.25 * (texture(u_image, v_uv + 0.375 * dx + 0.125 * dy, u_bias) + texture(u_image, v_uv - 0.375 * dx - 0.125 * dy, u_bias)
      + texture(u_image, v_uv + 0.125 * dx - 0.375 * dy, u_bias) + texture(u_image, v_uv - 0.125 * dx + 0.375 * dy, u_bias));
  }
  color = ink * (u_alpha * revealed(v_uv, u_reveal, u_seed));
}`;

// One rule per device pixel, the same one the 2D grid rounds its lines by,
// so the two match to the pixel and it costs the same at any zoom.
const GRID_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_p;
uniform vec2 u_phase;
uniform float u_height, u_spacing, u_width, u_px, u_clipRadius;
uniform vec4 u_color, u_clip;
out vec4 color;
${ROUNDED_BOX}
float line(float p, float phase) {
  float n = floor((p - phase) / u_spacing + 0.5);
  float first = floor(phase + n * u_spacing + 0.5) - floor(u_width * 0.5);
  return step(first, p) * step(p, first + u_width - 1.0);
}
void main() {
  vec2 pixel = vec2(floor(gl_FragCoord.x), floor(u_height - gl_FragCoord.y));
  float on = max(line(pixel.x, u_phase.x), line(pixel.y, u_phase.y));
  if (u_clip.z > 0.0) on *= clamp(0.5 - sdBox(v_p, u_clip, u_clipRadius) / u_px, 0.0, 1.0);
  color = u_color * on;
}`;

const MIP_VERTEX = `#version 300 es
layout(location = 0) in vec2 a_corner;
out vec2 v_uv;
void main() {
  v_uv = a_corner;
  gl_Position = vec4(a_corner * 2.0 - 1.0, 0.0, 1.0);
}`;

// One mipmap level from the one above it. An average alone thins a line by
// half a level at a time, until it is gone; this keeps part of the strongest
// ink, its color unchanged.
const MIP_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_image;
uniform float u_kept;
out vec4 color;
void main() {
  vec2 t = 0.5 / vec2(textureSize(u_image, 0));
  vec4 a = textureLod(u_image, v_uv + t * vec2(-1.0, -1.0), 0.0);
  vec4 b = textureLod(u_image, v_uv + t * vec2(1.0, -1.0), 0.0);
  vec4 c = textureLod(u_image, v_uv + t * vec2(-1.0, 1.0), 0.0);
  vec4 d = textureLod(u_image, v_uv + t * vec2(1.0, 1.0), 0.0);
  vec4 mean = 0.25 * (a + b + c + d);
  float strongest = max(max(a.a, b.a), max(c.a, d.a));
  color = mean.a > 0.0 ? mean * mix(mean.a, strongest, u_kept) / mean.a : mean;
}`;

const POOL_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_p;
uniform vec2 u_center, u_radii;
uniform vec3 u_stops;
uniform vec3 u_color;
uniform float u_radius, u_mid, u_alpha;
out vec4 color;
${DITHER}
void main() {
  vec2 p = v_p - u_center;
  float t = clamp(length(p) / u_radius, 0.0, 1.0);
  float a = t < u_mid ? mix(u_stops.x, u_stops.y, t / u_mid) : mix(u_stops.y, u_stops.z, (t - u_mid) / (1.0 - u_mid));
  float inside = step(length(p / u_radii), 1.0);
  a *= inside * u_alpha;
  if (a > 0.002) a = max(0.0, a + dither());
  color = vec4(u_color * a, a);
}`;

/** The painter over a live context; throws if its shaders will not build. */
export function createGpuDesk(canvas, gl) {
  const shapes = createShapes(gl);
  const image = linkProgram(gl, QUAD_VERTEX, IMAGE_FRAGMENT);
  const grid = linkProgram(gl, QUAD_VERTEX, GRID_FRAGMENT);
  const pool = linkProgram(gl, QUAD_VERTEX, POOL_FRAGMENT);
  const mip = linkProgram(gl, MIP_VERTEX, MIP_FRAGMENT);
  const inkProgram = linkProgram(gl, INK_VERTEX, INK_FRAGMENT);
  const layerProgram = linkProgram(gl, QUAD_VERTEX, LAYER_FRAGMENT);
  gl.useProgram(layerProgram.handle);
  gl.uniform1i(layerProgram.u.u_layer, 1);
  /** The screen-sized layer faded ink is drawn into: { frame, texture, width, height }. */
  let layer = null;
  const mipQuad = createQuad(gl);
  const corners = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  /** Each design's ink on the GPU: { array, buffer, count }. */
  const inks = new Map();
  const mipTarget = gl.createFramebuffer();
  gl.useProgram(mip.handle);
  gl.uniform1i(mip.u.u_image, 0);
  gl.uniform1f(mip.u.u_kept, INK_KEPT);
  gl.useProgram(image.handle);
  gl.uniform1i(image.u.u_image, 0);
  gl.activeTexture(gl.TEXTURE0);
  const textures = new Map();
  const captions = new Map();
  const scratch = document.createElement('canvas');
  const scratchContext = scratch.getContext('2d', { willReadFrequently: true });
  let pane = { w: 1, h: 1, dpr: 1 };
  let spent = 0;
  let waiting = false;

  const textureOf = (mipmapped) => {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmapped ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  };

  // The image program's last values, which most draws repeat.
  const last = { alpha: null, bias: null, blur: null, reveal: null, seed: null };
  const setImage = (name, location, value) => {
    if (last[name] === value) return;
    gl.uniform1f(location, value);
    last[name] = value;
  };

  const drawTexture = (texture, x, y, w, h, alpha, bias, { blur = 0, reveal = 1, seed = 0 } = {}) => {
    shapes.blend(false);
    shapes.stretch(image, x, y, w, h);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    setImage('alpha', image.u.u_alpha, alpha);
    setImage('bias', image.u.u_bias, bias);
    setImage('blur', image.u.u_blur, blur);
    setImage('reveal', image.u.u_reveal, reveal);
    // The edge's shape only matters while it is coming up.
    if (reveal < 1) setImage('seed', image.u.u_seed, seed);
    shapes.paintQuad();
  };

  /** Fill in the texture's smaller levels from its largest. */
  function buildMipmaps(width, height, levels) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, mipTarget);
    gl.useProgram(mip.handle);
    gl.bindVertexArray(mipQuad);
    gl.disable(gl.BLEND);
    let w = width;
    let h = height;
    for (let level = 1; level < levels; level++) {
      w = Math.max(1, w >> 1);
      h = Math.max(1, h >> 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, level - 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, level - 1);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, gl.getParameter(gl.TEXTURE_BINDING_2D), level);
      gl.viewport(0, 0, w, h);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, levels - 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, pane.width, pane.height);
    shapes.invalidate();
  }

  const fontOf = (weight, px) => `${weight} ${px}px ${FONT}`;
  const measured = textMeasure(fontOf);

  /** One line of text as a texture, kept until it has gone unused the longest. */
  function caption(text, weight, px, color, baseline, moving) {
    const key = `${weight}|${color}|${baseline}|${text}`;
    let entry = captions.get(key);
    if (entry) {
      captions.delete(key);
      captions.set(key, entry);
      if (entry.px === px || moving) return entry;
    }
    scratchContext.font = fontOf(weight, px);
    const width = Math.ceil(scratchContext.measureText(text).width) + 2 * TEXT_PAD;
    const height = Math.ceil(px * 1.5) + 2 * TEXT_PAD;
    scratch.width = width;
    scratch.height = height;
    scratchContext.font = fontOf(weight, px);
    scratchContext.fillStyle = color;
    scratchContext.textBaseline = baseline;
    scratchContext.fillText(text, TEXT_PAD, baseline === 'middle' ? height / 2 : TEXT_PAD);
    if (!entry) {
      entry = { texture: textureOf(false) };
      captions.set(key, entry);
      if (captions.size > MAX_CAPTIONS) {
        const [oldest, old] = captions.entries().next().value;
        gl.deleteTexture(old.texture);
        captions.delete(oldest);
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, entry.texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scratch);
    Object.assign(entry, { px, width, height });
    return entry;
  }

  const layerOf = (width, height) => {
    if (layer?.width === width && layer.height === height) return layer;
    if (layer) {
      gl.deleteFramebuffer(layer.frame);
      gl.deleteTexture(layer.texture);
    }
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.activeTexture(gl.TEXTURE0);
    const frame = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, frame);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    layer = { frame, texture, width, height };
    return layer;
  };

  /** Draw a design's shapes as they are, at `alpha`, revealed so far. */
  const drawInk = (entry, box, rect, { alpha, blur, reveal, seed }) => {
    const k = rect.w / box.w;
    const px = 1 / pane.dpr;
    gl.useProgram(inkProgram.handle);
    gl.bindVertexArray(entry.array);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const u = inkProgram.u;
    gl.uniform2f(u.u_pane, pane.w, pane.h);
    gl.uniform4f(u.u_map, k, k, rect.x - box.x * k, rect.y - box.y * k);
    gl.uniform4f(u.u_rect, rect.x, rect.y, rect.w, rect.h);
    gl.uniform1f(u.u_px, px);
    gl.uniform1f(u.u_soft, px * Math.pow(2, blur * 1.5));
    gl.uniform1f(u.u_alpha, alpha);
    gl.uniform1f(u.u_reveal, reveal);
    gl.uniform1f(u.u_seed, seed);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, entry.count);
    shapes.invalidate();
  };

  const dropInk = (key) => {
    const entry = inks.get(key);
    if (entry?.buffer) {
      gl.deleteBuffer(entry.buffer);
      gl.deleteVertexArray(entry.array);
    }
    inks.delete(key);
  };

  return {
    kind: 'gpu',
    /** Designs are drawn as vectors (inkReady, ink); images hold their text. */
    vector: true,
    imageScale: IMAGE_SCALE,
    maxLargeImages: MAX_LARGE_IMAGES,
    begin({ w, h, dpr, paper }) {
      const width = Math.round(w * dpr);
      const height = Math.round(h * dpr);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      pane = { w, h, dpr, width, height };
      spent = 0;
      waiting = false;
      shapes.frame(w, h, dpr);
      gl.viewport(0, 0, width, height);
      const [r, g, b] = premultiplied(paper);
      gl.clearColor(r, g, b, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
    /** Whether images are still waiting for their turn to upload. */
    end() { return waiting; },

    /** Is this design image on the GPU, or can it go there this frame? */
    ready(key, bitmap) {
      if (textures.has(key)) return true;
      if (!bitmap?.width) return false;
      const bytes = bitmap.width * bitmap.height * 4;
      if (spent && spent + bytes > UPLOAD_BYTES_PER_FRAME) {
        waiting = true;
        return false;
      }
      spent += bytes;
      const texture = textureOf(true);
      const levels = Math.floor(Math.log2(Math.max(bitmap.width, bitmap.height))) + 1;
      gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, bitmap.width, bitmap.height);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
      buildMipmaps(bitmap.width, bitmap.height, levels);
      textures.set(key, texture);
      bitmap.close();
      return true;
    },
    /** The same image under a new key (a design just saved). */
    rename(from, to) {
      const texture = textures.get(from);
      if (!texture) return;
      textures.delete(from);
      textures.set(to, texture);
    },
    /** Drop the textures of images the desk no longer holds. */
    sweep(bitmaps) {
      if (textures.size <= bitmaps.size) return;
      for (const [key, texture] of textures) {
        if (bitmaps.has(key)) continue;
        gl.deleteTexture(texture);
        textures.delete(key);
      }
    },
    clearImages() {
      for (const texture of textures.values()) gl.deleteTexture(texture);
      textures.clear();
      for (const key of [...inks.keys()]) dropInk(key);
    },

    hasInk(key) { return inks.has(key); },
    /** Is this design's ink on the GPU, or can it go there this frame?
     *  `build()` gives its shapes (atlas-ink.js `svgInk`), or null. */
    inkReady(key, build) {
      if (inks.has(key)) return true;
      if (spent && spent > UPLOAD_BYTES_PER_FRAME) {
        waiting = true;
        return false;
      }
      const mesh = build();
      if (!mesh) return false;
      if (!mesh.count) {
        inks.set(key, { count: 0 });
        return true;
      }
      spent += mesh.data.byteLength;
      const array = gl.createVertexArray();
      gl.bindVertexArray(array);
      gl.bindBuffer(gl.ARRAY_BUFFER, corners);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.data, gl.STATIC_DRAW);
      for (let i = 0; i < 3; i++) {
        gl.enableVertexAttribArray(1 + i);
        gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, 48, 16 * i);
        gl.vertexAttribDivisor(1 + i, 1);
      }
      gl.bindVertexArray(null);
      shapes.invalidate();
      inks.set(key, { array, buffer, count: mesh.count });
      return true;
    },
    /** The same ink under a new key (a design just saved). */
    renameInk(from, to) {
      const entry = inks.get(from);
      if (!entry || from === to) return;
      inks.delete(from);
      dropInk(to);
      inks.set(to, entry);
    },
    /** Drop the ink of designs the desk no longer holds (`keys`: those it does). */
    sweepInk(keys) {
      for (const key of [...inks.keys()]) if (!keys.has(key)) dropInk(key);
    },
    /** A design's ink: its drawing's `box` laid on `rect` on screen. Effects
     *  as for `image`: `blur` softens its edges by that many octaves. */
    ink(key, box, rect, alpha, { blur = 0, reveal = 1, seed = 0 } = {}) {
      const entry = inks.get(key);
      if (!entry?.count || !(box?.w > 0) || alpha <= 0) return;
      if (alpha >= 0.999 && reveal >= 1) {
        drawInk(entry, box, rect, { alpha: 1, blur, reveal: 1, seed });
        return;
      }
      // Faded or coming up: drawn whole into the layer, then laid on at once.
      const margin = 2;
      const x0 = Math.max(0, Math.floor(rect.x - margin));
      const y0 = Math.max(0, Math.floor(rect.y - margin));
      const x1 = Math.min(pane.w, Math.ceil(rect.x + rect.w + margin));
      const y1 = Math.min(pane.h, Math.ceil(rect.y + rect.h + margin));
      if (x1 <= x0 || y1 <= y0) return;
      const { dpr, width, height } = pane;
      const target = layerOf(width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.frame);
      gl.enable(gl.SCISSOR_TEST);
      const sx = Math.floor(x0 * dpr);
      const sy = Math.floor(y0 * dpr);
      gl.scissor(sx, height - Math.ceil(y1 * dpr), Math.ceil(x1 * dpr) - sx, Math.ceil(y1 * dpr) - sy);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      drawInk(entry, box, rect, { alpha: 1, blur, reveal: 1, seed });
      gl.disable(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, target.texture);
      gl.activeTexture(gl.TEXTURE0);
      shapes.blend(false);
      shapes.stretch(layerProgram, x0, y0, x1 - x0, y1 - y0);
      const u = layerProgram.u;
      gl.uniform4f(u.u_rect, rect.x, rect.y, rect.w, rect.h);
      gl.uniform1f(u.u_alpha, alpha);
      gl.uniform1f(u.u_reveal, reveal);
      gl.uniform1f(u.u_seed, seed);
      shapes.paintQuad();
    },

    /** `blur`: mipmap levels out of focus; `reveal` (0 to 1): how far its
     *  ink has come up; `seed`: the shape of that edge. */
    image(key, rect, alpha, effects) {
      const texture = textures.get(key);
      if (texture) drawTexture(texture, rect.x, rect.y, rect.w, rect.h, alpha, LOD_BIAS, effects);
    },

    grid({ x, y, k, spacing, color, alpha = 1, clip = null }) {
      const { dpr, w, h } = pane;
      const width = Math.max(1, Math.round(k * dpr));
      const u = grid.u;
      shapes.blend(false);
      shapes.stretch(grid, 0, 0, w, h);
      gl.uniform2f(u.u_phase, (Math.ceil(x / spacing) * spacing - x) * k * dpr, (Math.ceil(y / spacing) * spacing - y) * k * dpr);
      gl.uniform1f(u.u_height, pane.height);
      gl.uniform1f(u.u_spacing, spacing * k * dpr);
      gl.uniform1f(u.u_width, width);
      gl.uniform1f(u.u_px, 1 / dpr);
      gl.uniform4fv(u.u_color, premultiplied(color, alpha * Math.min(1, (k * dpr) / width)));
      gl.uniform4f(u.u_clip, clip?.x ?? 0, clip?.y ?? 0, clip?.w ?? 0, clip?.h ?? 0);
      gl.uniform1f(u.u_clipRadius, clip?.radius ?? 0);
      shapes.paintQuad();
    },

    box: shapes.box,

    /** A shadow, and the box that casts it over it. */
    raised({ rect, radius, fill, alpha, blur, drop, color }) {
      shapes.shadow({ rect, radius, blur, drop, color, alpha });
      shapes.box({ rect, radius, fill, fillAlpha: alpha });
    },

    measure(text, weight, size) {
      return measured(text, weight, size, (t, font) => {
        scratchContext.font = font;
        return scratchContext.measureText(t).width;
      });
    },

    text({ text, weight, size, color, alpha = 1, x, y, baseline = 'top', moving = false }) {
      if (!text) return;
      const { dpr } = pane;
      const px = size * dpr;
      const entry = caption(text, weight, px, color, baseline, moving);
      const ratio = px / entry.px;
      const w = (entry.width * ratio) / dpr;
      const h = (entry.height * ratio) / dpr;
      const pad = (TEXT_PAD * ratio) / dpr;
      const left = x - pad;
      const top = baseline === 'middle' ? y - h / 2 : y - pad;
      // At its own size each texel lands on one pixel.
      const snap = (value) => (ratio === 1 ? Math.round(value * dpr) / dpr : value);
      drawTexture(entry.texture, snap(left), snap(top), w, h, alpha, 0);
    },

    pool({ cx, cy, r, rx, ry, color, stops, mid, alpha = 1, additive = false }) {
      const [red, green, blue] = premultiplied(color);
      const u = pool.u;
      shapes.blend(additive);
      shapes.stretch(pool, cx - rx, cy - ry, 2 * rx, 2 * ry);
      gl.uniform2f(u.u_center, cx, cy);
      gl.uniform2f(u.u_radii, rx, ry);
      gl.uniform1f(u.u_radius, r);
      gl.uniform3fv(u.u_stops, stops);
      gl.uniform1f(u.u_mid, mid);
      gl.uniform3f(u.u_color, red, green, blue);
      gl.uniform1f(u.u_alpha, alpha);
      shapes.paintQuad();
    },

    beam: shapes.beam,
  };
}
