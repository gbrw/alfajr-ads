/*
 * أدوات الوقت بنظام 12 ساعة (AM/PM) فقط.
 * يعمل في العملية الرئيسية (CommonJS) وفي الواجهة (window.Time12).
 * داخلياً يُمثَّل الوقت بعدد الثواني منذ منتصف الليل، ولا يُعرض أو يُحفظ أبداً بنظام 24 ساعة.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Time12 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY = 86400;
  const RE_12 = /^\s*(\d{1,2})\s*:\s*(\d{2})(?:\s*:\s*(\d{2}))?\s*([AaPp])\.?\s*[Mm]\.?\s*$/;

  const pad = (n) => String(n).padStart(2, '0');

  /** يحوّل "07:05 PM" أو "7:05:30 pm" إلى ثوانٍ منذ منتصف الليل. يرمي خطأً لأي صيغة أخرى. */
  function parse12(str) {
    const m = RE_12.exec(String(str ?? ''));
    if (!m) throw new Error(`صيغة الوقت غير صحيحة: "${str}" (المطلوب مثل 07:30 PM)`);
    let h = Number(m[1]);
    const min = Number(m[2]);
    const sec = m[3] ? Number(m[3]) : 0;
    if (h < 1 || h > 12 || min > 59 || sec > 59) throw new Error(`وقت غير صالح: "${str}"`);
    const pm = m[4].toUpperCase() === 'P';
    if (h === 12) h = 0;
    if (pm) h += 12;
    return h * 3600 + min * 60 + sec;
  }

  function isValid12(str) {
    try { parse12(str); return true; } catch { return false; }
  }

  /** ثوانٍ منذ منتصف الليل ← "hh:mm AM" (أو مع الثواني). يقبل قيماً سالبة أو تتجاوز اليوم. */
  function format12(seconds, withSeconds = false) {
    let s = Math.floor(((seconds % DAY) + DAY) % DAY);
    const h24 = Math.floor(s / 3600);
    const min = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const suffix = h24 >= 12 ? 'PM' : 'AM';
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${pad(h12)}:${pad(min)}${withSeconds ? ':' + pad(sec) : ''} ${suffix}`;
  }

  /** يطبّع أي إدخال 12 ساعة إلى الصيغة القياسية "hh:mm AM". */
  function normalize12(str) {
    return format12(parse12(str));
  }

  function secondsOfDay(date) {
    return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
  }

  /** Date ← "hh:mm:ss AM" */
  function formatDateTime12(date, withSeconds = true) {
    return format12(secondsOfDay(date), withSeconds);
  }

  /** مفتاح اليوم المحلي "YYYY-MM-DD" (تاريخ فقط، لا وقت). */
  function dateKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  /** طابع زمني كامل للسجلات: "2026-10-10 07:45:12 PM" */
  function stamp(date) {
    return `${dateKey(date)} ${formatDateTime12(date, true)}`;
  }

  /** مدة بالثواني ← "7:53" أو "1:02:05" */
  function formatDuration(totalSeconds) {
    const t = Math.max(0, Math.round(totalSeconds || 0));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  /** عدّاد تنازلي "02:15:09" */
  function formatCountdown(totalSeconds) {
    const t = Math.max(0, Math.floor(totalSeconds));
    return `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;
  }

  /**
   * هل الوقت داخل النافذة [start, end)؟ تدعم النهاية بعد منتصف الليل.
   * start === end تعني اليوم كاملاً.
   */
  function inWindow(sec, startSec, endSec) {
    const s = ((sec % DAY) + DAY) % DAY;
    if (startSec === endSec) return true;
    if (startSec < endSec) return s >= startSec && s < endSec;
    return s >= startSec || s < endSec;
  }

  return {
    DAY, parse12, isValid12, format12, normalize12, secondsOfDay,
    formatDateTime12, dateKey, stamp, formatDuration, formatCountdown, inWindow, pad,
  };
});
