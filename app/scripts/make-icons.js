'use strict';
/*
 * يولّد أيقونة البرنامج (شمس فجر فوق الأفق مع موجات صوت) إلى build/icon.png و build/icon.ico و build/tray.png.
 * الاستخدام: npx electron scripts/make-icons.js
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'build');

const draw = (size) => `
(() => {
  const S = ${size};
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const r = S * 0.22;
  g.beginPath(); g.roundRect(0, 0, S, S, r); g.closePath();
  const bg = g.createLinearGradient(0, 0, 0, S); bg.addColorStop(0, '#1c2b3f'); bg.addColorStop(1, '#0c131c');
  g.fillStyle = bg; g.fill();
  g.save(); g.clip();
  const hz = S * 0.64;
  const glow = g.createRadialGradient(S/2, hz, 0, S/2, hz, S*0.55);
  glow.addColorStop(0, 'rgba(242,165,65,.55)'); glow.addColorStop(1, 'rgba(242,165,65,0)');
  g.fillStyle = glow; g.fillRect(0, 0, S, S);
  const sun = g.createLinearGradient(0, hz - S*0.26, 0, hz);
  sun.addColorStop(0, '#ffd08a'); sun.addColorStop(1, '#f08a2c');
  g.fillStyle = sun; g.beginPath(); g.arc(S/2, hz, S*0.24, Math.PI, 0); g.fill();
  g.strokeStyle = '#ffcf87'; g.lineCap = 'round';
  for (let i = 1; i <= 2; i++) {
    g.lineWidth = Math.max(1.5, S * 0.035); g.globalAlpha = i === 1 ? .9 : .55;
    g.beginPath(); g.arc(S/2, hz, S*(0.24 + i*0.1), Math.PI*1.18, Math.PI*1.82); g.stroke();
  }
  g.globalAlpha = 1;
  g.fillStyle = '#0c131c'; g.fillRect(0, hz, S, S - hz);
  g.fillStyle = '#f2a541'; g.fillRect(S*0.12, hz - Math.max(1, S*0.012), S*0.76, Math.max(2, S*0.024));
  g.restore();
  return c.toDataURL('image/png').split(',')[1];
})()`;

function ico(pngs) {
  // ICO بصور PNG مضمّنة (مدعوم منذ Windows Vista)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach(({ size, buf }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o); dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2); dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(buf.length, o + 8); dir.writeUInt32LE(offset, o + 12);
    offset += buf.length;
  });
  return Buffer.concat([header, dir, ...pngs.map((p) => p.buf)]);
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({ show: false });
  await win.loadURL('data:text/html,<html></html>');
  const render = async (s) => Buffer.from(await win.webContents.executeJavaScript(draw(s)), 'base64');
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const s of sizes) pngs.push({ size: s, buf: await render(s) });
  fs.writeFileSync(path.join(OUT, 'icon.ico'), ico(pngs));
  fs.writeFileSync(path.join(OUT, 'icon.png'), await render(512));
  fs.writeFileSync(path.join(OUT, 'tray.png'), await render(32));
  console.log('✓ build/icon.ico, icon.png, tray.png');
  app.quit();
});
