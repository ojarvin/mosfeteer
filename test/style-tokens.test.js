import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EASE_IN, EASE_IN_OUT, EASE_OUT, EASE_SPRING, cssEase } from '../src/web/easing.js';

const css = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');

test('colors live in the theme tokens: no raw color outside a custom property', () => {
  const raw = css.split('\n')
    .map((line, i) => ({ line: line.trim(), at: i + 1 }))
    .filter(({ line }) => !line.startsWith('--') && !line.startsWith('/*') && !line.startsWith('*'))
    // An attribute selector naming an SVG's fill or stroke is not a color used.
    .map(({ line, at }) => ({ line: line.replace(/\[(?:fill|stroke)="#[0-9a-f]+"\]/gi, ''), at }))
    // Darkening a token by mixing in black is the theme's own color.
    .filter(({ line }) => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(line.replace(/, #000\)/g, ')')));
  assert.deepEqual(raw, []);
});

test('every text field and select takes its size from the field tokens, dense rows a smaller one', () => {
  const base = css.slice(css.indexOf('select,\ninput[type="text"],'), css.indexOf('}', css.indexOf('select,\ninput[type="text"],')));
  assert.match(base, /height: var\(--field-h\);/);
  assert.match(base, /padding: 0 var\(--field-pad-x\);/);
  assert.match(css, /\.signal-flow-section, \.plots-window[^{]*\{\s*--field-h: var\(--control-h-sm\);/);
  // No field rule sets its own height beside the tokens.
  assert.doesNotMatch(css, /(?:input|select)[^{}]*\{[^}]*\bheight: var\(--control-h(?:-sm)?\)/);
});

test('motion uses the one easing family: the tokens match easing.js, and no rule eases on its own curve', () => {
  const tokens = { '--ease-out': EASE_OUT, '--ease-in': EASE_IN, '--ease-in-out': EASE_IN_OUT, '--ease-spring': EASE_SPRING };
  for (const [name, curve] of Object.entries(tokens)) assert.match(css, new RegExp(`${name}: ${cssEase(curve).replace(/[().]/g, '\\$&')};`));
  const own = css.split('\n')
    .map((line, i) => ({ line: line.trim(), at: i + 1 }))
    .filter(({ line }) => !line.startsWith('--') && !line.startsWith('/*') && !line.startsWith('*'))
    .filter(({ line }) => /cubic-bezier\(|\bease(?:-in|-out|-in-out)?\b|var\(--var\(/.test(line.replace(/var\(--ease-[a-z-]+\)/g, '')));
  assert.deepEqual(own, []);
  // An animation or transition names its curve; the browser's default ease is not one of ours.
  const unnamed = [...css.matchAll(/^\s*(?:animation|transition):([^;]*);/gm)]
    .map((m) => m[1].trim())
    .filter((value) => value !== 'none' && !/none !important/.test(value) && !/var\(--ease-|\blinear\b|steps\(/.test(value));
  assert.deepEqual(unnamed, []);
});

test('an entrance from a from-only keyframe fills backwards: none holds its element once it ends', () => {
  const fromOnly = new Set([...css.matchAll(/@keyframes ([\w-]+)\s*\{\s*from\s*\{[^}]*\}\s*\}/g)].map((m) => m[1]));
  const held = [...css.matchAll(/animation:\s*([\w-]+)[^;]*\b(?:both|forwards)\b/g)].map((m) => m[1]).filter((name) => fromOnly.has(name));
  assert.ok(fromOnly.has('menu-in') && fromOnly.has('rise-in'));
  assert.deepEqual(held, []);
});

test('a menu entrance never fades the glass or what holds it: the frame and blur grow in', () => {
  for (const name of ['menu-in', 'context-menu-in', 'glass-in']) {
    const body = css.match(new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1];
    assert.ok(body, name);
    assert.doesNotMatch(body, /opacity/, name);
  }
  assert.match(css, /\.component-context-menu:not\(\[hidden\]\)::before,\s*\.component-context-menu \.context-submenu:not\(\.context-submenu-scroll\)::before \{\s*animation: glass-in /);
  // Every submenu is a panel with the menu's entrance, never one of its parent's rising items.
  assert.match(css, /\.component-context-menu:not\(\[hidden\]\),\s*\.component-context-menu \.context-submenu:not\(\.context-submenu-scroll\) \{\s*animation: context-menu-in /);
  assert.match(css, /\.component-context-menu \.context-submenu\.context-submenu-scroll \{\s*animation: menu-in /);
  assert.match(css, /> :not\(\.context-menu-group, \.context-submenu\) \{\s*animation: menu-item-in var\(--motion-fast\) var\(--ease-out\) backwards;\s*\}/);
});
