'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set(['state', 'log', 'alert', 'db-changed', 'logs-cleared', 'ext-changed']);

contextBridge.exposeInMainWorld('api', {
  /** يستدعي قناة في العملية الرئيسية؛ يعيد المحاولة إن لم تُسجَّل المعالجات بعد (أثناء الإقلاع). */
  async invoke(channel, ...args) {
    for (let i = 0; ; i++) {
      try {
        return await ipcRenderer.invoke(channel, ...args);
      } catch (e) {
        if (i < 60 && /No handler registered/.test(String(e && e.message))) {
          await new Promise((r) => setTimeout(r, 250));
          continue;
        }
        return { ok: false, error: String((e && e.message) || e) };
      }
    }
  },
  on(event, cb) {
    if (!EVENTS.has(event)) return () => {};
    const fn = (_e, payload) => cb(payload);
    ipcRenderer.on(event, fn);
    return () => ipcRenderer.removeListener(event, fn);
  },
});
