/**
 * The accent color of the editor's own interface (selection, the active
 * tool, focus, a toggle that is on): the default teal, or one of the
 * drawing's palette colors (core/style.js), chosen under Settings → Display.
 * A UI preference, kept in this browser like the theme; the drawing and
 * its exports never change with it.
 *
 * A swatch is shaded for each theme: darker in the light one, so accent
 * text keeps its contrast on white, and the swatch itself in the dark one;
 * each with its faint tint (`--accent-dim`). The values are literal colors,
 * so code that reads `--accent` (the Atlas's canvas) gets one it can draw.
 */

import { COLOR_PALETTE } from '../core/style.js';

const KEY = 'mosfeteer.accent';

/** The choices, the default first (null: the stylesheet's own teal). */
export const ACCENT_CHOICES = [null, ...Object.keys(COLOR_PALETTE).filter((token) => token !== 'gray')];

function channels(hex) {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
}

/** `a` mixed toward `b` by `t` (0..1), as #rrggbb. */
export function mixHex(a, b, t) {
  const [x, y] = [channels(a), channels(b)];
  return `#${x.map((c, i) => Math.round(c + (y[i] - c) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** A swatch's accent and tint in each theme. */
export function accentShades(swatch) {
  return {
    light: mixHex(swatch, '#000000', 0.3),
    lightDim: mixHex(swatch, '#ffffff', 0.8),
    dark: mixHex(swatch, '#000000', 0.12),
    darkDim: mixHex(swatch, '#111111', 0.72),
  };
}

export function currentAccent() {
  try {
    const token = localStorage.getItem(KEY);
    return token && COLOR_PALETTE[token] ? token : null;
  } catch { return null; }
}

/** Use `token` (a palette color, or null for the default) as the accent. */
export function applyAccent(token) {
  const root = document.documentElement;
  const swatch = token && COLOR_PALETTE[token];
  if (!swatch) {
    delete root.dataset.accent;
    for (const name of ['light', 'light-dim', 'dark', 'dark-dim']) root.style.removeProperty(`--accent-${name}`);
  } else {
    const shades = accentShades(swatch);
    root.style.setProperty('--accent-light', shades.light);
    root.style.setProperty('--accent-light-dim', shades.lightDim);
    root.style.setProperty('--accent-dark', shades.dark);
    root.style.setProperty('--accent-dark-dim', shades.darkDim);
    root.dataset.accent = token;
  }
  try {
    if (swatch) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch { /* per-session only */ }
  syncAccentMenu();
}

function syncAccentMenu() {
  const current = document.documentElement.dataset.accent || '';
  for (const button of document.querySelectorAll('#settings-accent [data-accent]')) {
    button.setAttribute('aria-checked', String(button.dataset.accent === current));
  }
}

/** The swatches under Settings → Display, and the accent kept from last time. */
export function installAccent() {
  const row = document.getElementById('settings-accent');
  if (row) {
    for (const token of ACCENT_CHOICES) {
      const name = token ? token[0].toUpperCase() + token.slice(1) : 'Default';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `swatch${token ? '' : ' swatch-default'}`;
      button.setAttribute('role', 'menuitemradio');
      button.dataset.accent = token || '';
      button.setAttribute('aria-label', name);
      button.title = name;
      button.style.setProperty('--swatch', token ? COLOR_PALETTE[token] : 'var(--accent-default, #0e7c7b)');
      button.addEventListener('click', () => applyAccent(token));
      row.append(button);
    }
  }
  applyAccent(currentAccent());
}
