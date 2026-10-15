'use strict';
// أداة اختبار: تلتقط صورة لكل شاشة وتحفظها في مجلد SHOTS_DIR ثم تغلق البرنامج.
const fs = require('fs');
const path = require('path');
module.exports = async (ctx) => {
  const out = process.env.SHOTS_DIR;
  fs.mkdirSync(out, { recursive: true });
  const w = ctx.mainWindow;
  w.setBounds({ x: -4000, y: 0, width: 1360, height: 860 });
  w.showInactive();
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(4000);
  const screens = (process.env.SHOTS || 'dashboard,prayers,ads,azkar,local,extensions,logs,settings,browser').split(',');
  for (const s of screens) {
    await w.webContents.executeJavaScript(`App.go(${JSON.stringify(s)})`);
    await wait(s === 'browser' ? 9000 : 2500);
    const img = await w.capturePage();
    fs.writeFileSync(path.join(out, s + '.png'), img.toPNG());
  }
  const errs = await w.webContents.executeJavaScript('window.__errs || []');
  fs.writeFileSync(path.join(out, 'renderer-errors.json'), JSON.stringify(errs, null, 2));
  ctx.app.exit(0);
};
