'use strict';
/*
 * يبني محرك الحجب المدمج (قوائم EasyList + EasyPrivacy + فلاتر uBlock) مسبقاً ويحفظه في
 * resources/adblock/engine.bin ليعمل الحجب من أول تشغيل حتى بدون إنترنت.
 * الاستخدام: node scripts/build-adblock-engine.js
 */
const fs = require('fs');
const path = require('path');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');

(async () => {
  const blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
  const out = path.join(__dirname, '..', 'resources', 'adblock');
  fs.mkdirSync(out, { recursive: true });
  const buf = blocker.serialize();
  fs.writeFileSync(path.join(out, 'engine.bin'), buf);
  fs.writeFileSync(path.join(out, 'engine.json'), JSON.stringify({
    builtAt: new Date().toISOString(),
    lib: require('@ghostery/adblocker-electron/package.json').version,
    bytes: buf.length,
  }, null, 2));
  console.log(`✓ engine.bin (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
})().catch((e) => { console.error(e); process.exit(1); });
