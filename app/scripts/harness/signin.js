'use strict';
/*
 * اختبار آليات تسجيل الدخول بدون إنترنت (ALFAJR_TEST_SCRIPT):
 *  المرحلة 1: كوكي جلسة يوتيوب ← "مسجّل الدخول" ثم الخروج من البرنامج (الكوكيز تُكتب للقرص).
 *             واكتشاف صفحة رفض Google (تُخدَّم محلياً لهذا الاختبار فقط عبر protocol.handle).
 *  المرحلة 2 (ALFAJR_HARNESS_PHASE=2): بعد إعادة الفتح الجلسة ما زالت محفوظة.
 * ملاحظة: هذا لا يختبر خوادم Google الحقيقية — تجربة الدخول الفعلي تتم يدوياً.
 */
const fs = require('fs');
const path = require('path');
const { P } = require('../../src/main/paths');

module.exports = async (ctx) => {
  const { browser, mainWindow, app } = ctx;
  const out = process.env.ALFAJR_HARNESS_OUT || path.join(P.data, 'harness-signin.json');
  const phase = process.env.ALFAJR_HARNESS_PHASE || '1';
  const R = { phase, checks: [] };
  const check = (name, ok, detail) => R.checks.push({ name, ok: !!ok, detail });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ui = (js) => mainWindow.webContents.executeJavaScript(js);
  const shot = async (name) => { const img = await mainWindow.webContents.capturePage(); fs.writeFileSync(path.join(path.dirname(out), name), img.toPNG()); };
  try {
    for (let i = 0; i < 50 && !(await ui('!!(App.state && App.current)')); i++) await wait(200);
    if (phase === '2') {
      await wait(1000);
      check('بعد إعادة الفتح: الجلسة محفوظة (مسجّل الدخول)', (await browser.refreshSignIn()) === true);
      await ui("App.go('browser')"); await wait(1200);
      const label = await ui("document.querySelector('.browser-bar').innerText");
      check('شريط المتصفح يعرض "مسجّل"', /مسجّل/.test(label) && !/غير مسجّل/.test(label), label);
      await browser.signOut();
      check('تسجيل الخروج يحذف الجلسة', (await browser.refreshSignIn()) === false);
      return;
    }

    check('في البداية: غير مسجّل', (await browser.refreshSignIn()) === false);
    await browser.session.cookies.set({ url: 'https://www.youtube.com/', domain: '.youtube.com', name: 'LOGIN_INFO', value: 'test', secure: true, expirationDate: Math.floor(Date.now() / 1000) + 3600 * 24 * 30 });
    await wait(2500); // مؤقت حفظ الكوكيز + فحص الحالة
    check('بعد ظهور كوكي الجلسة: مسجّل الدخول', browser.signedIn === true);

    // صفحة رفض Google (نسخة محلية للاختبار فقط)
    const ses = browser.session;
    ses.protocol.handle('https', (req) => {
      if (new URL(req.url).hostname === 'accounts.google.com') {
        return new Response('<!doctype html><title>Couldn\'t sign you in</title><body>This browser or app may not be secure.</body>', { headers: { 'content-type': 'text/html' } });
      }
      return new Response('offline', { status: 503 });
    });
    await browser.view.webContents.loadURL('https://accounts.google.com/v3/signin/rejected?test=1').catch(() => {});
    await wait(1500);
    check('اكتشاف رفض Google لتسجيل الدخول', browser.signinBlocked === true);
    await ui("App.go('browser')"); await wait(1200);
    const bar = await ui("(() => { const b = document.querySelector('.browser-signin'); return b && !b.hidden ? b.innerText : ''; })()");
    check('شريط تنبيه واضح في نافذة المتصفح', /رفضت Google/.test(bar), bar);
    await ui("document.querySelector('.browser-signin button').click()"); await wait(600);
    const modal = await ui("document.querySelector('.modal') ? document.querySelector('.modal').innerText : ''");
    check('نافذة البدائل المدعومة', /بدون تسجيل دخول/.test(modal) && /متصفح النظام/.test(modal), modal.slice(0, 120));
    await shot('signin-blocked-modal.png');
    ses.protocol.unhandle('https');
  } catch (e) {
    check('خطأ غير متوقع', false, e.stack || e.message);
  } finally {
    R.pass = R.checks.filter((c) => c.ok).length;
    R.fail = R.checks.filter((c) => !c.ok).length;
    fs.writeFileSync(out, JSON.stringify(R, null, 2));
    app.quit();
  }
};
