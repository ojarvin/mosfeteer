import { svgToPngDataUrl, withEmbeddedMathFont } from './drawing-export.js';
import { DEFAULT_PNG_DPI, pngRasterScale } from '../core/png-export.js';

export function pngDataUrlBlob(dataUrl) {
  const prefix = 'data:image/png;base64,';
  if (!dataUrl.startsWith(prefix)) throw new Error('could not create clipboard PNG');
  const binary = atob(dataUrl.slice(prefix.length));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: 'image/png' });
}

/** Copy the drawing as a PNG image only: a text payload beside it (the SVG
 * source) is what some apps, Office on Windows among them, paste instead.
 * The write starts at once with the PNG promised, so it stays within the user
 * gesture. The PNG is `scale` pixels per unit and records `dpi`, as a PNG
 * export does. */
export function writeDrawingToClipboard(svg, {
  dpi = DEFAULT_PNG_DPI,
  scale = pngRasterScale(dpi),
  clipboard = globalThis.navigator?.clipboard,
  ClipboardItem = globalThis.ClipboardItem,
  embedFont = withEmbeddedMathFont,
  rasterize = svgToPngDataUrl,
} = {}) {
  if (!clipboard?.write || !ClipboardItem) throw new Error('image clipboard is unavailable in this browser');
  const png = Promise.resolve().then(() => embedFont(svg)).then((value) => rasterize(value, scale, { dpi })).then(pngDataUrlBlob);
  // A browser can reject the write before consuming the payload promise.
  // Keep a preparation error observed in that case as well.
  png.catch(() => {});
  return clipboard.write([new ClipboardItem({ 'image/png': png })]);
}
