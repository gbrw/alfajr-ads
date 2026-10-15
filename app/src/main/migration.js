'use strict';
/*
 * أداة الترحيل: تستورد حزمة AlfajrRadio_Migration (الصوتيات + JSON + CSV) إلى قاعدة البيانات.
 * تعمل تلقائياً عند أول تشغيل من النسخة المرفقة بالبرنامج، أو يدوياً من الإعدادات.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const T = require('../shared/time12');
const { P, toDataRelative } = require('./paths');
const prayers = require('./prayers');

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));

/** "assets/ads/x.wav" ← ينسخ إلى library/ads/x.wav ويعيد المسار النسبي الجديد. */
function importAsset(pkgDir, rel, report) {
  if (!rel) return null;
  const src = path.join(pkgDir, rel);
  if (!fs.existsSync(src)) {
    report.warnings.push(`الملف الصوتي غير موجود في الحزمة: ${rel}`);
    return null;
  }
  const category = rel.split('/')[1] || 'ads';
  const destDir = path.join(P.library, category);
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, path.basename(rel));
  if (!fs.existsSync(dest) || fs.statSync(dest).size !== fs.statSync(src).size) fs.copyFileSync(src, dest);
  report.files++;
  return toDataRelative(dest);
}

function isMigrationPackage(dir) {
  return !!dir && fs.existsSync(path.join(dir, 'data', 'settings.json')) && fs.existsSync(path.join(dir, 'data', 'prayer-times.csv'));
}

/**
 * يطبّق الحزمة على كائن قاعدة البيانات (يعدّله مباشرة) ويعيد تقريراً.
 */
function applyPackage(data, pkgDir) {
  const report = { files: 0, warnings: [], notes: [] };
  const d = path.join(pkgDir, 'data');

  // الإعدادات
  const s = readJson(path.join(d, 'settings.json'));
  const st = data.settings;
  if (s.volume) Object.assign(st.volume, s.volume);
  if (s.ducking) Object.assign(st.ducking, s.ducking);
  // طلب المشرف: الأصوات تتوقف تماماً (لا تُخفض) أثناء الأذان والإعلانات والأذكار
  st.ducking.mode = 'pause';
  if (s.timeWindow) {
    st.timeWindow.enabled = !!s.timeWindow.enabled;
    st.timeWindow.start = T.normalize12(s.timeWindow.start);
    st.timeWindow.end = T.normalize12(s.timeWindow.end);
  }
  if (s.startup) st.startup.runOnWindowsStartup = s.startup.runOnWindowsStartup !== false;

  // الأذان
  const pr = readJson(path.join(d, 'prayers.json'));
  data.prayers = pr.map((p) => {
    const audio = importAsset(pkgDir, p.audio, report);
    const preAudio = importAsset(pkgDir, p.preAdhan?.audio, report);
    if (p.preAdhan?.enabled && !p.preAdhan?.audio) {
      report.warnings.push(`ملف تنبيه ما قبل أذان ${p.name} غير موجود في الحزمة — تُرك فارغاً، يرجى اختيار ملف من شاشة المواقيت.`);
    }
    return {
      key: p.key, name: p.name, enabled: !!p.enabled, audio,
      preAdhan: { enabled: !!p.preAdhan?.enabled, minutesBefore: Number(p.preAdhan?.minutesBefore) || 10, audio: preAudio },
    };
  });

  // الإعلانات
  const ads = readJson(path.join(d, 'ads.json'));
  data.ads = ads.map((a) => ({
    id: a.id || crypto.randomUUID(),
    name: a.name,
    audio: importAsset(pkgDir, a.audio, report),
    playTime: T.normalize12(a.playTime),
    repeatCount: Number(a.repeatCount) || 1,
    repeatIntervalSeconds: Number(a.repeatIntervalSeconds) || 0,
    enabled: a.enabled !== false,
    priority: a.priority === 'emergency' ? 'emergency' : 'normal',
    startDate: a.startDate || null,
    endDate: a.endDate || null,
    weekdays: Array.isArray(a.weekdays) ? a.weekdays : [0, 1, 2, 3, 4, 5, 6],
  }));

  // الأذكار (نسبية للشروق والمغرب)
  const az = readJson(path.join(d, 'azkar.json'));
  data.azkar = az.map((z) => ({
    id: z.id || crypto.randomUUID(),
    name: z.name,
    audio: importAsset(pkgDir, z.audio, report),
    schedule: {
      anchor: z.schedule?.anchor || 'sunrise',
      direction: z.schedule?.direction === 'before' ? 'before' : 'after',
      offsetMinutes: Number(z.schedule?.offsetMinutes) || 0,
    },
    enabled: z.enabled !== false,
  }));
  report.notes.push('أذكار الصباح بعد الشروق بـ 30 دقيقة وأذكار المساء بعد العصر بـ 15 دقيقة — قيم مؤقتة — يحددهما المشرف من شاشة الأذكار.');

  // جدول السنة
  const tbl = prayers.parseCsvFile(path.join(d, 'prayer-times.csv'));
  data.prayerTimes = tbl.table;
  data.prayerTimesSource = { type: 'migration-csv', importedAt: new Date().toISOString(), days: tbl.count };
  if (tbl.warnings.length) report.warnings.push(...tbl.warnings.map((w) => 'المواقيت: ' + w));
  report.prayerDays = tbl.count;

  // الخلفية المحلية (القرآن) — فارغة في الحزمة
  const quranFile = path.join(pkgDir, 'legacy', 'original-json', 'quran.json');
  if (fs.existsSync(quranFile)) {
    const q = readJson(quranFile);
    if (!Array.isArray(q) || q.length === 0) report.notes.push('قسم القرآن في النظام القديم فارغ — لا توجد تلاوات لنقلها إلى الخلفية المحلية.');
  }

  data.meta.migratedAt = new Date().toISOString();
  data.meta.migrationSource = path.basename(pkgDir);
  return report;
}

module.exports = { applyPackage, isMigrationPackage };
