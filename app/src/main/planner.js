'use strict';
/*
 * المخطِّط (منطق صافٍ قابل للاختبار): يبني قائمة أحداث يوم معيّن من قاعدة البيانات.
 * الأولويات (الأصغر أعلى): الإعلان الطارئ 0، الإعلان الاعتيادي 1، الأذان 2، التنبيه قبل الأذان 3، الأذكار 4.
 * صوت المتصفح (الخلفية) أدنى من الجميع ويُوقف مؤقتاً أثناء أي منها.
 */
const T = require('../shared/time12');
const { getDayTimes } = require('./prayers');
const { PRAYER_NAMES } = require('./db');

const PRIORITY = { emergencyAd: 0, ad: 1, adhan: 2, preadhan: 3, azkar: 4 };
/** نوع الحدث ← فئة نافذة ساعات العمل والصوت */
const WINDOW_CLASS = { adhan: 'adhan', preadhan: 'adhan', ad: 'ads', azkar: 'azkar' };
const VOLUME_CLASS = { adhan: 'adhan', preadhan: 'preadhan', ad: 'ads', azkar: 'azkar' };

function atDate(date, sec) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return new Date(d.getTime() + sec * 1000); // ثوانٍ قد تكون سالبة أو تتجاوز اليوم
}

/** وقت الذكر المحسوب لهذا اليوم بالثواني (نسبياً لمرساة من المواقيت). */
function azkarSeconds(z, times) {
  const anchor = times?.secs?.[z.schedule?.anchor];
  if (anchor == null) return null;
  const off = (Number(z.schedule.offsetMinutes) || 0) * 60;
  return anchor + (z.schedule.direction === 'before' ? -off : off);
}

function adRunsOn(ad, date) {
  const key = T.dateKey(date);
  if (ad.startDate && key < ad.startDate) return false;
  if (ad.endDate && key > ad.endDate) return false;
  const wd = Array.isArray(ad.weekdays) ? ad.weekdays : [0, 1, 2, 3, 4, 5, 6];
  return wd.includes(date.getDay());
}

/**
 * @returns {Array<{id,type,priority,at:Date,sec,label,audio,refId,repeatCount,repeatIntervalSeconds,windowClass,volumeClass}>}
 */
function planDay(db, date) {
  const dk = T.dateKey(date);
  const times = getDayTimes(db, date);
  const events = [];
  const push = (e) => events.push({ windowClass: WINDOW_CLASS[e.type], volumeClass: VOLUME_CLASS[e.type], repeatCount: 1, repeatIntervalSeconds: 0, ...e, at: atDate(date, e.sec) });

  if (times) {
    for (const p of db.prayers || []) {
      const sec = times.secs[p.key];
      if (sec == null || !p.enabled) continue;
      push({ id: `${dk}|adhan|${p.key}`, type: 'adhan', priority: PRIORITY.adhan, sec, label: `أذان ${p.name || PRAYER_NAMES[p.key]}`, audio: p.audio, refId: p.key });
      if (p.preAdhan?.enabled && Number(p.preAdhan.minutesBefore) > 0) {
        push({ id: `${dk}|preadhan|${p.key}`, type: 'preadhan', priority: PRIORITY.preadhan, sec: sec - p.preAdhan.minutesBefore * 60,
          label: `تنبيه قبل أذان ${p.name || PRAYER_NAMES[p.key]} (${p.preAdhan.minutesBefore} دقائق)`, audio: p.preAdhan.audio, refId: p.key });
      }
    }
    for (const z of db.azkar || []) {
      if (!z.enabled) continue;
      const sec = azkarSeconds(z, times);
      if (sec == null) continue;
      push({ id: `${dk}|azkar|${z.id}`, type: 'azkar', priority: PRIORITY.azkar, sec, label: z.name, audio: z.audio, refId: z.id });
    }
  }
  for (const ad of db.ads || []) {
    if (!ad.enabled || !ad.playTime || !adRunsOn(ad, date)) continue;
    let sec;
    try { sec = T.parse12(ad.playTime); } catch { continue; }
    push({
      id: `${dk}|ad|${ad.id}`, type: 'ad', priority: ad.priority === 'emergency' ? PRIORITY.emergencyAd : PRIORITY.ad, sec,
      label: `إعلان: ${ad.name}`, audio: ad.audio, refId: ad.id,
      repeatCount: Math.max(1, Number(ad.repeatCount) || 1), repeatIntervalSeconds: Math.max(0, Number(ad.repeatIntervalSeconds) || 0),
    });
  }
  events.sort((a, b) => a.at - b.at || a.priority - b.priority);
  return events;
}

/** هل يُسمح بالتشغيل الآن حسب نافذة ساعات العمل؟ */
function windowAllows(settings, windowClass, date) {
  const w = settings.timeWindow;
  if (!w?.enabled) return true;
  if (w.applyTo && w.applyTo[windowClass] === false) return true;
  return T.inWindow(T.secondsOfDay(date), T.parse12(w.start), T.parse12(w.end));
}

/**
 * تعارض حدثين متداخلين زمنياً: الأدنى أولوية يُؤجَّل أو يُوقف ويُستأنف بعد الأعلى.
 * durations: { [audioRel]: seconds }
 */
function findConflicts(events, durations) {
  const out = [];
  const dur = (e) => durations?.[e.audio] || 0;
  for (const e of events) {
    const start = e.at.getTime();
    const end = Math.max(start + dur(e) * 1000, start + 1000);
    for (const h of events) {
      if (h === e || h.priority >= e.priority) continue;
      const hs = h.at.getTime();
      const he = Math.max(hs + dur(h) * 1000, hs + 1000);
      if (start < he && hs < end) {
        out.push({ eventId: e.id, withId: h.id, text: `${e.label} (${T.format12(e.sec)}) يتداخل مع ${h.label} (${T.format12(h.sec)}) — سيُؤجَّل/يُستأنف حسب الأولوية` });
      }
    }
  }
  return out;
}

/**
 * مشاكل التنبيه قبل الأذان لكل صلاة مفعّلة: ملف غير محدد أو مفقود.
 * exists(rel) => boolean
 */
function preAdhanIssues(db, exists) {
  const out = [];
  for (const p of db.prayers || []) {
    if (!p.enabled || !p.preAdhan?.enabled) continue;
    const name = p.name || PRAYER_NAMES[p.key];
    if (!p.preAdhan.audio) out.push({ key: p.key, problem: 'no-file', text: `التنبيه قبل أذان ${name} مفعّل لكن لم يُحدَّد له ملف صوتي — لن يعمل` });
    else if (!exists(p.preAdhan.audio)) out.push({ key: p.key, problem: 'missing', text: `ملف التنبيه قبل أذان ${name} مفقود (${p.preAdhan.audio}) — لن يعمل` });
  }
  return out;
}

module.exports = { planDay, windowAllows, azkarSeconds, adRunsOn, findConflicts, preAdhanIssues, PRIORITY, VOLUME_CLASS, atDate };
