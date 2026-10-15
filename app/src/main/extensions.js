'use strict';
/*
 * إدارة إضافات المتصفح المدمج. Electron لا يتذكر الإضافات بعد الإغلاق ولا يقبل إلا غير المضغوطة،
 * لذلك تُحمَّل كل الإضافات المفعّلة عند كل إقلاع في الجلسة الدائمة.
 */
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { P } = require('./paths');

const BUNDLED = [{ id: 'ublock-origin', dir: 'ublock-origin', name: 'uBlock Origin' }];

class Extensions extends EventEmitter {
  constructor({ db, logger }) {
    super();
    this.db = db;
    this.logger = logger;
    this.status = {}; // id -> { loaded, extId, version, name, error, warnings }
  }

  /** يضمن وجود الإضافات المرفقة في القائمة (مفعّلة افتراضياً). */
  seed() {
    this.db.update((d) => {
      for (const b of BUNDLED) {
        if (!d.extensions.find((e) => e.id === b.id) && fs.existsSync(path.join(P.bundledExtensions, b.dir, 'manifest.json'))) {
          d.extensions.push({ id: b.id, name: b.name, source: 'bundled', dir: b.dir, enabled: true });
        }
      }
    });
  }

  dirOf(e) {
    return e.source === 'bundled' ? path.join(P.bundledExtensions, e.dir) : path.join(P.userExtensions, e.dir);
  }

  async loadAll(ses) {
    this.seed();
    for (const e of this.db.get().extensions) {
      if (e.enabled) await this.load(ses, e);
      else this.status[e.id] = { loaded: false, error: null };
    }
    this.emit('state');
  }

  async load(ses, e) {
    const dir = this.dirOf(e);
    try {
      if (!fs.existsSync(path.join(dir, 'manifest.json'))) throw new Error('مجلد الإضافة غير موجود أو لا يحتوي manifest.json');
      const warnings = [];
      const onWarn = (w) => { if (w && w.name === 'ExtensionLoadWarning') warnings.push(String(w.message)); };
      process.on('warning', onWarn);
      const ext = await ses.extensions.loadExtension(dir, { allowFileAccess: true });
      setTimeout(() => process.off('warning', onWarn), 1000);
      this.status[e.id] = { loaded: true, extId: ext.id, version: ext.version, name: ext.name, error: null, warnings };
      this.logger.info('adblock', `تم تحميل الإضافة ${ext.name} ${ext.version}`, { status: 'success' });
    } catch (err) {
      this.status[e.id] = { loaded: false, error: err.message };
      this.logger.error('adblock', `فشل تحميل الإضافة ${e.name}: ${err.message}`, { status: 'fail' });
    }
    this.emit('state');
  }

  unload(ses, e) {
    const st = this.status[e.id];
    if (st?.extId) { try { ses.extensions.removeExtension(st.extId); } catch { /* ignore */ } }
    this.status[e.id] = { loaded: false, error: null };
    this.emit('state');
  }

  async setEnabled(ses, id, enabled) {
    const e = this.db.get().extensions.find((x) => x.id === id);
    if (!e) return;
    this.db.update(() => { e.enabled = !!enabled; });
    if (enabled) await this.load(ses, e); else this.unload(ses, e);
    this.logger.info('adblock', `${enabled ? 'تفعيل' : 'تعطيل'} الإضافة ${e.name}`);
  }

  /** إضافة إضافة جديدة من مجلد (غير مضغوط): تُنسخ إلى مجلد التطبيق ثم تُحمَّل. */
  async addFromFolder(ses, srcDir) {
    const manifestFile = path.join(srcDir, 'manifest.json');
    if (!fs.existsSync(manifestFile)) throw new Error('المجلد المختار لا يحتوي manifest.json — يجب اختيار مجلد إضافة غير مضغوطة');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    let name = manifest.name || path.basename(srcDir);
    if (name.startsWith('__MSG_')) name = path.basename(srcDir);
    const id = 'user-' + Date.now();
    const dir = id;
    fs.cpSync(srcDir, path.join(P.userExtensions, dir), { recursive: true });
    const entry = { id, name, source: 'user', dir, enabled: true };
    this.db.update((d) => { d.extensions.push(entry); });
    await this.load(ses, entry);
    return entry;
  }

  remove(ses, id) {
    const e = this.db.get().extensions.find((x) => x.id === id);
    if (!e || e.source === 'bundled') throw new Error('لا يمكن حذف إضافة مرفقة مع البرنامج — يمكن تعطيلها فقط');
    this.unload(ses, e);
    this.db.update((d) => { d.extensions = d.extensions.filter((x) => x.id !== id); });
    try { fs.rmSync(path.join(P.userExtensions, e.dir), { recursive: true, force: true }); } catch { /* ignore */ }
    delete this.status[id];
    this.emit('state');
  }

  list() {
    return this.db.get().extensions.map((e) => ({ ...e, status: this.status[e.id] || { loaded: false } }));
  }
}

module.exports = { Extensions };
