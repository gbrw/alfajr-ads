'use strict';
/*
 * اختبار تجربة المستخدم على يوتيوب بالإعدادات الافتراضية: لكل فيديو 60 ثانية نقيس
 * تقدّم الفيديو الفعلي، ظهور رسالة "Experiencing interruptions"، والكتم أثناء الإعلان.
 */
module.exports = async (ctx) => {
  const { browser } = ctx;
  const wc = browser.view.webContents;
  ctx.mainWindow.setBounds({ x: -4000, y: 0, width: 1400, height: 900 });
  ctx.mainWindow.showInactive();
  await ctx.mainWindow.webContents.executeJavaScript("App.go('browser')").catch(() => {});
  await browser.fadeTo(0, 0); // لا صوت فعلي على جهاز المستخدم أثناء الاختبار
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(3000);
  const videos = (process.env.VIDEOS || 'P0uaLRO6V1U,2VLqZtded_0,VMGo5CMYm9U,ko70cExuzZM').split(',');
  const SECS = Number(process.env.SECS || 60);
  for (const v of videos) {
    await Promise.race([wc.loadURL('https://www.youtube.com/watch?v=' + v).catch(() => {}), wait(15000)]);
    let adSec = 0, adMuted = 0, interrupt = false, maxT = 0, unmutedContent = 0, contentSec = 0;
    for (let i = 0; i < SECS; i++) {
      await wait(1000);
      const s = await wc.executeJavaScript(`(() => { const p = document.querySelector('#movie_player'); const vd = document.querySelector('video');
        return { ad: !!(p && p.classList.contains('ad-showing')), t: vd ? vd.currentTime : 0, intr: /Experiencing interruptions|تواجه انقطاعات/i.test(document.body.innerText) }; })()`).catch(() => ({}));
      const muted = wc.isAudioMuted();
      if (s.intr) interrupt = true;
      if (s.ad) { adSec++; if (muted) adMuted++; } else { contentSec++; if (!muted) unmutedContent++; if (s.t > maxT) maxT = s.t; }
    }
    console.log(`[play] ${v} contentProgress=${maxT.toFixed(0)}s/${contentSec}s adSec=${adSec} adMuted=${adMuted} contentWithSound=${unmutedContent}/${contentSec} interruptions=${interrupt}`);
  }
  console.log('[play] stats', JSON.stringify(browser.adStats), 'blocked', ctx.adblock.stats.blocked);
  ctx.app.exit(0);
};
