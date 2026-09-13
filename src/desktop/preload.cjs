const { contextBridge, ipcRenderer } = require('electron');

const channels = Object.freeze({
  list: 'storage:list',
  create: 'storage:create',
  load: 'storage:load',
  save: 'storage:save',
  delete: 'storage:delete',
  lastOpened: 'storage:last-opened',
  markOpened: 'storage:mark-opened',
  export: 'storage:export',
  closeWindow: 'window:close',
});

contextBridge.exposeInMainWorld('schematicStorage', Object.freeze({
  isDesktop: true,
  list: () => ipcRenderer.invoke(channels.list),
  create: (name, kind) => ipcRenderer.invoke(channels.create, name, kind),
  load: (name) => ipcRenderer.invoke(channels.load, name),
  save: (name, state) => ipcRenderer.invoke(channels.save, name, state),
  delete: (name) => ipcRenderer.invoke(channels.delete, name),
  lastOpened: () => ipcRenderer.invoke(channels.lastOpened),
  markOpened: (name) => ipcRenderer.invoke(channels.markOpened, name),
  export: (options) => ipcRenderer.invoke(channels.export, options),
  closeWindow: () => ipcRenderer.invoke(channels.closeWindow),
}));
