'use strict';
/*
 * اختبار تسلسل الخفض: خلفية في المتصفح المدمج + إعلان الإغلاق 11:40 PM بثلاث تكرارات.
 * يسجّل خطاً زمنياً (كل 200ms) للصوت الفعلي للخلفية ومرحلة التشغيل، ويحفظه في OUT_FILE.
 * يُستخدم مع ALFAJR_FAKE_NOW (مثلاً اليوم 11:39:45 PM).
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const T = require('../../src/shared/time12');

module.exports = async (ctx) => {
  const { browser, db, playback, audio, clock } = ctx;
  const interval = Number(process.env.AD_INTERVAL || 15);
  db.update((d) => { d.ads[0].repeatIntervalSeconds = interval; });
  const bgSrc = pathToFileURL(path.join(ctx.app.getPath('userData'), 'library', 'azkar', 'azkar_morning_alnafees.mp3')).href;
  const page = pathToFileURL(path.join(__dirname, 'bg-test.html')).href + '?src=' + encodeURIComponent(bgSrc);
  await browser.view.webContents.loadURL(page);
  await new Promise((r) => setTimeout(r, 1500));
  // المستوى قبل أي شيء = المستوى العام × الخلفية
  await ctx.background.applyLevel(0);

  const rows = [];
  const t0 = Date.now();
  const maxMs = Number(process.env.MAX_MS || 150000);
  const timer = setInterval(async () => {
    try {
      const st = await browser.view.webContents.executeJavaScript(
        `(() => { const a = document.getElementById('a'); const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'volume'); return { logical: a.volume, paused: a.paused, factor: window.__alfajrDuck ? window.__alfajrDuck.factor : null }; })()`);
      const as = await audio.call('status', {});
      if (process.env.TRACE && rows.length % 10 === 0) console.log('TRACE', T.formatDateTime12(clock.now(), true), playback.phase, JSON.stringify(st));
      rows.push({
        ms: Date.now() - t0, clock: T.formatDateTime12(clock.now(), true), phase: playback.phase,
        bgFactor: st.factor == null ? null : +st.factor.toFixed(3), bgPaused: st.paused,
        priority: as.priority ? { playing: as.priority.playing, pos: +as.priority.position.toFixed(1), vol: +as.priority.volume.toFixed(2) } : null,
        current: playback.current ? playback.current.job.label + ' #' + playback.current.job.repeatIndex : null,
      });
    } catch (e) { rows.push({ ms: Date.now() - t0, err: e.message }); }
  }, 200);

  const done = () => {
    clearInterval(timer);
    fs.writeFileSync(process.env.OUT_FILE, JSON.stringify(rows, null, 1));
    ctx.app.exit(0);
  };
  // ننتهي بعد اكتمال التكرارات وعودة الخلفية، أو بعد المهلة
  const check = setInterval(() => {
    const lastAd = ctx.logger.entries.filter((e) => e.message.includes('انتهى تشغيل') && e.message.includes('3 من 3'));
    if (lastAd.length && playback.phase === 'idle' && Date.now() - t0 > 5000) {
      clearInterval(check); setTimeout(done, 1500);
    }
    if (Date.now() - t0 > maxMs) { clearInterval(check); done(); }
  }, 500);
};
