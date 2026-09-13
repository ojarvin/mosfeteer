import { app, BrowserWindow, Menu, dialog, ipcMain } from 'electron';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { createNativeStorage, validCircuitName } from './storage.js';
import { startDevHotReload } from './hot-reload.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const INDEX = join(ROOT, 'src', 'web', 'index.html');
const PRELOAD = fileURLToPath(new URL('./preload.cjs', import.meta.url));
let mainWindow;
let storage;
let stopHotReload;
let lastOpenedPath;

const EXPORT_EXTENSIONS = new Set(['svg', 'pdf', 'png', 'json']);

function svgDimensions(svg) {
  const root = String(svg).match(/<svg\b[^>]*>/i)?.[0] || '';
  const width = Number(root.match(/\bwidth="([\d.]+)"/i)?.[1]);
  const height = Number(root.match(/\bheight="([\d.]+)"/i)?.[1]);
  return {
    width: Number.isFinite(width) && width > 0 ? width : 1000,
    height: Number.isFinite(height) && height > 0 ? height : 800,
  };
}

async function pdfFromSvg(svg) {
  const { width, height } = svgDimensions(svg);
  const printWindow = new BrowserWindow({
    show: false,
    width: Math.max(1, Math.min(4096, Math.ceil(width))),
    height: Math.max(1, Math.min(4096, Math.ceil(height))),
    webPreferences: { sandbox: true },
  });
  const html = `<!doctype html><html><head><style>@page{size:${width}px ${height}px;margin:0}html,body{margin:0;padding:0;background:#fff}svg{display:block;width:${width}px;height:${height}px}</style></head><body>${svg}</body></html>`;
  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await printWindow.webContents.executeJavaScript('document.fonts?.ready ? document.fonts.ready.then(() => true) : true');
    return await printWindow.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy();
  }
}

function trusted(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('untrusted renderer');
}

async function registerPersistence() {
  const userData = app.getPath('userData');
  const root = join(userData, 'circuits');
  lastOpenedPath = join(userData, 'last-opened.json');
  storage = createNativeStorage(root);
  const importMarker = join(userData, '.repository-circuits-imported');
  try {
    await readFile(importMarker);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await storage.importFrom(join(ROOT, 'circuits'));
    await writeFile(importMarker, '1\n', { flag: 'wx' });
  }
  ipcMain.handle('storage:list', (event) => { trusted(event); return storage.list(); });
  ipcMain.handle('storage:create', (event, name, kind) => { trusted(event); return storage.create(name, kind); });
  ipcMain.handle('storage:load', (event, name) => { trusted(event); return storage.load(name); });
  ipcMain.handle('storage:save', (event, name, state) => { trusted(event); return storage.save(name, state); });
  ipcMain.handle('storage:delete', (event, name) => { trusted(event); return storage.delete(name); });
  ipcMain.handle('storage:last-opened', async (event) => {
    trusted(event);
    try {
      const data = JSON.parse(await readFile(lastOpenedPath, 'utf8'));
      return validCircuitName(data?.name) || null;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  });
  ipcMain.handle('storage:mark-opened', async (event, name) => {
    trusted(event);
    const safe = name ? validCircuitName(name) : null;
    if (name && !safe) throw new Error('invalid circuit name');
    await writeFile(lastOpenedPath, JSON.stringify({ name: safe }), 'utf8');
    return safe;
  });
  ipcMain.handle('storage:export', async (event, options = {}) => {
    trusted(event);
    const requestedFormats = Array.isArray(options.formats) ? options.formats : [options.format || options.extension || 'svg'];
    const formats = [...new Set(requestedFormats.filter((format) => EXPORT_EXTENSIONS.has(format)))];
    if (!formats.length) throw new Error('no valid export formats selected');
    const content = typeof options.content === 'string' ? options.content : null;
    const pngDataUrl = typeof options.pngDataUrl === 'string' ? options.pngDataUrl : options.dataUrl;
    const validPngDataUrl = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(pngDataUrl || '');
    if ((formats.includes('png') && !validPngDataUrl) ||
        (formats.some((format) => format !== 'png') && (content === null || content.length > 10_000_000)) ||
        (pngDataUrl && pngDataUrl.length > 60_000_000)) throw new Error('invalid export content');
    const rawSuggested = basename(String(options.suggestedName || 'circuit'));
    const base = rawSuggested.replace(/\.[A-Za-z0-9]+$/, '') || 'circuit';
    // Linux Electron/GTK can emit a stale signal-handler warning when the
    // asynchronous native chooser is torn down. The synchronous variant uses
    // the same native UI but completes its lifecycle before returning.
    const selectedPath = dialog.showSaveDialogSync(mainWindow, {
      title: 'Choose export location',
      defaultPath: join(app.getPath('pictures'), `${base}.${formats[0]}`),
      filters: [{ name: 'Export files', extensions: formats }],
      // Keep overwrite confirmation in the native file dialog rather than
      // showing a second application-level prompt.
      properties: ['showOverwriteConfirmation'],
    });
    if (!selectedPath) return { canceled: true };
    const directory = dirname(selectedPath);
    const selectedBase = basename(selectedPath).replace(/\.[A-Za-z0-9]+$/, '') || base;
    const paths = [];
    const pngBuffer = formats.includes('png')
      ? Buffer.from(pngDataUrl.slice('data:image/png;base64,'.length), 'base64')
      : null;
    for (const format of formats) {
      const filePath = join(directory, `${selectedBase}.${format}`);
      if (format === 'png') await writeFile(filePath, pngBuffer);
      else if (format === 'pdf') await writeFile(filePath, await pdfFromSvg(content));
      else await writeFile(filePath, content, 'utf8');
      paths.push(filePath);
    }
    return { canceled: false, directory, paths, ...(paths.length === 1 ? { path: paths[0] } : {}) };
  });
  ipcMain.handle('window:close', (event) => {
    trusted(event);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 1000,
    minWidth: 960,
    minHeight: 640,
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  await mainWindow.loadFile(INDEX);
  if (process.env.SCHEMATIC_SPAWNER_SMOKE === '1') {
    console.log('SCHEMATIC_SPAWNER_READY');
    setTimeout(() => app.quit(), 50);
  }
  mainWindow.on('closed', () => {
    stopHotReload?.();
    stopHotReload = null;
    mainWindow = null;
  });
  if (!app.isPackaged && process.env.SCHEMATIC_SPAWNER_HOT_RELOAD === '1') {
    // Reloading keeps the renderer's localStorage draft, which is its crash-safe
    // unsaved-work boundary; never enable this path for packaged applications.
    stopHotReload = startDevHotReload({
      directories: [
        join(ROOT, 'src', 'web'),
        join(ROOT, 'src', 'desktop'),
        join(ROOT, 'src', 'core'),
      ],
      reload: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload(); },
    });
  }
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await registerPersistence();
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((error) => {
  console.error(`Could not start desktop app: ${error.stack || error.message}`);
  app.exit(1);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
