'use strict';
// إعادة إنتاج مشكلة المشرف: المصدر "محلي" بلا تلاوات ← هل يعمل فيديو يوتيوب؟ ثم: نقرة داخل الصفحة تحوّل المصدر للمتصفح.
module.exports = async (ctx) => {
  const { browser, db, background } = ctx;
  const wc = browser.view.webContents;
  ctx.mainWindow.setBounds({ x: -4000, y: 0, width: 1400, height: 900 });
  ctx.mainWindow.showInactive();
  await ctx.mainWindow.webContents.executeJavaScript("App.go('browser')").catch(() => {});
  await browser.fadeTo(0, 0);
  db.update((d) => { d.settings.background.source = 'local'; });
  await background.refreshHold();
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await Promise.race([wc.loadURL('https://www.youtube.com/watch?v=VMGo5CMYm9U').catch(() => {}), wait(15000)]);
  const sample = async (label) => {
    const t0 = await wc.executeJavaScript('document.querySelector("video")?.currentTime || 0');
    await wait(8000);
    const t1 = await wc.executeJavaScript('document.querySelector("video")?.currentTime || 0');
    console.log(`[src] ${label}: source=${db.get().settings.background.source} effective=${background.effectiveSource} hold=${browser.hold} progressed=${(t1 - t0).toFixed(1)}s in 8s`);
  };
  await wait(5000);
  await sample('محلي فارغ');
  // محاكاة وجود تلاوات: المصدر المحلي يصبح فعّالاً ← المتصفح يُوقف
  db.get().localBackground.reciters.push({ id: 'r1', name: 'اختبار', tracks: [{ id: 't1', title: 'x', file: 'library/adhan/adhan_iraqi_azzawi.mp3' }] });
  await background.refreshHold();
  await wait(2000);
  await sample('محلي فيه تلاوات (يجب أن يتوقف المتصفح)');
  wc.sendInputEvent({ type: 'mouseDown', x: 300, y: 300, button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x: 300, y: 300, button: 'left', clickCount: 1 });
  await wait(1500);
  await wc.executeJavaScript('document.querySelector("video")?.play()').catch(() => {});
  await wait(1000);
  await sample('بعد نقرة داخل المتصفح');
  ctx.app.exit(0);
};
