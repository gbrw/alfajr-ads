'use strict';
/*
 * مستويات الصوت (منطق صافٍ قابل للاختبار).
 * لكل نوع مستوى مستقل وكتم مستقل، والمستوى العام يضرب في الجميع وكتمه يكتم الجميع.
 * الصوت الفعلي = المستوى العام × مستوى النوع، أو صفر إن كان النوع أو المستوى العام مكتوماً.
 */
const CLASSES = ['ads', 'adhan', 'preadhan', 'azkar', 'background'];
const KEYS = ['master', ...CLASSES];
const NAMES = {
  master: 'المستوى العام', ads: 'الإعلانات', adhan: 'الأذان', preadhan: 'التنبيه قبل الأذان', azkar: 'الأذكار', background: 'صوت المتصفح (الخلفية)',
};

const clamp = (v) => Math.max(0, Math.min(1, Number(v) || 0));

function isMuted(settings, cls) {
  const m = settings.mute || {};
  return !!(m.master || m[cls]);
}

function effective(settings, cls) {
  if (isMuted(settings, cls)) return 0;
  const v = settings.volume || {};
  return clamp((v.master ?? 1) * (v[cls] ?? 1));
}

module.exports = { CLASSES, KEYS, NAMES, clamp, isMuted, effective };
