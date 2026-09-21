import { svgPixelSize } from '../core/render.js';

export async function svgToPngDataUrl(svg, scale = 4) {
  const { width, height } = svgPixelSize(svg);
  const image = new Image();
  // A Blob URL gives SVGs an opaque origin. Chromium then taints the canvas
  // when the SVG contains foreignObject/MathML equation labels. A data URL is
  // origin-clean for this self-contained SVG and remains exportable.
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('could not rasterize SVG for PNG export'));
    image.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width * scale));
  canvas.height = Math.max(1, Math.ceil(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('PNG export requires canvas support');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

export function applyExportDarkTheme(svg) {
  // The editor's dark theme normally recolors the inline SVG with CSS. An
  // exported SVG is standalone, so bake the same palette into its attributes
  // without touching the live document or its theme state.
  return String(svg)
    .replace(/var\(--paper,\s*#fff\)/gi, '#15171c')
    .replace(/var\(--grid,\s*#ddd\)/gi, '#22262e')
    .replace(/var\(--text,\s*#111\)/gi, '#dde1e8')
    .replace(/var\(--svg-ink,\s*#111\)/gi, '#dde1e8')
    .replace(/#e9e9e9\b/gi, '#22262e')
    .replace(/#eee\b/gi, '#22262e')
    .replace(/#fff\b/gi, '#15171c')
    .replace(/#111\b/gi, '#dde1e8');
}

// An exported drawing leaves this page: a standalone SVG, a PNG rasterized
// from it, and the server's PDF print all lose the stylesheet that loads the
// math font. Embedding the face makes exported equations look like the ones on
// screen instead of falling back to a Times clone. Only drawings that actually
// carry math pay the ~0.5 MB.
let mathFontFaceCss = null;

async function embeddedMathFontFace() {
  if (mathFontFaceCss !== null) return mathFontFaceCss;
  try {
    const fontUrl = globalThis.__MOSFETEER_FONT_URL || 'fonts/latinmodern-math.woff2';
    const bytes = new Uint8Array(await (await fetch(fontUrl)).arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    mathFontFaceCss = `@font-face{font-family:"Latin Modern Math";src:url(data:font/woff2;base64,${btoa(binary)}) format("woff2");font-weight:normal;font-style:normal}`;
  } catch {
    mathFontFaceCss = ''; // an export without the face still renders, in the fallback face
  }
  return mathFontFaceCss;
}

export async function withEmbeddedMathFont(svg) {
  if (!svg.includes('schematic-math-label')) return svg;
  const face = await embeddedMathFontFace();
  return face ? svg.replace(/(<svg\b[^>]*>)/, `$1<style>${face}</style>`) : svg;
}
