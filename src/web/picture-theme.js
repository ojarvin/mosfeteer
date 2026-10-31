/**
 * Pictures follow the theme (Settings → Display): in the dark theme, a
 * pasted picture on a light background (a screenshot, a scanned page, a
 * plot) is shown inverted, hues kept, so it reads as the drawing around it
 * does. A picture on a dark or colorful background is left as it is. A
 * browser preference, like the theme: the picture stored in the design and
 * its exports are unchanged.
 *
 * A picture is judged once per source by its edge: light when most of the
 * opaque pixels along it are near white, or, with a transparent edge, when
 * its ink is dark. The pictures on the drawing, in the notes, and in a
 * reference window carry `light-picture` once judged; the stylesheet
 * inverts them only in the dark theme with this setting on.
 */

import { invertPicturesButton } from './elements.js';
import { hintLine } from './status-bar-ui.js';

const SETTING_KEY = 'mosfeteer.invertPictures';
const PICTURES = 'image.image-annotation, img.note-picture, img.reference-picture';
// The size a picture is judged at: enough for its edge, cheap to read.
const SAMPLE = 48;

let on = (() => {
  try { return globalThis.localStorage?.getItem(SETTING_KEY) === '1'; } catch { return false; }
})();

export function picturesFollowTheme() {
  return on;
}

export function setPicturesFollowTheme(next) {
  on = !!next;
  try { globalThis.localStorage?.setItem(SETTING_KEY, on ? '1' : ''); } catch { /* per-session only */ }
  sync();
  hintLine(on ? 'light pictures invert in the dark theme' : 'pictures shown as pasted');
}

function sync() {
  document.documentElement.classList.toggle('invert-pictures', on);
  invertPicturesButton?.setAttribute('aria-checked', String(on));
}

/** Whether pixel data (RGBA, `size`×`size`) is a picture on a light background. */
export function lightBackground(data, size) {
  const luminance = (at) => (0.2126 * data[at] + 0.7152 * data[at + 1] + 0.0722 * data[at + 2]) / 255;
  let edge = 0;
  let light = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (x > 0 && y > 0 && x < size - 1 && y < size - 1) continue;
      const at = (y * size + x) * 4;
      if (data[at + 3] < 128) continue;
      edge++;
      if (luminance(at) > 0.85) light++;
    }
  }
  if (edge > 2 * size) return light >= 0.8 * edge;
  // A transparent edge: the paper shows through, so dark ink needs turning.
  let ink = 0;
  let sum = 0;
  for (let at = 0; at < data.length; at += 4) {
    if (data[at + 3] < 128) continue;
    ink++;
    sum += luminance(at);
  }
  return ink > 0 && sum / ink < 0.5;
}

const judged = new Map(); // src → true, false, or a pending promise

function judge(src) {
  if (judged.has(src)) return judged.get(src);
  const pending = new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = SAMPLE;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(image, 0, 0, SAMPLE, SAMPLE);
        resolve(lightBackground(ctx.getImageData(0, 0, SAMPLE, SAMPLE).data, SAMPLE));
      } catch {
        resolve(false);
      }
    };
    image.onerror = () => resolve(false);
    image.src = src;
  }).then((light) => {
    judged.set(src, light);
    return light;
  });
  judged.set(src, pending);
  return pending;
}

function sourceOf(el) {
  return el.getAttribute('href') || el.getAttribute('src') || '';
}

function mark(el) {
  const src = sourceOf(el);
  // A design drawn into a reference window is already in the theme.
  if (!src.startsWith('data:image/') || src.startsWith('data:image/svg')) {
    el.classList.remove('light-picture');
    return;
  }
  const known = judged.get(src);
  if (typeof known === 'boolean') {
    el.classList.toggle('light-picture', known);
    return;
  }
  el.classList.remove('light-picture');
  judge(src).then((light) => {
    if (sourceOf(el) === src) el.classList.toggle('light-picture', light);
  });
}

function markWithin(node) {
  if (node.nodeType !== 1) return;
  if (node.matches(PICTURES)) mark(node);
  for (const el of node.querySelectorAll(PICTURES)) mark(el);
}

export function installPictureTheme() {
  invertPicturesButton?.addEventListener('click', () => setPicturesFollowTheme(!on));
  sync();
  // Pictures come and go as the drawing and the notes are redrawn; a judged
  // source is marked before the frame is painted.
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') {
        if (record.target.matches?.(PICTURES)) mark(record.target);
      } else for (const node of record.addedNodes) markWithin(node);
    }
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'href'] });
  markWithin(document.body);
}
