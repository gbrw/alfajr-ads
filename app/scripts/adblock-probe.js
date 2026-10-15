'use strict';
/*
 * اختبار فعلي لمانع الإعلانات داخل Electron (بدون واجهة).
 * الاستخدام: npx electron scripts/adblock-probe.js [ublock|ublock-lite|builtin|none]
 * يحمّل صفحة اختبار تطلب سكربتات إعلانية معروفة + طلباً سليماً للمقارنة، ويطبع ما حُجب.
 */
const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const mode = process.argv[2] || 'ublock';
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'alfajr-probe-')));

const PROBES = {
  ad_adsbygoogle: 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
  ad_doubleclick: 'https://securepubads.g.doubleclick.net/tag/js/gpt.js',
  ad_googletagservices: 'https://www.googletagservices.com/tag/js/gpt.js',
  ad_amazon: 'https://c.amazon-adsystem.com/aax2/apstag.js',
  ad_taboola: 'https://cdn.taboola.com/libtrc/loader.js',
  control_jquery: 'https://code.jquery.com/jquery-3.7.1.min.js',
};

const PAGE = `<!doctype html><meta charset=utf-8><body><script>
window.results = {};
const probes = ${JSON.stringify(PROBES)};
let pending = Object.keys(probes).length;
for (const [k, u] of Object.entries(probes)) {
  const s = document.createElement('script'); s.src = u;
  s.onload = () => { results[k] = 'loaded'; --pending; };
  s.onerror = () => { results[k] = 'blocked/failed'; --pending; };
  document.head.appendChild(s);
}
window.done = () => pending === 0;
</script>`;

app.whenReady().then(async () => {
  const ses = session.fromPartition('persist:probe');
  const exts = ses.extensions || ses;
  let info = 'none';
  try {
    if (mode === 'ublock' || mode === 'ublock-lite') {
      const dir = path.join(__dirname, '..', 'resources', 'extensions', mode === 'ublock' ? 'ublock-origin' : 'ublock-origin-lite');
      const ext = await exts.loadExtension(dir, { allowFileAccess: true });
      info = `${ext.name} ${ext.version} id=${ext.id}`;
      await new Promise((r) => setTimeout(r, Number(process.env.WAIT || 8000))); // مهلة لتحميل قوائم الفلترة
    } else if (mode === 'builtin') {
      const { ElectronBlocker } = require('@ghostery/adblocker-electron');
      const blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
      blocker.enableBlockingInSession(ses);
      info = 'ghostery engine';
    }
  } catch (e) {
    console.log('LOAD ERROR:', e.message);
  }
  console.log('MODE', mode, '→', info);

  const tmp = path.join(app.getPath('userData'), 'probe.html');
  fs.writeFileSync(tmp, PAGE);
  // نخدم الصفحة من مصدر http عبر data؟ نستخدم صفحة https حقيقية خالية ثم نحقن الاختبار لضمان سياق ويب طبيعي
  const win = new BrowserWindow({ show: false, webPreferences: { session: ses } });
  await win.loadURL('https://example.com/');
  await win.webContents.executeJavaScript(`document.open();document.write(${JSON.stringify(PAGE)});document.close();true`);
  for (let i = 0; i < 60; i++) {
    if (await win.webContents.executeJavaScript('window.done && window.done()')) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const results = await win.webContents.executeJavaScript('window.results');
  console.log(JSON.stringify(results, null, 2));
  app.quit();
});
