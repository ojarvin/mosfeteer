const { contextBridge, ipcRenderer } = require('electron');

const channels = Object.freeze({
  list: 'storage:list',
  create: 'storage:create',
  load: 'storage:load',
  save: 'storage:save',
  delete: 'storage:delete',
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
  export: (options) => ipcRenderer.invoke(channels.export, options),
  closeWindow: () => ipcRenderer.invoke(channels.closeWindow),
}));
