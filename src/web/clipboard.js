import { svgToPngDataUrl, withEmbeddedMathFont } from './drawing-export.js';
import { DEFAULT_PNG_DPI, pngRasterScale } from '../core/png-export.js';

export function pngDataUrlBlob(dataUrl) {
  const prefix = 'data:image/png;base64,';
  if (!dataUrl.startsWith(prefix)) throw new Error('could not create clipboard PNG');
  const binary = atob(dataUrl.slice(prefix.length));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: 'image/png' });
}

/** Start both clipboard payloads immediately; SVG is carried as plain text for
 * browsers without a portable SVG clipboard image type. The PNG is `scale`
 * pixels per unit and records `dpi`, as a PNG export does. */
export function writeDrawingToClipboard(svg, {
  dpi = DEFAULT_PNG_DPI,
  scale = pngRasterScale(dpi),
  clipboard = globalThis.navigator?.clipboard,
  ClipboardItem = globalThis.ClipboardItem,
  embedFont = withEmbeddedMathFont,
  rasterize = svgToPngDataUrl,
} = {}) {
  if (!clipboard?.write || !ClipboardItem) throw new Error('image clipboard is unavailable in this browser');
  const drawing = Promise.resolve().then(() => embedFont(svg));
  const png = drawing.then((value) => rasterize(value, scale, { dpi })).then(pngDataUrlBlob);
  const text = drawing.then((value) => new Blob([value], { type: 'text/plain' }));
  // A browser can reject the write before consuming either payload promise.
  // Keep preparation errors observed in that case as well.
  png.catch(() => {});
  text.catch(() => {});
  return clipboard.write([new ClipboardItem({ 'image/png': png, 'text/plain': text })]);
}
