'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const T = require('../src/shared/time12');

process.env.ALFAJR_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'alfajr-test-'));
const { ensureDirs } = require('../src/main/paths');
const { defaultDb } = require('../src/main/db');
const { applyPackage } = require('../src/main/migration');
const { planDay, windowAllows } = require('../src/main/planner');

const PKG = path.join(__dirname, '..', 'resources', 'migration', 'AlfajrRadio_Migration');
ensureDirs();
const db = defaultDb();
const report = applyPackage(db, PKG);

test('الترحيل: الملفات والإعدادات', () => {
  assert.strictEqual(report.files, 12); // 5 أذان + 4 تنبيه + 2 أذكار + 1 إعلان
  assert.ok(report.warnings.some((w) => w.includes('الفجر')), 'تحذير تنبيه الفجر المفقود');
  assert.strictEqual(db.prayers.find((p) => p.key === 'fajr').preAdhan.audio, null);
  assert.strictEqual(db.ads[0].playTime, '11:40 PM');
  assert.strictEqual(db.settings.timeWindow.end, '12:00 AM');
  assert.ok(fs.existsSync(path.join(process.env.ALFAJR_DATA_DIR, db.ads[0].audio)));
  const json = JSON.stringify(db);
  assert.ok(!/C:\\Users/i.test(json), 'لا مسارات مطلقة');
});

test('خطة 9 أكتوبر', () => {
  const ev = planDay(db, new Date(2026, 9, 9));
  const at = (id) => T.formatDateTime12(ev.find((e) => e.id.endsWith(id)).at, false);
  assert.strictEqual(ev.find((e) => e.id.endsWith('adhan|fajr')), undefined, 'الفجر معطّل');
  assert.strictEqual(at('|adhan|dhuhr'), '11:59 AM');
  assert.strictEqual(at('|adhan|asr'), '03:15 PM');
  assert.strictEqual(at('|adhan|maghrib'), '05:44 PM');
  assert.strictEqual(at('|adhan|isha'), '06:59 PM');
  assert.strictEqual(at('|preadhan|asr'), '03:05 PM');
  assert.strictEqual(at('azkar|morning_azkar'), '06:36 AM'); // 06:06 + 30
  assert.strictEqual(at('azkar|evening_azkar'), '03:30 PM'); // العصر 03:15 + 15
  const ad = ev.find((e) => e.type === 'ad');
  assert.strictEqual(T.formatDateTime12(ad.at, false), '11:40 PM');
  assert.strictEqual(ad.repeatCount, 3);
  assert.strictEqual(ad.repeatIntervalSeconds, 300);
});

test('الأذكار تتغير يومياً مع الجدول', () => {
  const a = planDay(db, new Date(2026, 0, 1)).find((e) => e.id.endsWith('morning_azkar'));
  const b = planDay(db, new Date(2026, 5, 21)).find((e) => e.id.endsWith('morning_azkar'));
  assert.notStrictEqual(a.sec, b.sec);
  assert.strictEqual(T.formatDateTime12(a.at, false), '07:40 AM'); // 07:10 + 30
});

test('نافذة ساعات العمل', () => {
  const s = db.settings;
  assert.ok(!windowAllows(s, 'azkar', new Date(2026, 5, 21, 5, 20)));
  assert.ok(windowAllows(s, 'ads', new Date(2026, 5, 21, 23, 50)));
  s.timeWindow.applyTo.azkar = false;
  assert.ok(windowAllows(s, 'azkar', new Date(2026, 5, 21, 5, 20)));
  s.timeWindow.applyTo.azkar = true;
});

test('أيام الأسبوع وتاريخ البداية/النهاية للإعلان', () => {
  const ad = db.ads[0];
  ad.weekdays = [5]; // الجمعة
  assert.strictEqual(planDay(db, new Date(2026, 9, 9)).filter((e) => e.type === 'ad').length, 1); // 9 أكتوبر 2026 جمعة
  assert.strictEqual(planDay(db, new Date(2026, 9, 10)).filter((e) => e.type === 'ad').length, 0);
  ad.weekdays = [0, 1, 2, 3, 4, 5, 6];
  ad.endDate = '2026-10-09';
  assert.strictEqual(planDay(db, new Date(2026, 9, 10)).filter((e) => e.type === 'ad').length, 0);
  ad.endDate = null;
});
