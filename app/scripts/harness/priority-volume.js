'use strict';
/*
 * اختبار تشغيلي داخل البرنامج الحقيقي (ALFAJR_TEST_SCRIPT):
 *  1) الإعلان يقاطع الأذكار والتنبيه والأذان وصوت المتصفح، ثم يُستأنف كل منها من موضعه بالترتيب.
 *  2) لوحة الأصوات في نافذة المتصفح: سحب المنزلق وزر الكتم ينعكسان فوراً على الصوت الجاري.
 *  3) حفظ المستويات والكتم واستعادتها بعد إعادة فتح البرنامج (المرحلة 2: ALFAJR_HARNESS_PHASE=2).
 * النتيجة: JSON في ALFAJR_HARNESS_OUT، ولقطات شاشة بجانبه.
 */
const fs = require('fs');
const path = require('path');
const { P } = require('../../src/main/paths');
const V = require('../../src/main/volume');
const { PRIORITY } = require('../../src/main/planner');

/** ملف WAV بنغمة ثابتة (لا يحتاج ملفات صوتية جاهزة). */
function writeTone(file, seconds, freq) {
  const rate = 8000;
  const n = rate * seconds;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 8000), 44 + i * 2);
  fs.writeFileSync(file, buf);
}

module.exports = async (ctx) => {
  const { playback, audio, browser, db, mainWindow, app } = ctx;
  const out = process.env.ALFAJR_HARNESS_OUT || path.join(P.data, 'harness-result.json');
  const shotDir = path.dirname(out);
  const phase = process.env.ALFAJR_HARNESS_PHASE || '1';
  const R = { phase, checks: [], timeline: [] };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const check = (name, ok, detail) => { R.checks.push({ name, ok: !!ok, detail }); };
  const ui = (js) => mainWindow.webContents.executeJavaScript(js);
  const shot = async (name) => { const img = await mainWindow.webContents.capturePage(); fs.writeFileSync(path.join(shotDir, name), img.toPNG()); };
  const status = async () => (await audio.call('status', {})).priority || {};
  const bgMedia = () => browser.view.webContents.executeJavaScript('(() => { const a = document.querySelector("audio"); return a ? { paused: a.paused, t: a.currentTime } : null; })()');
  const finishCurrent = async () => { await playback.skipCurrent(); };
  const waitPlaying = async (type, ms = 15000) => {
    const t0 = Date.now();
    while (!(playback.phase === 'playing' && playback.current?.job.type === type)) { if (Date.now() - t0 > ms) return false; await wait(50); }
    return true;
  };

  try {
    // صفحة خلفية محلية تشغّل صوتاً متكرراً داخل المتصفح المدمج
    const lib = path.join(P.data, 'library', 'test');
    fs.mkdirSync(lib, { recursive: true });
    for (const [n, f, s] of [['ad', 880, 20], ['adhan', 440, 30], ['preadhan', 660, 30], ['azkar', 330, 30], ['bg', 220, 60]]) writeTone(path.join(lib, n + '.wav'), s, f);
    fs.writeFileSync(path.join(lib, 'bg.html'), '<!doctype html><title>bg</title><audio src="bg.wav" loop autoplay></audio>');

    if (phase === '2') {
      // انتظار اكتمال إقلاع الواجهة قبل التنقل
      for (let i = 0; i < 50 && !(await ui('!!(App.state && App.current)')); i++) await wait(200);
      await ui("App.go('browser')"); await wait(1500);
      const panel = await ui(`[...document.querySelectorAll('.vp-row')].map((r) => ({ v: r.querySelector('input').value, muted: r.classList.contains('is-muted') }))`);
      const s = db.get().settings;
      check('بعد إعادة الفتح: مستوى الأذان المحفوظ 35%', Math.round(s.volume.adhan * 100) === 35, s.volume.adhan);
      check('بعد إعادة الفتح: كتم الأذكار محفوظ', s.mute.azkar === true, s.mute);
      check('بعد إعادة الفتح: اللوحة تعرض المستويات المحفوظة', panel[2]?.v === '35' && panel[4]?.muted === true, panel);
      await shot('phase2-browser-panel.png');
      return;
    }

    db.update((d) => {
      d.settings.timeWindow.enabled = false;
      Object.assign(d.settings.ducking, { mode: 'pause', fadeOutSeconds: 0.5, fadeInSeconds: 0.5, silenceBeforePrioritySeconds: 0.5, silenceAfterSeconds: 0.5 });
      Object.assign(d.settings.volume, { master: 1, ads: 0.8, adhan: 0.9, preadhan: 0.7, azkar: 0.6, background: 0.5 });
      for (const k of Object.keys(d.settings.mute)) d.settings.mute[k] = false;
    }, { immediate: true });
    await playback.applyVolumes();

    await ui("App.go('browser')");
    const bgUrl = 'file://' + path.join(lib, 'bg.html').replace(/\\/g, '/');
    // التحميل الأول (يوتيوب) قد يُلغي هذا التحميل: نعيد المحاولة
    for (let i = 0; i < 5; i++) {
      await wait(1000);
      await browser.view.webContents.loadURL(bgUrl).catch(() => {});
      if (browser.view.webContents.getURL().endsWith('bg.html')) break;
    }
    await browser.resumeMedia();
    await wait(2500);
    const bg0 = await bgMedia();
    check('صوت المتصفح يعمل في البداية', bg0 && !bg0.paused, bg0);

    const job = (type, prio) => ({
      id: `test|${type}|${Date.now()}`, type, priority: prio, label: 'اختبار ' + type, audio: `library/test/${type}.wav`, refId: type === 'preadhan' ? 'asr' : type === 'adhan' ? 'dhuhr' : type, // تنبيه صلاة أخرى غير الأذان الجاري
      repeatCount: 1, repeatIntervalSeconds: 0, windowClass: type === 'ad' ? 'ads' : type === 'azkar' ? 'azkar' : 'adhan',
      volumeClass: { ad: 'ads', adhan: 'adhan', preadhan: 'preadhan', azkar: 'azkar' }[type], sec: 0,
    });

    // 1) الأذكار ← التنبيه ← الأذان ← الإعلان: كل واحد يقاطع ما قبله
    for (const [type, prio] of [['azkar', PRIORITY.azkar], ['preadhan', PRIORITY.preadhan], ['adhan', PRIORITY.adhan], ['ad', PRIORITY.ad]]) {
      playback.enqueue(job(type, prio), { manual: true });
      const ok = await waitPlaying(type);
      await wait(2000);
      const st = await status();
      const bg = await bgMedia();
      R.timeline.push({ type, pos: +(st.position || 0).toFixed(1), vol: +(st.volume || 0).toFixed(2), bgPaused: bg?.paused });
      check(`${type}: يعمل ويقاطع ما قبله`, ok && st.playing, st);
      check(`${type}: مستواه المستقل ${V.effective(db.get().settings, job(type, prio).volumeClass)}`, Math.abs(st.volume - V.effective(db.get().settings, job(type, prio).volumeClass)) < 0.01, st.volume);
      check(`${type}: صوت المتصفح متوقف مؤقتاً`, bg?.paused === true, bg);
    }
    await shot('browser-panel-ad-playing.png');

    // 2) لوحة الأصوات أثناء تشغيل الإعلان: سحب منزلق الإعلانات ← تأثير فوري
    await ui(`(() => { const r = document.querySelectorAll('.vp-row')[1].querySelector('input'); r.value = 30; r.dispatchEvent(new Event('input')); })()`);
    await wait(300);
    let st = await status();
    check('منزلق الإعلانات: تأثير فوري على الإعلان الجاري (30%)', Math.abs(st.volume - 0.3) < 0.01, st.volume);
    await ui(`(() => { const r = document.querySelectorAll('.vp-row')[0].querySelector('input'); r.value = 50; r.dispatchEvent(new Event('input')); })()`);
    await wait(300);
    st = await status();
    check('المستوى العام 50%: يضرب في مستوى الإعلانات (15%)', Math.abs(st.volume - 0.15) < 0.01, st.volume);
    await ui(`document.querySelectorAll('.vp-row')[1].querySelector('.vp-mute').click()`);
    await wait(300);
    st = await status();
    check('كتم الإعلانات: صفر فوراً', st.volume === 0, st.volume);
    await ui(`document.querySelectorAll('.vp-row')[1].querySelector('.vp-mute').click()`);
    await wait(300);
    st = await status();
    check('إلغاء كتم الإعلانات: يعود فوراً', Math.abs(st.volume - 0.15) < 0.01, st.volume);
    check('تغيير المستوى لم يغيّر الأولوية', playback.current?.job.type === 'ad' && (await bgMedia())?.paused === true);
    await ui(`(() => { const r = document.querySelectorAll('.vp-row')[0].querySelector('input'); r.value = 100; r.dispatchEvent(new Event('input')); })()`);
    await wait(300);

    // 3) انتهاء كل صوت ← استئناف الأدنى من موضعه
    const resumeOrder = [];
    for (const expect of ['adhan', 'preadhan', 'azkar']) {
      await finishCurrent();
      const ok = await waitPlaying(expect);
      await wait(400);
      const s2 = await status();
      resumeOrder.push(expect);
      const before = R.timeline.find((x) => x.type === expect).pos;
      check(`استئناف ${expect} من موضعه (${before}ث تقريباً)`, ok && s2.position >= before - 1.5, s2.position);
      if (expect === 'adhan') {
        // منزلق الأذان أثناء تشغيله
        await ui(`(() => { const r = document.querySelectorAll('.vp-row')[2].querySelector('input'); r.value = 35; r.dispatchEvent(new Event('input')); })()`);
        await wait(300);
        const s3 = await status();
        check('منزلق الأذان: تأثير فوري (35%)', Math.abs(s3.volume - 0.35) < 0.01, s3.volume);
      }
    }
    await finishCurrent();
    await wait(3000);
    const bgEnd = await bgMedia();
    check('بعد انتهاء الكل: صوت المتصفح يُستأنف', bgEnd && !bgEnd.paused, bgEnd);

    // 4) منزلق المتصفح وكتمه
    await ui(`(() => { const r = document.querySelectorAll('.vp-row')[5].querySelector('input'); r.value = 20; r.dispatchEvent(new Event('input')); })()`);
    await wait(500);
    check('منزلق المتصفح: معامل صوت الصفحة 20%', Math.abs(browser.factor - 0.2) < 0.01, browser.factor);
    await ui(`document.querySelectorAll('.vp-row')[5].querySelector('.vp-mute').click()`);
    await wait(400);
    check('كتم المتصفح: صوت الصفحة مكتوم', browser.view.webContents.isAudioMuted() === true);
    await ui(`document.querySelectorAll('.vp-row')[5].querySelector('.vp-mute').click()`);
    await wait(400);
    check('إلغاء كتم المتصفح', browser.view.webContents.isAudioMuted() === false && Math.abs(browser.factor - 0.2) < 0.01);

    // للمرحلة 2: كتم الأذكار (مستوى الأذان 35% مضبوط أعلاه)
    await ui(`document.querySelectorAll('.vp-row')[4].querySelector('.vp-mute').click()`);
    await wait(600);
    await shot('browser-panel-final.png');
    await ui("App.go('prayers')"); await wait(1200); await shot('prayers.png');
  } catch (e) {
    check('خطأ غير متوقع', false, e.stack || e.message);
  } finally {
    R.pass = R.checks.filter((c) => c.ok).length;
    R.fail = R.checks.filter((c) => !c.ok).length;
    fs.writeFileSync(out, JSON.stringify(R, null, 2));
    app.quit();
  }
};
