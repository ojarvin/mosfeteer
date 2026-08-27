import { execFileSync } from 'node:child_process';

/**
 * Rasterize an SVG file to PNG using whatever is available on the host.
 * Tries rsvg-convert, then Inkscape, then ImageMagick.
 */
export function svgToPng(svgPath, pngPath, width = 1400) {
  const attempts = [
    { cmd: 'rsvg-convert', args: ['-w', String(width), '-o', pngPath, svgPath], tool: 'rsvg-convert' },
    { cmd: 'inkscape', args: ['--export-type=png', `--export-filename=${pngPath}`, `--export-width=${width}`, svgPath], tool: 'inkscape' },
    { cmd: 'magick', args: ['-background', 'white', '-density', '120', '-resize', `${width}x`, svgPath, pngPath], tool: 'magick' },
    { cmd: 'convert', args: ['-background', 'white', '-density', '120', '-resize', `${width}x`, svgPath, pngPath], tool: 'convert' },
  ];
  let lastErr;
  for (const a of attempts) {
    try {
      execFileSync(a.cmd, a.args, { stdio: 'pipe' });
      return { tool: a.tool };
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`no SVG rasterizer available (tried ${attempts.map((a) => a.cmd).join(', ')}): ${lastErr?.message || ''}`);
}