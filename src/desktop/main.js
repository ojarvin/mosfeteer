import { app, BrowserWindow, Menu, dialog, ipcMain } from 'electron';
import { basename, join } from 'node:path';
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

function trusted(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('untrusted renderer');
}

async function registerPersistence() {
  const userData = app.getPath('userData');
  const root = join(userData, 'circuits');
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
  ipcMain.handle('storage:export', async (event, options = {}) => {
    trusted(event);
    const content = typeof options.content === 'string' ? options.content : null;
    if (content === null || content.length > 10_000_000) throw new Error('invalid export content');
    const extension = options.extension === 'json' ? 'json' : 'svg';
    const fallback = validCircuitName(options.suggestedName) || 'circuit';
    const suggestedName = basename(String(options.suggestedName || `${fallback}.${extension}`));
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: join(app.getPath('documents'), suggestedName.endsWith(`.${extension}`) ? suggestedName : `${suggestedName}.${extension}`),
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await writeFile(result.filePath, content, 'utf8');
    return { canceled: false, path: result.filePath };
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
