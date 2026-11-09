/**
 * The Atlas desk on a 2D canvas: the same drawing operations as the WebGL2
 * painter (atlas-paint-gpu.js), for a browser without a usable GPU.
 */

import { textMeasure } from './gpu.js';

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** A CSS color at `alpha` (a hex color; anything else as it is). */
function withAlpha(color, alpha) {
  const hex = String(color).trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hex) return color;
  const digits = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function createCanvasDesk(canvas) {
  const ctx = canvas.getContext('2d');
  const images = new Map();
  const measured = textMeasure((weight, px) => `${weight} ${px}px ${FONT}`);
  let pane = { w: 1, h: 1, dpr: 1 };

  const roundRect = ({ x, y, w, h }, radius) => {
    ctx.roundRect(x, y, w, h, radius);
  };

  return {
    kind: '2d',
    imageScale: 1,
    maxLargeImages: 24,
    begin({ w, h, dpr, paper, moving }) {
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      pane = { w, h, dpr, moving };
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = paper;
      ctx.fillRect(0, 0, w, h);
    },
    end() { return false; },
    ready(key, bitmap) {
      if (!bitmap) return false;
      images.set(key, bitmap);
      return true;
    },
    rename() {},
    sweep(bitmaps) {
      if (images.size <= bitmaps.size) return;
      for (const key of images.keys()) if (!bitmaps.has(key)) images.delete(key);
    },
    clearImages() { images.clear(); },

    image(key, rect, alpha, { reveal = 1 } = {}) {
      const bitmap = images.get(key);
      if (!bitmap) return;
      // Best filtering at rest; in motion the cheap one, which no one sees.
      ctx.imageSmoothingQuality = pane.moving ? 'low' : 'high';
      // What the GPU shows as ink coming up is a plain fade here.
      ctx.globalAlpha = alpha * Math.min(1, reveal * 1.6);
      ctx.drawImage(bitmap, rect.x, rect.y, rect.w, rect.h);
      ctx.globalAlpha = 1;
    },

    grid({ x, y, k, spacing, color, alpha = 1, clip = null }) {
      const { dpr, w, h } = pane;
      // Whole device pixels: a line straddling two pixels would antialias
      // into a fainter, wider one, and the grid would shimmer unevenly.
      const width = Math.max(1, Math.round(k * dpr));
      const offset = width % 2 ? 0.5 : 0;
      const crisp = (value) => (Math.round(value * dpr) + offset) / dpr;
      ctx.save();
      if (clip) {
        ctx.beginPath();
        roundRect(clip, clip.radius);
        ctx.clip();
      }
      // A line thinner than a pixel shows as a fainter one-pixel line, as
      // the editor's one-unit grid does.
      ctx.globalAlpha = alpha * Math.min(1, (k * dpr) / width);
      ctx.strokeStyle = color;
      ctx.lineWidth = width / dpr;
      ctx.beginPath();
      for (let gx = Math.ceil(x / spacing) * spacing; (gx - x) * k <= w; gx += spacing) {
        const sx = crisp((gx - x) * k);
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, h);
      }
      for (let gy = Math.ceil(y / spacing) * spacing; (gy - y) * k <= h; gy += spacing) {
        const sy = crisp((gy - y) * k);
        ctx.moveTo(0, sy);
        ctx.lineTo(w, sy);
      }
      ctx.stroke();
      ctx.restore();
    },

    box({ rect, radius = 0, fill = null, fillAlpha = 1, stroke = null, strokeAlpha = 1, strokeWidth = 0, glow = null, glowAlpha = 1, glowBlur = 0, additive = false, sweep = null }) {
      if (sweep) return;
      ctx.save();
      if (additive) ctx.globalCompositeOperation = 'lighter';
      ctx.beginPath();
      roundRect(rect, radius);
      if (fill) {
        ctx.globalAlpha = fillAlpha;
        ctx.fillStyle = fill;
        ctx.fill();
      }
      if (stroke) {
        ctx.globalAlpha = strokeAlpha;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = strokeWidth;
        if (glow && glowBlur > 0) {
          ctx.shadowColor = glow;
          ctx.shadowBlur = glowBlur;
          ctx.globalAlpha = strokeAlpha * glowAlpha;
        }
        ctx.stroke();
      }
      ctx.restore();
    },

    raised({ rect, radius, fill, alpha, blur, drop, color }) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = fill;
      ctx.shadowColor = color;
      ctx.shadowBlur = blur;
      ctx.shadowOffsetY = drop;
      ctx.beginPath();
      roundRect(rect, radius);
      ctx.fill();
      ctx.restore();
    },

    measure(text, weight, size) {
      return measured(text, weight, size, (t, font) => {
        ctx.font = font;
        return ctx.measureText(t).width;
      });
    },

    text({ text, weight, size, color, alpha = 1, x, y, baseline = 'top' }) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `${weight} ${size}px ${FONT}`;
      ctx.fillStyle = color;
      ctx.textBaseline = baseline;
      ctx.fillText(text, x, y);
      ctx.restore();
    },

    pool({ cx, cy, r, rx, ry, color, stops, mid, alpha = 1, additive = false }) {
      ctx.save();
      if (additive) ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha;
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      gradient.addColorStop(0, withAlpha(color, stops[0]));
      gradient.addColorStop(mid, withAlpha(color, stops[1]));
      gradient.addColorStop(1, withAlpha(color, stops[2]));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },

    beam({ spine, from, to, color, alpha = 1, band, core, coreWidth, cut = null, additive = false }) {
      ctx.save();
      ctx.globalAlpha = alpha;
      if (additive) ctx.globalCompositeOperation = 'lighter';
      if (cut) {
        const far = 1e5;
        const { at, along: direction } = cut;
        const side = { x: -direction.y, y: direction.x };
        ctx.beginPath();
        ctx.moveTo(at.x + side.x * far, at.y + side.y * far);
        ctx.lineTo(at.x - side.x * far, at.y - side.y * far);
        ctx.lineTo(at.x - side.x * far - direction.x * far, at.y - side.y * far - direction.y * far);
        ctx.lineTo(at.x + side.x * far - direction.x * far, at.y + side.y * far - direction.y * far);
        ctx.closePath();
        ctx.clip();
      }
      const ramp = ({ stops, mid }) => {
        const gradient = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
        gradient.addColorStop(0, withAlpha(color, stops[0]));
        gradient.addColorStop(mid, withAlpha(color, stops[1]));
        gradient.addColorStop(1, withAlpha(color, stops[2]));
        return gradient;
      };
      ctx.fillStyle = ramp(band);
      ctx.beginPath();
      spine.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p.x + p.nx * p.half, p.y + p.ny * p.half));
      for (let i = spine.length - 1; i >= 0; i--) ctx.lineTo(spine[i].x - spine[i].nx * spine[i].half, spine[i].y - spine[i].ny * spine[i].half);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = ramp(core);
      ctx.lineWidth = coreWidth;
      ctx.lineCap = 'round';
      ctx.beginPath();
      spine.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p.x, p.y));
      ctx.stroke();
      ctx.restore();
    },
  };
}
