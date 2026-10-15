'use strict';
const fs = require('fs');
module.exports = async (ctx) => {
  const log = (...a) => console.log('[peek]', ...a);
  log('start');
  const wc = ctx.browser.view.webContents;
  wc.setAudioMuted(true);
  wc.on('console-message', (e) => { if (e.level === 'error') log('console', String(e.message).slice(0, 220)); });
  if (process.env.PEEK_NOCOSMETIC) { const b = ctx.adblock.blocker; try { b.disableBlockingInSession(ctx.browser.session); } catch {} ctx.adblock.enabledIn.clear(); b.config.loadCosmeticFilters = false; }
  ctx.adblock.blocker.on('request-blocked', (r) => log('BLOCKED', r.type, r.url.slice(0, 150)));
  ctx.adblock.blocker.on('csp-injected', (r) => log('CSP', r.url.slice(0, 100)));
  if (process.env.PEEK_NOOP) { const ses = ctx.browser.session; if (process.env.PEEK_NOOP.includes('req')) ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (d, cb) => cb({})); if (process.env.PEEK_NOOP.includes('hdr')) ses.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (d, cb) => cb({})); }
  if (process.env.PEEK_MODE) { ctx.db.update((d) => { d.settings.adblock.mode = process.env.PEEK_MODE; }); ctx.adblock.apply(ctx.browser.session); }
  ctx.mainWindow.setBounds({ x: -4000, y: 0, width: 1400, height: 900 });
  ctx.mainWindow.showInactive();
  log('shown');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(3000);
  await ctx.mainWindow.webContents.executeJavaScript("App.go('browser')").catch((e) => log('go err', e.message));
  log('browser screen');
  await Promise.race([wc.loadURL(process.env.PEEK_URL).catch(() => {}), wait(15000)]);
  log('loaded', wc.getURL());
  await wait(8000);
  const n = await Promise.race([wc.executeJavaScript('document.querySelectorAll("a[href*=\\"/watch?v=\\"]").length'), wait(5000).then(() => 'timeout')]);
  log('links', n, 'visibility', await wc.executeJavaScript('document.visibilityState').catch(() => '?'));
  log('title', await wc.executeJavaScript('document.title'));
  log('text', (await wc.executeJavaScript('document.body.innerText')).slice(0, 600).replace(/s+/g, ' '));
  log('html', (await wc.executeJavaScript('document.documentElement.outerHTML.length')));
  ctx.app.exit(0);
};
