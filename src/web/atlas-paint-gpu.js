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

const IMAGE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_image;
uniform float u_alpha, u_bias, u_blur, u_reveal, u_seed;
out vec4 color;
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
  if (u_reveal < 1.0) {
    // The ink comes up from the middle, along an uneven soft edge.
    vec2 p = v_uv - 0.5;
    float a = atan(p.y, p.x);
    float r = length(p) * 1.41421356 + 0.05 * sin(a * 5.0 + u_seed) + 0.03 * sin(a * 9.0 - u_seed * 1.7);
    float edge = u_reveal * 1.5 - 0.2;
    ink *= 1.0 - smoothstep(edge - 0.18, edge, r);
  }
  color = ink * u_alpha;
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
  const mipQuad = createQuad(gl);
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

  return {
    kind: 'gpu',
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
