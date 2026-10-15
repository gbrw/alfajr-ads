'use strict';
/*
 * اختبار كتم إعلانات يوتيوب: المانع المدمج مُطفأ عمداً حتى تظهر الإعلانات،
 * ونسجّل كل ثانية: هل يوجد إعلان؟ هل صوت المتصفح مكتوم؟
 */
module.exports = async (ctx) => {
  const { browser, adblock, db } = ctx;
  const wc = browser.view.webContents;
  ctx.mainWindow.setBounds({ x: -4000, y: 0, width: 1400, height: 900 });
  ctx.mainWindow.showInactive();
  await ctx.mainWindow.webContents.executeJavaScript("App.go('browser')").catch(() => {});
  db.update((d) => { d.settings.adblock.mode = 'off'; });
  adblock.apply(browser.session);
  // صوت النظام الحقيقي لا نريده أثناء الاختبار: نخفض معامل الصفحة إلى الصفر (الكتم نفسه هو ما نختبره)
  await browser.fadeTo(0, 0);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(3000);
  const videos = (process.env.VIDEOS || 'P0uaLRO6V1U,2VLqZtded_0').split(',');
  for (const v of videos) {
    await Promise.race([wc.loadURL('https://www.youtube.com/watch?v=' + v).catch(() => {}), wait(15000)]);
    let adSec = 0; let mutedDuringAd = 0; let mutedWithoutAd = 0; let afterAdOk = null;
    for (let i = 0; i < 45; i++) {
      await wait(1000);
      const ad = await wc.executeJavaScript(`!!document.querySelector('#movie_player.ad-showing')`).catch(() => false);
      const muted = wc.isAudioMuted();
      if (ad) { adSec++; if (muted) mutedDuringAd++; } else if (muted) mutedWithoutAd++;
      if (!ad && adSec > 0 && afterAdOk === null) { await wait(1200); afterAdOk = !wc.isAudioMuted(); }
    }
    console.log(`[admute] ${v} adSeconds=${adSec} mutedDuringAd=${mutedDuringAd} mutedWithoutAd=${mutedWithoutAd} soundBackAfterAd=${afterAdOk} stats=${JSON.stringify(browser.adStats)}`);
  }
  ctx.app.exit(0);
};
