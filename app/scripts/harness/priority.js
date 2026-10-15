'use strict';
/*
 * اختبار: (1) رفض التشغيل خارج ساعات العمل، (2) الأذان يقاطع الذكر ثم يُستأنف الذكر من موضعه،
 * (3) الإيقاف الطارئ ثم الاستئناف. يُشغَّل مع ALFAJR_FAKE_NOW = 06:59:40 AM.
 */
const T = require('../../src/shared/time12');
module.exports = async (ctx) => {
  const { playback, clock, logger, audio } = ctx;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const d = ctx.db.get();
  const ev = (type, prio, label, audioRel, extra = {}) => ({
    id: `test|${type}|${Date.now()}`, type, priority: prio, label, audio: audioRel, refId: 'x', repeatCount: 1, repeatIntervalSeconds: 0,
    windowClass: { adhan: 'adhan', ad: 'ads', azkar: 'azkar' }[type], volumeClass: { adhan: 'adhan', ad: 'ads', azkar: 'azkar' }[type],
    sec: T.secondsOfDay(clock.now()), playAt: clock.now().getTime(), ...extra,
  });
  const mark = (m) => logger.info('system', '── اختبار: ' + m);

  mark('1) إعلان مجدول قبل 07:00 AM (خارج ساعات العمل)');
  playback.enqueue(ev('ad', 3, 'إعلان: الاغلاق', d.ads[0].audio));
  await wait(9000);
  while (clock.now().getHours() < 7) await wait(500);
  await wait(1500);

  mark('2) ذكر الصباح ثم أذان يقاطعه');
  playback.enqueue(ev('azkar', 2, 'أذكار الصباح', d.azkar[0].audio));
  await wait(14000);
  playback.enqueue(ev('adhan', 0, 'أذان الظهر (اختبار)', d.prayers[1].audio));
  await wait(12000);
  const st = await audio.call('status', {});
  mark(`الأذان يعمل الآن: ${playback.current && playback.current.job.label} موضع ${st.priority.position.toFixed(1)}ث`);
  await playback.skipCurrent();
  await wait(9000);
  const st2 = await audio.call('status', {});
  mark(`بعد الأذان: ${playback.current && playback.current.job.label} موضع ${st2.priority.position.toFixed(1)}ث`);

  mark('3) إيقاف طارئ');
  await playback.emergencyStop();
  await wait(1000);
  const st3 = await audio.call('status', {});
  mark(`بعد الإيقاف: القناة تعمل؟ ${st3.priority.playing} | حالة الخلفية: ${JSON.stringify(ctx.background.state().emergency)}`);
  await playback.resumeFromEmergency();
  await wait(1500);
  ctx.app.exit(0);
};
