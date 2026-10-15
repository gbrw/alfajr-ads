'use strict';
/*
 * جدول مواقيت السنة: الاستيراد (CSV / Excel) مع تصحيح AM/PM، وحساب أوقات أي يوم.
 * الجدول مرتبط بالشهر واليوم فقط (بدون سنة) ويُستخدم كل عام.
 */
const fs = require('fs');
const T = require('../shared/time12');
const { PRAYER_KEYS, PRAYER_NAMES } = require('./db');

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // فبراير 29 لتغطية السنة الكبيسة

/** نطاقات منطقية (بالثواني) للتحذير — مستخرجة من فحص سنة الرمادي كاملة مع هامش. */
const SANE_RANGES = {
  fajr: ['03:00 AM', '06:15 AM'],
  sunrise: ['04:30 AM', '07:45 AM'],
  dhuhr: ['11:30 AM', '12:45 PM'],
  asr: ['02:15 PM', '04:30 PM'],
  maghrib: ['04:45 PM', '07:45 PM'],
  isha: ['06:00 PM', '09:30 PM'],
};

const dayKeyOf = (month, day) => `${month}-${day}`;
const dayKeyFromDate = (d) => dayKeyOf(d.getMonth() + 1, d.getDate());

function isRealDay(month, day) {
  return month >= 1 && month <= 12 && day >= 1 && day <= DAYS_IN_MONTH[month - 1];
}

/**
 * قاعدة التصحيح لأوقات Excel المخزنة بنظام 12 ساعة بدون AM/PM:
 * الفجر والشروق صباحاً؛ الظهر كما هو (11 صباحاً، 12 ظهراً، 1–10 بعد الظهر)؛ العصر والمغرب والعشاء بعد الظهر.
 * قيمة ساعة ≥ 13 تعني أنها أصلاً بنظام 24 فتُقبل كما هي.
 */
function correctAmPm(key, h, m) {
  let hour = h;
  if (hour >= 13) return hour * 3600 + m * 60;
  if (key === 'fajr' || key === 'sunrise') {
    if (hour === 12) hour = 0;
  } else if (key === 'dhuhr') {
    if (hour >= 1 && hour <= 10) hour += 12;
  } else if (hour < 12) {
    hour += 12;
  }
  return hour * 3600 + m * 60;
}

/** يستخرج (ساعة، دقيقة) من خلية Excel: تاريخ، رقم كسري، أو نص "2:55". */
function cellToHM(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    let total = Math.round((v.getUTCHours() * 60 + v.getUTCMinutes()) + v.getUTCSeconds() / 60);
    return { h: Math.floor(total / 60) % 24, m: total % 60 };
  }
  if (typeof v === 'number') {
    const total = Math.round((v % 1) * 1440);
    return { h: Math.floor(total / 60) % 24, m: total % 60 };
  }
  if (typeof v === 'object' && v.result !== undefined) return cellToHM(v.result); // خلية صيغة
  if (typeof v === 'object' && v.text !== undefined) return cellToHM(v.text);
  const s = String(v).trim();
  if (T.isValid12(s)) {
    const sec = T.parse12(s);
    return { h: Math.floor(sec / 3600), m: Math.floor((sec % 3600) / 60), explicit: true };
  }
  const mm = /^(\d{1,2})\s*[:.]\s*(\d{2})/.exec(s);
  if (mm) return { h: Number(mm[1]), m: Number(mm[2]) };
  return null;
}

/** يتحقق من يوم واحد: ترتيب منطقي ونطاقات. يعيد قائمة تحذيرات نصية. */
function validateDay(month, day, secs) {
  const warnings = [];
  const label = `${day}/${month}`;
  for (let i = 1; i < PRAYER_KEYS.length; i++) {
    const a = PRAYER_KEYS[i - 1];
    const b = PRAYER_KEYS[i];
    if (secs[a] != null && secs[b] != null && secs[b] <= secs[a]) {
      warnings.push(`${label}: ${PRAYER_NAMES[b]} (${T.format12(secs[b])}) ليس بعد ${PRAYER_NAMES[a]} (${T.format12(secs[a])})`);
    }
  }
  for (const k of PRAYER_KEYS) {
    if (secs[k] == null) { warnings.push(`${label}: وقت ${PRAYER_NAMES[k]} مفقود`); continue; }
    const [lo, hi] = SANE_RANGES[k].map(T.parse12);
    if (secs[k] < lo || secs[k] > hi) warnings.push(`${label}: ${PRAYER_NAMES[k]} ${T.format12(secs[k])} خارج النطاق المعتاد`);
  }
  return warnings;
}

function finalizeTable(rawDays) {
  // rawDays: Map key -> {month, day, secs}
  const table = {};
  const warnings = [];
  let skipped = 0;
  for (const { month, day, secs } of rawDays) {
    if (!isRealDay(month, day)) { skipped++; continue; }
    warnings.push(...validateDay(month, day, secs));
    const row = {};
    for (const k of PRAYER_KEYS) row[k] = secs[k] != null ? T.format12(secs[k]) : null;
    table[dayKeyOf(month, day)] = row;
  }
  const missing = [];
  for (let m = 1; m <= 12; m++) for (let d = 1; d <= DAYS_IN_MONTH[m - 1]; d++) if (!table[dayKeyOf(m, d)]) missing.push(`${d}/${m}`);
  if (missing.length) warnings.push(`أيام غير موجودة في الملف (${missing.length}): ${missing.slice(0, 10).join('، ')}${missing.length > 10 ? '…' : ''}`);
  return { table, warnings, skipped, count: Object.keys(table).length };
}

/** CSV بصيغة الحزمة: month,day,fajr,sunrise,dhuhr,asr,maghrib,isha (بنظام 12 ساعة AM/PM). */
function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const header = lines.shift().split(',').map((s) => s.trim().toLowerCase());
  const idx = (n) => header.indexOf(n);
  const raw = [];
  for (const line of lines) {
    const c = line.split(',').map((s) => s.trim());
    const month = Number(c[idx('month')]);
    const day = Number(c[idx('day')]);
    const secs = {};
    for (const k of PRAYER_KEYS) secs[k] = c[idx(k)] ? T.parse12(c[idx(k)]) : null;
    raw.push({ month, day, secs });
  }
  return finalizeTable(raw);
}

function parseCsvFile(file) { return parseCsv(fs.readFileSync(file, 'utf8')); }

const HEADER_MAP = {
  'التاريخ': 'day', 'اليوم': 'day', 'day': 'day',
  'الفجر': 'fajr', 'fajr': 'fajr', 'الشروق': 'sunrise', 'sunrise': 'sunrise',
  'الظهر': 'dhuhr', 'dhuhr': 'dhuhr', 'العصر': 'asr', 'asr': 'asr',
  'المغرب': 'maghrib', 'maghrib': 'maghrib', 'العشاء': 'isha', 'isha': 'isha',
};

/**
 * استيراد Excel: إما 12 ورقة (ورقة لكل شهر، الاسم يحتوي رقم الشهر) أو ورقة واحدة متتالية
 * يعود فيها رقم اليوم إلى 1 عند بداية كل شهر. صفوف الحشو (30 و31 فبراير...) تُتجاهل.
 */
async function parseExcelFile(file) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const sheets = wb.worksheets.filter((ws) => ws.rowCount > 1);
  const raw = [];
  const singleSheet = sheets.length === 1;

  sheets.forEach((ws, sheetIndex) => {
    // تحديد الأعمدة من صف العناوين
    const cols = {};
    ws.getRow(1).eachCell((cell, col) => {
      const key = HEADER_MAP[String(cell.value ?? '').trim().toLowerCase()];
      if (key) cols[key] = col;
    });
    if (!cols.day) cols.day = 1;
    PRAYER_KEYS.forEach((k, i) => { if (!cols[k]) cols[k] = i + 2; });

    let month;
    if (!singleSheet) {
      const n = /(\d{1,2})/.exec(ws.name);
      month = n ? Number(n[1]) : sheetIndex + 1;
    } else month = 0;
    let prevDay = 0;

    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const dv = row.getCell(cols.day).value;
      const day = Number(typeof dv === 'object' && dv ? dv.result : dv);
      if (!Number.isFinite(day) || day < 1 || day > 31) continue;
      if (singleSheet && day <= prevDay) month++;
      if (singleSheet && month === 0) month = 1;
      prevDay = day;
      const secs = {};
      for (const k of PRAYER_KEYS) {
        const hm = cellToHM(row.getCell(cols[k]).value);
        if (!hm) { secs[k] = null; continue; }
        secs[k] = hm.explicit ? hm.h * 3600 + hm.m * 60 : correctAmPm(k, hm.h, hm.m);
      }
      raw.push({ month, day, secs });
    }
  });
  return finalizeTable(raw);
}

/**
 * أوقات يوم محدد بالثواني بعد تطبيق التعديلات اليدوية والتقديم/التأخير.
 * إن لم يوجد اليوم (29 فبراير في جدول ناقص مثلاً) يُستخدم أقرب يوم سابق.
 */
function getDayTimes(db, date) {
  let d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  let row = null;
  let key = dayKeyFromDate(d);
  for (let i = 0; i < 3 && !row; i++) {
    key = dayKeyFromDate(d);
    row = db.prayerTimes[key];
    if (!row) d.setDate(d.getDate() - 1);
  }
  if (!row) return null;
  const overrides = db.prayerTimeOverrides[dayKeyFromDate(date)] || {};
  const out = { key: dayKeyFromDate(date), base: {}, secs: {}, overridden: {} };
  for (const k of PRAYER_KEYS) {
    const baseStr = overrides[k] || row[k];
    if (!baseStr) { out.secs[k] = null; continue; }
    out.overridden[k] = !!overrides[k];
    out.base[k] = T.parse12(baseStr);
    out.secs[k] = out.base[k] + (Number(db.prayerOffsets?.[k]) || 0) * 60;
  }
  return out;
}

module.exports = {
  parseCsv, parseCsvFile, parseExcelFile, getDayTimes, correctAmPm, cellToHM, validateDay,
  dayKeyOf, dayKeyFromDate, isRealDay, DAYS_IN_MONTH,
};
