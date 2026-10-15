'use strict';
/*
 * قياس فعلي لإعلانات يوتيوب داخل المتصفح المدمج (الصوت مكتوم أثناء القياس).
 * لكل وضع (off ثم builtin): يفتح N فيديو، ويراقب 35 ثانية:
 *   - هل ظهر إعلان فيديو (#movie_player.ad-showing / .ytp-ad-player-overlay)
 *   - عدد طلبات الإعلانات التي اكتملت فعلاً عبر الشبكة
 *   - عدد ما حجبه المحرك
 * النتيجة تُحفظ في OUT_FILE (JSON).
 */
const fs = require('fs');

const AD_URL = /doubleclick\.net|googlesyndication\.com|googleadservices\.com|\/pagead\/|\/api\/stats\/ads|get_midroll_info|\/ptracking|googletagservices|adservice\.google|imasdk\.googleapis\.com/;
const QUERIES = (process.env.YT_QUERIES || 'تلاوة قرآن كريم,music video official,اناشيد اسلامية,news live,cartoon kids').split(',');
const PER_QUERY = Number(process.env.YT_PER_QUERY || 2);
const WATCH_MS = Number(process.env.YT_WATCH_MS || 35000);

module.exports = async (ctx) => {
  const { browser, adblock, db } = ctx;
  const wc = browser.view.webContents;
  wc.setAudioMuted(true);
  // نافذة مرئية خارج الشاشة: يوتيوب لا يرسم المحتوى في صفحة مخفية، ولا نريد التداخل مع سطح مكتب المستخدم
  ctx.mainWindow.setBounds({ x: -4000, y: 0, width: 1400, height: 900 });
  ctx.mainWindow.showInactive();
  await ctx.mainWindow.webContents.executeJavaScript("App.go('browser')").catch(() => {});
  const ses = browser.session;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let completedAds = 0;
  ses.webRequest.onCompleted({ urls: ['<all_urls>'] }, (d) => { if (AD_URL.test(d.url)) completedAds++; });

  const load = (url) => Promise.race([wc.loadURL(url).catch(() => {}), wait(15000)]);
  await wait(4000);

  // جمع روابط الفيديو مرة واحدة
  const videos = [];
  for (const q of QUERIES) {
    await load('https://www.youtube.com/results?search_query=' + encodeURIComponent(q));
    await wait(5000);
    const links = await wc.executeJavaScript(`[...new Set([...document.querySelectorAll('a#video-title,a#thumbnail')].map(a=>a.href).filter(h=>/\\/watch\\?v=/.test(h)).map(h=>h.split('&')[0]))].slice(0, ${PER_QUERY})`).catch(() => []);
    videos.push(...links);
    console.log('[search]', q, links.length);
  }

  const results = { measuredAt: new Date().toISOString(), electron: process.versions.electron, videos: videos.length, modes: {} };
  for (const mode of (process.env.YT_MODES || 'off,builtin').split(',')) {
    db.update((d) => { d.settings.adblock.mode = mode; });
    adblock.apply(ses);
    await ses.clearCache();
    const per = [];
    for (const v of videos) {
      const blocked0 = adblock.stats.blocked;
      const ads0 = completedAds;
      await load(v);
      let adSeen = false;
      let adSeconds = 0;
      let playing = false;
      const t0 = Date.now();
      while (Date.now() - t0 < WATCH_MS) {
        await wait(1000);
        const s = await wc.executeJavaScript(`(() => { const p = document.querySelector('#movie_player'); const v = document.querySelector('video');
          return { ad: !!(p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting'))) || !!document.querySelector('.ytp-ad-player-overlay, .ytp-ad-preview-container, .ytp-ad-text'),
                   playing: !!(v && !v.paused && v.currentTime > 0) }; })()`).catch(() => ({}));
        if (s.ad) { adSeen = true; adSeconds++; }
        if (s.playing) playing = true;
      }
      per.push({ video: v, adSeen, adSeconds, playing, adRequestsCompleted: completedAds - ads0, blockedByEngine: adblock.stats.blocked - blocked0 });
      console.log(`[${mode}] ${v} ad=${adSeen} (${adSeconds}s) playing=${playing} adReqOK=${completedAds - ads0} blocked=${adblock.stats.blocked - blocked0}`);
    }
    results.modes[mode] = {
      videosWithAds: per.filter((x) => x.adSeen).length,
      videosPlayed: per.filter((x) => x.playing).length,
      totalAdSeconds: per.reduce((a, x) => a + x.adSeconds, 0),
      adRequestsCompleted: per.reduce((a, x) => a + x.adRequestsCompleted, 0),
      blockedByEngine: per.reduce((a, x) => a + x.blockedByEngine, 0),
      per,
    };
  }
  // صفحات عامة (إعلانات العرض في المواقع)
  fs.writeFileSync(process.env.OUT_FILE, JSON.stringify(results, null, 2));
  ctx.app.exit(0);
};
