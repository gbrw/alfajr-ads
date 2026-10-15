'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('audioBridge', {
  onCommand: (cb) => ipcRenderer.on('audio:cmd', (_e, msg) => cb(msg)),
  reply: (id, result, error) => ipcRenderer.send('audio:reply', { id, result, error }),
  event: (payload) => ipcRenderer.send('audio:event', payload),
});
