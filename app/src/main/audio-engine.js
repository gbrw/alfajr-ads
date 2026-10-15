'use strict';
// واجهة العملية الرئيسية لمحرك الصوت في النافذة المخفية.
const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { EventEmitter } = require('events');
const { resolveData } = require('./paths');

class AudioEngine extends EventEmitter {
  constructor() {
    super();
    this.win = null;
    this.seq = 0;
    this.pending = new Map();
    this.ready = null;
  }

  start() {
    ipcMain.on('audio:reply', (e, { id, result, error }) => {
      if (!this.win || e.sender !== this.win.webContents) return;
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      clearTimeout(p.timer);
      if (error) p.reject(new Error(error)); else p.resolve(result);
    });
    ipcMain.on('audio:event', (e, payload) => {
      if (!this.win || e.sender !== this.win.webContents) return;
      this.emit(payload.type, payload);
    });
    this._create();
  }

  _create() {
    this.win = new BrowserWindow({
      show: false,
      width: 200, height: 100,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'audio-preload.js'),
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
        contextIsolation: true,
        sandbox: true,
      },
    });
    this.ready = this.win.loadFile(path.join(__dirname, '..', 'renderer', 'audio.html'));
    // إن انهارت النافذة نعيد إنشاءها ليستمر النظام
    this.win.webContents.on('render-process-gone', (_e, details) => {
      this.emit('crashed', details);
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('توقف محرك الصوت')); }
      this.pending.clear();
      try { this.win.destroy(); } catch { /* ignore */ }
      setTimeout(() => this._create(), 1000);
    });
  }

  async call(cmd, args, timeoutMs = 30000) {
    await this.ready;
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('انتهت مهلة محرك الصوت: ' + cmd)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.win.webContents.send('audio:cmd', { id, cmd, args });
    });
  }

  /** مسار نسبي في مكتبة التطبيق ← رابط file:// بعد التحقق من وجود الملف. */
  static urlFor(rel) {
    const full = resolveData(rel);
    if (!full || !fs.existsSync(full)) return null;
    return pathToFileURL(full).href;
  }

  async probe(rel) {
    const url = AudioEngine.urlFor(rel);
    if (!url) return null;
    const r = await this.call('probe', { url });
    return r?.duration || null;
  }
}

module.exports = { AudioEngine };
