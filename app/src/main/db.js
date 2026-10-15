'use strict';
/*
 * قاعدة بيانات محلية بملف JSON واحد مع كتابة ذرّية (ملف مؤقت ثم إعادة تسمية) ونسخة احتياطية تلقائية.
 * الافتراض: حجم البيانات صغير (جدول سنة = 366 صفاً) فلا حاجة لمحرك SQL أصلي يحتاج بناءً خاصاً لـ Electron.
 * كل الأوقات المخزنة بنظام 12 ساعة "hh:mm AM".
 */
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { P } = require('./paths');

const SCHEMA_VERSION = 1;

const PRAYER_KEYS = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
const PRAYER_NAMES = {
  fajr: 'الفجر', sunrise: 'الشروق', dhuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء',
};

function defaultDb() {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: { createdAt: null, migratedAt: null, migrationSource: null },
    settings: {
      city: 'الرمادي',
      volume: { master: 0.7, ads: 0.7, adhan: 1.0, preadhan: 1.0, azkar: 0.7, background: 0.7 },
      // كتم مستقل لكل نوع (يُحفظ ويُستعاد عند فتح البرنامج)
      mute: { master: false, ads: false, adhan: false, preadhan: false, azkar: false, background: false },
      ducking: {
        mode: 'pause', // pause = إيقاف كامل بتدرّج ثم استئناف (طلب المشرف)، duck = خفض إلى مستوى
        duckedLevel: 0.4,
        fadeOutSeconds: 3,
        fadeInSeconds: 3,
        silenceBeforePrioritySeconds: 2,
        silenceAfterSeconds: 2,
        resumeBackgroundBetweenAdRepeats: true,
        pauseBackgroundDuringAdhan: true,
      },
      timeWindow: {
        enabled: true,
        start: '07:00 AM',
        end: '12:00 AM',
        applyTo: { adhan: true, ads: true, azkar: true, background: true },
      },
      startup: { runOnWindowsStartup: true },
      reliability: { missedEventGraceMinutes: 2, preventSleep: true },
      background: {
        source: 'browser', // browser | local
        autoFallbackToLocal: true,
        homeUrl: 'https://www.youtube.com/',
        lastUrl: null,
      },
      adblock: {
        mode: 'auto', // auto | ublock | builtin | both | off
        // يوتيوب: mute = لا حجب داخل يوتيوب (يكتشف المانع ويوقف الفيديو) مع كتم صوت الإعلان حتى ينتهي؛ block = حجب
        youtubeMode: 'mute',
        lastListUpdate: null,
      },
      security: { passwordHash: null, salt: null },
    },
    prayers: [],
    prayerTimes: {}, // "M-D" -> { fajr: "05:43 AM", ... }
    prayerTimeOverrides: {}, // "M-D" -> { asr: "03:20 PM" } تعديلات يدوية لا تُمحى عند إعادة الاستيراد
    prayerTimesSource: null,
    prayerOffsets: { fajr: 0, sunrise: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 }, // تقديم/تأخير بالدقائق
    ads: [],
    azkar: [],
    localBackground: { reciters: [], activeReciterId: null, shuffle: false },
    extensions: [],
    audioMeta: {},
    runtime: { firedKeys: {}, lastRunAt: null },
  };
}

/** يدمج الافتراضات العميقة مع البيانات المحفوظة (لإضافة حقول جديدة بعد التحديث). */
function deepDefaults(target, defaults) {
  for (const [k, v] of Object.entries(defaults)) {
    if (target[k] === undefined) target[k] = structuredClone(v);
    else if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      deepDefaults(target[k], v);
    }
  }
  return target;
}

class Db extends EventEmitter {
  constructor(file = P.db) {
    super();
    this.file = file;
    this.data = null;
    this._saveTimer = null;
    this.existedBefore = false;
  }

  load() {
    this.existedBefore = fs.existsSync(this.file);
    if (this.existedBefore) {
      try {
        this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      } catch (e) {
        // ملف تالف (مثلاً بعد انقطاع كهرباء): نحاول النسخة الاحتياطية
        const bak = this.file + '.bak';
        if (fs.existsSync(bak)) {
          this.data = JSON.parse(fs.readFileSync(bak, 'utf8'));
          this.recoveredFromBackup = true;
        } else throw e;
      }
    } else {
      this.data = defaultDb();
      this.data.meta.createdAt = new Date().toISOString();
    }
    // مستوى التنبيه قبل الأذان كان مشتركاً مع الأذان: نبدأ من نفس قيمة الأذان
    const vol = this.data.settings?.volume;
    if (vol && vol.preadhan === undefined && vol.adhan !== undefined) vol.preadhan = vol.adhan;
    deepDefaults(this.data, defaultDb());
    return this;
  }

  get() { return this.data; }

  /** تعديل متزامن ثم حفظ مؤجل قصير. */
  /** silent: تحديث بيانات تشغيلية لا تغيّر الجداول (لا يعيد بناء الخطة ولا يحدّث الواجهة). */
  update(fn, { immediate = false, silent = false } = {}) {
    const r = fn(this.data);
    if (!silent) this.emit('change', this.data);
    if (immediate) this.saveNow(); else this._scheduleSave();
    return r;
  }

  _scheduleSave() {
    if (this.frozen) return;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.saveNow(), 300);
  }

  saveNow() {
    clearTimeout(this._saveTimer);
    if (this.frozen) return; // أثناء الاستعادة من نسخة احتياطية
    this._saveTimer = null;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const json = JSON.stringify(this.data, null, 2);
    const tmp = this.file + '.tmp';
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, json);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    if (fs.existsSync(this.file)) {
      try { fs.copyFileSync(this.file, this.file + '.bak'); } catch { /* ignore */ }
    }
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Db, defaultDb, deepDefaults, PRAYER_KEYS, PRAYER_NAMES, SCHEMA_VERSION };
