'use strict';
/*
 * السجلات: معلومة / تحذير / خطأ، مع نوع (فئة) وحالة (ناجح/فاشل/مؤجل) للتمييز اللوني.
 * تُحفظ يومياً بملف JSONL داخل مجلد السجلات، والطابع الزمني بنظام 12 ساعة.
 */
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const T = require('../shared/time12');
const { P } = require('./paths');

const LEVELS = { info: 'معلومة', warn: 'تحذير', error: 'خطأ' };
const CATEGORIES = {
  system: 'النظام', scheduler: 'المجدول', adhan: 'الأذان', preadhan: 'تنبيه قبل الأذان', ads: 'الإعلانات',
  azkar: 'الأذكار', background: 'الخلفية', prayers: 'المواقيت', network: 'الإنترنت', adblock: 'مانع الإعلانات',
  migration: 'الترحيل', settings: 'الإعدادات', backup: 'النسخ الاحتياطي',
};
const MAX_MEMORY = 5000;
const KEEP_DAYS = 60;

class Logger extends EventEmitter {
  constructor() {
    super();
    this.entries = [];
    this.seq = 0;
    this.now = () => new Date();
  }

  init() {
    fs.mkdirSync(P.logs, { recursive: true });
    this._prune();
    // تحميل سجلات آخر 7 أيام للعرض
    const files = this._files().slice(-7);
    for (const f of files) {
      for (const line of fs.readFileSync(path.join(P.logs, f), 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { this.entries.push(JSON.parse(line)); } catch { /* سطر تالف */ }
      }
    }
    if (this.entries.length > MAX_MEMORY) this.entries = this.entries.slice(-MAX_MEMORY);
    this.seq = this.entries.reduce((m, e) => Math.max(m, e.id || 0), 0);
  }

  _files() {
    try { return fs.readdirSync(P.logs).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort(); } catch { return []; }
  }

  _prune() {
    const files = this._files();
    for (const f of files.slice(0, Math.max(0, files.length - KEEP_DAYS))) {
      try { fs.unlinkSync(path.join(P.logs, f)); } catch { /* ignore */ }
    }
  }

  log(level, category, message, extra = {}) {
    const d = this.now();
    const entry = {
      id: ++this.seq,
      ts: d.getTime(),
      date: T.dateKey(d),
      stamp: T.stamp(d),
      level,
      category,
      status: extra.status || null, // success | fail | deferred | null
      message,
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_MEMORY) this.entries.splice(0, this.entries.length - MAX_MEMORY);
    try {
      fs.appendFileSync(path.join(P.logs, entry.date + '.jsonl'), JSON.stringify(entry) + '\n', 'utf8');
    } catch { /* لا نوقف النظام بسبب السجل */ }
    if (process.env.ALFAJR_LOG_STDOUT) console.log(`[${entry.stamp}] ${level} ${category}: ${message}`);
    this.emit('entry', entry);
    return entry;
  }

  info(cat, msg, extra) { return this.log('info', cat, msg, extra); }
  warn(cat, msg, extra) { return this.log('warn', cat, msg, extra); }
  error(cat, msg, extra) { return this.log('error', cat, msg, extra); }

  query({ from, to, level, category, status, search, limit = 2000 } = {}) {
    let r = this.entries;
    if (from) r = r.filter((e) => e.date >= from);
    if (to) r = r.filter((e) => e.date <= to);
    if (level) r = r.filter((e) => e.level === level);
    if (category) r = r.filter((e) => e.category === category);
    if (status) r = r.filter((e) => e.status === status);
    if (search) {
      const s = search.toLowerCase();
      r = r.filter((e) => e.message.toLowerCase().includes(s));
    }
    return r.slice(-limit);
  }

  clear() {
    this.entries = [];
    for (const f of this._files()) {
      try { fs.unlinkSync(path.join(P.logs, f)); } catch { /* ignore */ }
    }
    this.emit('cleared');
  }

  toText(entries) {
    return entries.map((e) => `[${e.stamp}] [${LEVELS[e.level] || e.level}] [${CATEGORIES[e.category] || e.category}]` +
      `${e.status ? ' [' + ({ success: 'ناجح', fail: 'فاشل', deferred: 'مؤجل' }[e.status]) + ']' : ''} ${e.message}`).join('\r\n');
  }
}

module.exports = { logger: new Logger(), LEVELS, CATEGORIES };
