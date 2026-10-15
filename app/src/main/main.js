'use strict';
/*
 * Ads Alfajr Manager — العملية الرئيسية.
 * الترتيب: النواة وقاعدة البيانات والترحيل ← المجدول والصوت والخفض ← المتصفح والإضافات ← الواجهة.
 */
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, powerSaveBlocker, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const T = require('../shared/time12');
const { P, ensureDirs } = require('./paths');
const { Db, PRAYER_KEYS, PRAYER_NAMES } = require('./db');
const { logger } = require('./logger');
const migration = require('./migration');
const prayers = require('./prayers');
const planner = require('./planner');
const library = require('./library');
const backup = require('./backup');
const { AudioEngine } = require('./audio-engine');
const { EmbeddedBrowser } = require('./browser');
const { LocalPlayer } = require('./local-player');
const { BackgroundController } = require('./background');
const { Playback } = require('./playback');
const { Scheduler } = require('./scheduler');
const { AdBlock } = require('./adblock');
const { Extensions } = require('./extensions');
const { NetMonitor } = require('./netmon');
const { Security } = require('./security');

app.setAppUserModelId('com.alfajr.adsmanager');
// يعمل البرنامج طوال اليوم من شريط النظام: لا نسمح لـ Chromium بإبطاء الصفحات المخفية/المحجوبة
// (يوتيوب لا يرسم ولا ينتقل للمقطع التالي إن توقّف الرسم في نافذة مخفية).
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
if (process.env.ALFAJR_DATA_DIR) app.setPath('userData', path.resolve(process.env.ALFAJR_DATA_DIR));

// ───── نسخة واحدة فقط ─────
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// ───── الساعة (قابلة للإزاحة للاختبار فقط) ─────
const clock = {
  offset: 0,
  now() { return new Date(Date.now() + this.offset); },
};
if (process.env.ALFAJR_FAKE_NOW && !app.isPackaged) clock.offset = new Date(process.env.ALFAJR_FAKE_NOW).getTime() - Date.now();
logger.now = () => clock.now();

const ctx = { clock, logger };
let mainWindow = null;
let tray = null;
let quitting = false;
let sleepBlockerId = null;
let pendingImport = null;

function iconPath(name = 'icon.png') {
  const candidates = [path.join(P.resources, 'icons', name), path.join(__dirname, '..', '..', 'build', name)];
  return candidates.find((f) => fs.existsSync(f)) || null;
}

// ───── التهيئة ─────
function initCore() {
  ensureDirs();
  ctx.db = new Db().load();
  logger.init();
  const db = ctx.db;
  logger.info('system', `بدء تشغيل Ads Alfajr Manager ${app.getVersion()}`, { status: 'success' });
  if (db.recoveredFromBackup) logger.warn('system', 'كان ملف البيانات تالفاً — تمت الاستعادة من النسخة الاحتياطية التلقائية');

  // الترحيل عند أول تشغيل
  if (!db.get().meta.migratedAt && Object.keys(db.get().prayerTimes).length === 0) {
    const pkg = P.bundledMigration;
    if (migration.isMigrationPackage(pkg)) {
      try {
        const report = db.update((d) => migration.applyPackage(d, pkg), { immediate: true });
        logger.info('migration', `تم استيراد حزمة الترحيل: ${report.files} ملف صوتي، ${report.prayerDays} يوم مواقيت، ${db.get().ads.length} إعلان، ${db.get().azkar.length} ذكر`, { status: 'success' });
        for (const w of report.warnings) logger.warn('migration', w);
        for (const n of report.notes) logger.info('migration', n);
        ctx.firstRunReport = report;
      } catch (e) {
        logger.error('migration', 'فشل استيراد حزمة الترحيل: ' + e.message, { status: 'fail' });
      }
    } else {
      logger.warn('migration', 'حزمة الترحيل غير موجودة بجانب البرنامج — يمكن استيرادها يدوياً من الإعدادات');
    }
  }
  db.saveNow();
  ctx.security = new Security({ db, logger });
}

function applyStartupSetting() {
  const on = !!ctx.db.get().settings.startup.runOnWindowsStartup;
  if (!app.isPackaged) return; // في وضع التطوير لا نسجّل electron.exe في بدء التشغيل
  app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: ['--hidden'] });
}

function applySleepSetting() {
  const want = ctx.db.get().settings.reliability.preventSleep;
  if (want && sleepBlockerId === null) sleepBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  if (!want && sleepBlockerId !== null) { powerSaveBlocker.stop(sleepBlockerId); sleepBlockerId = null; }
}

function createMainWindow() {
  const icon = iconPath();
  mainWindow = new BrowserWindow({
    width: 1360, height: 860, minWidth: 1100, minHeight: 680,
    show: false,
    title: 'Ads Alfajr Manager — منظم الإذاعة الداخلية',
    icon: icon || undefined,
    backgroundColor: '#0f1720',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'app-preload.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  const hidden = process.argv.includes('--hidden');
  mainWindow.once('ready-to-show', () => { if (!hidden) mainWindow.show(); });
  mainWindow.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWindow.hide();
      if (!ctx.trayHintShown && tray) {
        ctx.trayHintShown = true;
      }
    }
  });
  if (!app.isPackaged && process.env.ALFAJR_LOG_STDOUT) {
    mainWindow.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 'warning') console.log('[renderer]', e.message); });
  }
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWindow.webContents.on('render-process-gone', (_e, d) => {
    logger.error('system', `توقفت واجهة البرنامج (${d.reason}) — إعادة التحميل`, { status: 'fail' });
    setTimeout(() => { try { mainWindow.reload(); } catch { /* ignore */ } }, 1000);
  });
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function buildTray() {
  const icon = iconPath('tray.png') || iconPath();
  tray = new Tray(icon ? nativeImage.createFromPath(icon).resize({ width: 16, height: 16 }) : nativeImage.createEmpty());
  tray.setToolTip('Ads Alfajr Manager — منظم الإذاعة الداخلية');
  const refresh = () => {
    const stopped = ctx.playback?.stopped;
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'إظهار', click: showWindow },
      stopped
        ? { label: 'استئناف التشغيل', click: () => ctx.playback.resumeFromEmergency() }
        : { label: 'إيقاف طارئ', click: () => ctx.playback.emergencyStop() },
      { type: 'separator' },
      { label: 'خروج', click: () => { quitting = true; app.quit(); } },
    ]));
  };
  refresh();
  ctx.refreshTray = refresh;
  tray.on('double-click', showWindow);
}

async function initEngines() {
  const { db } = ctx;
  ctx.audio = new AudioEngine();
  ctx.audio.start();
  ctx.audio.on('crashed', (d) => logger.error('system', `توقف محرك الصوت (${d.reason}) — تمت إعادة تشغيله`, { status: 'fail' }));

  ctx.browser = new EmbeddedBrowser({ db, logger });
  ctx.browser.create(mainWindow);
  ctx.browser.on('user-interaction', () => { if (ctx.preferBrowser && !ctx.playback?.stopped) ctx.preferBrowser().catch(() => {}); });
  ctx.local = new LocalPlayer({ db, logger, audio: ctx.audio });
  ctx.background = new BackgroundController({ db, logger, browser: ctx.browser, local: ctx.local });
  ctx.playback = new Playback({ db, logger, audio: ctx.audio, background: ctx.background, clock });
  ctx.scheduler = new Scheduler({ db, logger, playback: ctx.playback, background: ctx.background, clock });

  ctx.adblock = new AdBlock({ db, logger });
  ctx.extensions = new Extensions({ db, logger });
  ctx.net = new NetMonitor({ logger });

  // الإضافات تُحمَّل قبل أول صفحة (Electron لا يتذكرها بين مرات التشغيل)
  try { await ctx.extensions.loadAll(ctx.browser.session); } catch (e) { logger.error('adblock', 'تحميل الإضافات: ' + e.message); }
  try {
    await ctx.adblock.init();
    ctx.adblock.apply(ctx.browser.session);
    logger.info('adblock', `مانع الإعلانات المدمج: ${ctx.adblock.builtinWanted() ? 'مفعّل' : 'غير مفعّل'} (قوائم ${ctx.adblock.engineInfo?.file})`);
  } catch (e) {
    logger.error('adblock', 'تعذر تشغيل مانع الإعلانات المدمج: ' + e.message, { status: 'fail' });
  }

  await ctx.audio.ready;
  ctx.browser.loadInitial();
  ctx.scheduler.start();
  await ctx.background.autostart();

  ctx.net.on('change', async (online) => {
    await ctx.background.setOnline(online);
    if (online) {
      ctx.adblock.updateLists().catch(() => {});
      runSelfTests().catch(() => {});
    }
  });
  ctx.net.start();

  // تنبيهات للمشرف
  const alert = (a) => send('alert', a);
  ctx.playback.on('alert', alert);
  ctx.background.on('alert', alert);
  ctx.playback.on('state', () => ctx.refreshTray?.());

  // مدد الملفات الصوتية (للعرض وكشف التعارض)
  refreshDurations().catch(() => {});
}

let selfTestsDone = false;
async function runSelfTests() {
  if (selfTestsDone) return;
  selfTestsDone = true;
  const b = await ctx.adblock.runSelfTest('builtin');
  logger.log(b.ok ? 'info' : 'warn', 'adblock', `اختبار المانع المدمج: ${b.note}`, { status: b.ok ? 'success' : 'fail' });
  const ub = ctx.db.get().extensions.find((e) => e.id === 'ublock-origin');
  if (ub) {
    const r = await ctx.adblock.runSelfTest('ublock', { ublockDir: ctx.extensions.dirOf(ub) });
    logger.log(r.ok ? 'info' : 'warn', 'adblock', `اختبار uBlock Origin داخل البرنامج: ${r.note}${r.ok ? '' : ' — يُعتمد المانع المدمج'}`, { status: r.ok ? 'success' : 'fail' });
  }
  ctx.adblock.apply(ctx.browser.session);
}

async function refreshDurations() {
  const d = ctx.db.get();
  const files = new Set();
  for (const p of d.prayers) { if (p.audio) files.add(p.audio); if (p.preAdhan?.audio) files.add(p.preAdhan.audio); }
  for (const a of d.ads) if (a.audio) files.add(a.audio);
  for (const z of d.azkar) if (z.audio) files.add(z.audio);
  for (const r of d.localBackground.reciters) for (const t of r.tracks) if (t.file) files.add(t.file);
  const missing = [...files].filter((f) => d.audioMeta[f]?.duration == null);
  for (const f of missing) {
    try {
      const dur = await ctx.audio.probe(f);
      if (dur != null) ctx.db.update((dd) => { dd.audioMeta[f] = { duration: dur }; });
    } catch { /* ملف تالف أو مفقود — يُسجَّل عند التشغيل */ }
  }
}

// ───── إرسال للواجهة ─────
function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function prayersToday() {
  const now = clock.now();
  const t = prayers.getDayTimes(ctx.db.get(), now);
  if (!t) return [];
  return PRAYER_KEYS.map((k) => {
    const cfg = ctx.db.get().prayers.find((p) => p.key === k);
    return {
      key: k, name: PRAYER_NAMES[k], time: t.secs[k] != null ? T.format12(t.secs[k]) : '—',
      enabled: k === 'sunrise' ? null : !!cfg?.enabled, past: t.secs[k] != null && t.secs[k] <= T.secondsOfDay(now),
      overridden: !!t.overridden[k], offset: ctx.db.get().prayerOffsets[k] || 0,
    };
  });
}

function snapshot() {
  const now = clock.now();
  const d = ctx.db.get();
  return {
    now: now.getTime(),
    clock: T.formatDateTime12(now, true),
    date: T.dateKey(now),
    status: ctx.playback?.stopped ? 'stopped' : 'running',
    next: ctx.scheduler?.nextEvent() || null,
    prayers: prayersToday(),
    today: ctx.scheduler?.todayEvents() || [],
    playback: ctx.playback?.state() || null,
    background: ctx.background?.state() || null,
    browser: ctx.browser?.state() || null,
    local: ctx.local?.state() || null,
    online: ctx.net?.online ?? null,
    adblockActive: !!ctx.adblock?.state().builtinActive,
    extensionsActive: ctx.extensions ? ctx.extensions.list().filter((e) => e.status.loaded).map((e) => e.name) : [],
    timeWindow: d.settings.timeWindow,
    insideWindow: planner.windowAllows(d.settings, 'ads', now),
    security: ctx.security.status(),
  };
}

// ───── IPC ─────
function handle(channel, fn, { protectedOp = false } = {}) {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!mainWindow || e.sender !== mainWindow.webContents) throw new Error('مصدر غير مسموح');
    try {
      if (protectedOp) ctx.security.assert();
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err.message, code: err.code };
    }
  });
}

function dbView() {
  const d = ctx.db.get();
  const { security, ...settings } = d.settings;
  return {
    settings, prayers: d.prayers, prayerOffsets: d.prayerOffsets, prayerTimesSource: d.prayerTimesSource,
    ads: d.ads, azkar: d.azkar, localBackground: d.localBackground, audioMeta: d.audioMeta,
    extensions: ctx.extensions.list(), meta: d.meta,
    fileExists: Object.fromEntries(collectFiles(d).map((f) => [f, library.exists(f)])),
  };
}

function collectFiles(d) {
  const s = new Set();
  d.prayers.forEach((p) => { if (p.audio) s.add(p.audio); if (p.preAdhan?.audio) s.add(p.preAdhan.audio); });
  d.ads.forEach((a) => a.audio && s.add(a.audio));
  d.azkar.forEach((z) => z.audio && s.add(z.audio));
  d.localBackground.reciters.forEach((r) => r.tracks.forEach((t) => s.add(t.file)));
  return [...s];
}

function validateTime(v, label) {
  if (!T.isValid12(v)) throw new Error(`${label}: صيغة الوقت غير صحيحة — استخدم نظام 12 ساعة مثل 07:30 PM`);
  return T.normalize12(v);
}

function registerIpc() {
  const { db } = ctx;

  handle('state:get', async () => { await ctx.enginesReady; return snapshot(); });
  handle('db:get', async () => { await ctx.enginesReady; return dbView(); });

  // ── التحكم ──
  handle('control:emergency', () => ctx.playback.emergencyStop());
  handle('control:resume', () => ctx.playback.resumeFromEmergency());
  handle('control:mute', (m) => ctx.playback.setMuted(m));
  handle('control:skip', () => ctx.playback.skipCurrent());

  // ── الملفات ──
  handle('files:pick', async (category, multi = false) => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'اختيار ملف صوتي', properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [{ name: 'ملفات صوتية', extensions: library.AUDIO_EXT.map((x) => x.slice(1)) }],
    });
    if (r.canceled) return [];
    const out = [];
    for (const f of r.filePaths) {
      const rel = library.importFile(f, category);
      let duration = null;
      try { duration = await ctx.audio.probe(rel); } catch { /* ignore */ }
      if (duration != null) db.update((d) => { d.audioMeta[rel] = { duration }; });
      out.push({ rel, name: path.basename(f, path.extname(f)), duration });
    }
    return out;
  });
  handle('files:url', (rel) => AudioEngine.urlFor(rel));

  // ── الإعدادات ──
  handle('settings:save', (patch) => {
    const before = JSON.stringify(db.get().settings.startup) + db.get().settings.reliability.preventSleep;
    db.update((d) => {
      const s = d.settings;
      if (patch.volume) for (const k of Object.keys(s.volume)) if (patch.volume[k] != null) s.volume[k] = Math.max(0, Math.min(1, Number(patch.volume[k])));
      if (patch.ducking) {
        const dk = patch.ducking;
        for (const k of ['fadeOutSeconds', 'fadeInSeconds', 'silenceBeforePrioritySeconds', 'silenceAfterSeconds']) if (dk[k] != null) s.ducking[k] = Math.max(0, Math.min(30, Number(dk[k])));
        if (dk.duckedLevel != null) s.ducking.duckedLevel = Math.max(0, Math.min(1, Number(dk.duckedLevel)));
        if (dk.mode) s.ducking.mode = dk.mode === 'pause' ? 'pause' : 'duck';
        for (const k of ['resumeBackgroundBetweenAdRepeats', 'pauseBackgroundDuringAdhan']) if (dk[k] != null) s.ducking[k] = !!dk[k];
      }
      if (patch.timeWindow) {
        const w = patch.timeWindow;
        if (w.start != null) s.timeWindow.start = validateTime(w.start, 'بداية ساعات العمل');
        if (w.end != null) s.timeWindow.end = validateTime(w.end, 'نهاية ساعات العمل');
        if (w.enabled != null) s.timeWindow.enabled = !!w.enabled;
        if (w.applyTo) for (const k of Object.keys(s.timeWindow.applyTo)) if (w.applyTo[k] != null) s.timeWindow.applyTo[k] = !!w.applyTo[k];
      }
      if (patch.startup?.runOnWindowsStartup != null) s.startup.runOnWindowsStartup = !!patch.startup.runOnWindowsStartup;
      if (patch.reliability) {
        if (patch.reliability.missedEventGraceMinutes != null) s.reliability.missedEventGraceMinutes = Math.max(0, Math.min(60, Number(patch.reliability.missedEventGraceMinutes)));
        if (patch.reliability.preventSleep != null) s.reliability.preventSleep = !!patch.reliability.preventSleep;
      }
      if (patch.background) {
        if (patch.background.homeUrl) s.background.homeUrl = String(patch.background.homeUrl);
        if (patch.background.autoFallbackToLocal != null) s.background.autoFallbackToLocal = !!patch.background.autoFallbackToLocal;
      }
      if (patch.city) s.city = String(patch.city);
    }, { immediate: true });
    if (before !== JSON.stringify(db.get().settings.startup) + db.get().settings.reliability.preventSleep) { applyStartupSetting(); applySleepSetting(); }
    ctx.background.applyLevel(400).catch(() => {});
    logger.info('settings', 'تم حفظ الإعدادات بنجاح', { status: 'success' });
    return true;
  }, { protectedOp: true });

  handle('security:status', () => ctx.security.status());
  handle('security:unlock', (pw) => { if (!ctx.security.unlock(pw)) throw new Error('كلمة المرور غير صحيحة'); return true; });
  handle('security:lock', () => ctx.security.lock());
  handle('security:set', (current, next) => ctx.security.setPassword(current, next));

  // ── المواقيت ──
  handle('prayers:table', () => ({ table: db.get().prayerTimes, overrides: db.get().prayerTimeOverrides, offsets: db.get().prayerOffsets, source: db.get().prayerTimesSource }));
  handle('prayers:saveConfig', (list) => {
    db.update((d) => {
      for (const p of list) {
        const cur = d.prayers.find((x) => x.key === p.key);
        if (!cur) continue;
        cur.enabled = !!p.enabled;
        if (p.audio !== undefined) cur.audio = p.audio;
        cur.preAdhan.enabled = !!p.preAdhan.enabled;
        cur.preAdhan.minutesBefore = Math.max(1, Math.min(60, Number(p.preAdhan.minutesBefore) || 10));
        if (p.preAdhan.audio !== undefined) cur.preAdhan.audio = p.preAdhan.audio;
      }
    }, { immediate: true });
    logger.info('settings', 'تم حفظ إعدادات الأذان', { status: 'success' });
    return true;
  });
  handle('prayers:saveOffsets', (offsets) => {
    db.update((d) => { for (const k of PRAYER_KEYS) if (offsets[k] != null) d.prayerOffsets[k] = Math.max(-60, Math.min(60, Math.round(Number(offsets[k]) || 0))); }, { immediate: true });
    logger.info('prayers', 'تم حفظ التقديم/التأخير: ' + PRAYER_KEYS.map((k) => `${PRAYER_NAMES[k]} ${db.get().prayerOffsets[k] >= 0 ? '+' : ''}${db.get().prayerOffsets[k]}`).join('، '));
    return true;
  });
  handle('prayers:setOverride', (dayKey, key, value) => {
    if (!PRAYER_KEYS.includes(key)) throw new Error('صلاة غير معروفة');
    const v = value ? validateTime(value, PRAYER_NAMES[key]) : null;
    db.update((d) => {
      const o = d.prayerTimeOverrides[dayKey] ||= {};
      if (v) o[key] = v; else delete o[key];
      if (!Object.keys(o).length) delete d.prayerTimeOverrides[dayKey];
    }, { immediate: true });
    logger.info('prayers', v ? `تعديل يدوي: ${PRAYER_NAMES[key]} يوم ${dayKey.split('-').reverse().join('/')} = ${v}` : `إلغاء التعديل اليدوي لـ${PRAYER_NAMES[key]} يوم ${dayKey.split('-').reverse().join('/')}`);
    return true;
  });
  handle('prayers:importPreview', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'استيراد جدول المواقيت', properties: ['openFile'],
      filters: [{ name: 'Excel / CSV', extensions: ['xlsx', 'csv'] }],
    });
    if (r.canceled) return null;
    const f = r.filePaths[0];
    const res = f.toLowerCase().endsWith('.csv') ? prayers.parseCsvFile(f) : await prayers.parseExcelFile(f);
    pendingImport = { ...res, file: path.basename(f) };
    return { file: pendingImport.file, count: res.count, skipped: res.skipped, warnings: res.warnings, table: res.table };
  });
  handle('prayers:importCommit', () => {
    if (!pendingImport) throw new Error('لا يوجد استيراد بانتظار التأكيد');
    const imp = pendingImport;
    pendingImport = null;
    db.update((d) => {
      d.prayerTimes = imp.table;
      d.prayerTimesSource = { type: 'excel', file: imp.file, importedAt: new Date().toISOString(), days: imp.count };
    }, { immediate: true });
    logger.info('prayers', `تم استيراد جدول المواقيت من ${imp.file}: ${imp.count} يوم${imp.warnings.length ? `، ${imp.warnings.length} تحذير` : ''} (التعديلات اليدوية والتقديم/التأخير محفوظة)`, { status: 'success' });
    return true;
  });

  // ── الإعلانات ──
  handle('ads:save', (ad) => {
    if (!String(ad.name || '').trim()) throw new Error('اسم الإعلان مطلوب');
    const playTime = validateTime(ad.playTime, 'وقت التشغيل');
    const clean = {
      id: ad.id || require('crypto').randomUUID(),
      name: String(ad.name).trim(), audio: ad.audio || null, playTime,
      repeatCount: Math.max(1, Math.min(50, Math.round(Number(ad.repeatCount) || 1))),
      repeatIntervalSeconds: Math.max(0, Math.min(86400, Math.round(Number(ad.repeatIntervalSeconds) || 0))),
      enabled: !!ad.enabled, priority: ad.priority === 'emergency' ? 'emergency' : 'normal',
      startDate: ad.startDate || null, endDate: ad.endDate || null,
      weekdays: Array.isArray(ad.weekdays) ? ad.weekdays.map(Number).filter((x) => x >= 0 && x <= 6) : [0, 1, 2, 3, 4, 5, 6],
    };
    if (clean.startDate && clean.endDate && clean.endDate < clean.startDate) throw new Error('تاريخ النهاية قبل تاريخ البداية');
    if (!clean.audio) throw new Error('يجب اختيار ملف صوتي للإعلان');
    db.update((d) => {
      const i = d.ads.findIndex((x) => x.id === clean.id);
      if (i >= 0) d.ads[i] = clean; else d.ads.push(clean);
    }, { immediate: true });
    logger.info('ads', `تم حفظ الإعلان "${clean.name}" — ${clean.playTime}، ${clean.repeatCount} مرات بفاصل ${clean.repeatIntervalSeconds} ثانية`, { status: 'success' });
    return clean;
  });
  handle('ads:delete', (id) => {
    const ad = db.get().ads.find((a) => a.id === id);
    db.update((d) => { d.ads = d.ads.filter((a) => a.id !== id); }, { immediate: true });
    if (ad) logger.info('ads', `تم حذف الإعلان "${ad.name}"`);
    return true;
  });
  handle('ads:playNow', (id) => {
    const ad = db.get().ads.find((a) => a.id === id);
    if (!ad) throw new Error('الإعلان غير موجود');
    ctx.playback.enqueue({
      id: `manual|ad|${id}|${Date.now()}`, type: 'ad', priority: ad.priority === 'emergency' ? 1 : 3, label: `إعلان: ${ad.name}`,
      audio: ad.audio, refId: id, repeatCount: 1, repeatIntervalSeconds: 0, windowClass: 'ads', volumeClass: 'ads', sec: T.secondsOfDay(clock.now()),
    }, { manual: true });
    return true;
  });

  // ── الأذكار ──
  handle('azkar:save', (z) => {
    db.update((d) => {
      const cur = d.azkar.find((x) => x.id === z.id);
      const val = {
        id: z.id || require('crypto').randomUUID(), name: String(z.name || 'ذكر').trim(), audio: z.audio || null, enabled: !!z.enabled,
        schedule: {
          anchor: PRAYER_KEYS.includes(z.schedule?.anchor) ? z.schedule.anchor : 'sunrise',
          direction: z.schedule?.direction === 'before' ? 'before' : 'after',
          offsetMinutes: Math.max(0, Math.min(600, Math.round(Number(z.schedule?.offsetMinutes) || 0))),
        },
      };
      if (cur) Object.assign(cur, val); else d.azkar.push(val);
    }, { immediate: true });
    logger.info('azkar', `تم حفظ "${z.name}": ${z.schedule.direction === 'before' ? 'قبل' : 'بعد'} ${PRAYER_NAMES[z.schedule.anchor]} بـ ${z.schedule.offsetMinutes} دقيقة`, { status: 'success' });
    return true;
  });
  handle('azkar:delete', (id) => { db.update((d) => { d.azkar = d.azkar.filter((x) => x.id !== id); }, { immediate: true }); return true; });
  handle('azkar:playNow', (id) => {
    const z = db.get().azkar.find((a) => a.id === id);
    if (!z) throw new Error('الذكر غير موجود');
    ctx.playback.enqueue({ id: `manual|azkar|${id}|${Date.now()}`, type: 'azkar', priority: 2, label: z.name, audio: z.audio, refId: id,
      repeatCount: 1, repeatIntervalSeconds: 0, windowClass: 'azkar', volumeClass: 'azkar', sec: T.secondsOfDay(clock.now()) }, { manual: true });
    return true;
  });
  handle('azkar:preview', (days = 7) => {
    const out = [];
    const d0 = clock.now();
    const durations = Object.fromEntries(Object.entries(db.get().audioMeta).map(([k, v]) => [k, v.duration]));
    for (let i = 0; i < days; i++) {
      const d = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + i);
      const times = prayers.getDayTimes(db.get(), d);
      const evs = planner.planDay(db.get(), d);
      const conflicts = planner.findConflicts(evs, durations);
      out.push({
        date: T.dateKey(d),
        items: db.get().azkar.map((z) => {
          const sec = planner.azkarSeconds(z, times);
          return {
            id: z.id, anchorTime: times ? T.format12(times.secs[z.schedule.anchor]) : '—', time: sec != null ? T.format12(sec) : '—',
            outsideWindow: sec != null && !planner.windowAllows(db.get().settings, 'azkar', planner.atDate(d, sec)),
            conflicts: conflicts.filter((c) => c.eventId.endsWith('|' + z.id)).map((c) => c.text),
          };
        }),
      });
    }
    return out;
  });

  // ── الخلفية المحلية ──
  handle('local:addReciter', (name) => {
    const id = 'r-' + Date.now();
    db.update((d) => { d.localBackground.reciters.push({ id, name: String(name || 'قارئ جديد').trim(), tracks: [] }); }, { immediate: true });
    logger.info('background', `إضافة قارئ: ${name}`);
    return id;
  });
  handle('local:renameReciter', (id, name) => { db.update((d) => { const r = d.localBackground.reciters.find((x) => x.id === id); if (r) r.name = String(name).trim(); }, { immediate: true }); return true; });
  handle('local:deleteReciter', async (id) => {
    if (ctx.local.reciter()?.id === id) await ctx.local.stop();
    db.update((d) => {
      d.localBackground.reciters = d.localBackground.reciters.filter((x) => x.id !== id);
      if (d.localBackground.activeReciterId === id) d.localBackground.activeReciterId = null;
    }, { immediate: true });
    return true;
  });
  handle('local:addTracks', async (reciterId) => {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'إضافة تلاوات', properties: ['openFile', 'multiSelections'], filters: [{ name: 'ملفات صوتية', extensions: library.AUDIO_EXT.map((x) => x.slice(1)) }] });
    if (r.canceled) return 0;
    const tracks = r.filePaths.map((f) => ({ id: 't-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), title: path.basename(f, path.extname(f)), file: library.importFile(f, 'background') }));
    db.update((d) => { d.localBackground.reciters.find((x) => x.id === reciterId)?.tracks.push(...tracks); }, { immediate: true });
    logger.info('background', `إضافة ${tracks.length} تلاوة`);
    refreshDurations().catch(() => {});
    return tracks.length;
  });
  handle('local:removeTrack', (reciterId, trackId) => {
    db.update((d) => { const rr = d.localBackground.reciters.find((x) => x.id === reciterId); if (rr) rr.tracks = rr.tracks.filter((t) => t.id !== trackId); }, { immediate: true });
    return true;
  });
  handle('local:control', async (action, arg1, arg2) => {
    const L = ctx.local;
    if (action === 'play') {
      if (ctx.background.blocked) throw new Error(ctx.playback.stopped ? 'النظام في حالة إيقاف طارئ' : 'خارج ساعات العمل المسموحة للخلفية');
      if (ctx.background.effectiveSource !== 'local') await ctx.background.setSource('local');
      return L.play(arg1, arg2 || 0);
    }
    if (action === 'pause') return L.pause();
    if (action === 'resume') { if (ctx.background.blocked) throw new Error('غير مسموح بتشغيل الخلفية الآن'); return L.resume(); }
    if (action === 'stop') return L.stop();
    if (action === 'next') return L.next();
    if (action === 'prev') return L.prev();
    if (action === 'shuffle') { db.update((d) => { d.localBackground.shuffle = !!arg1; }); return true; }
    throw new Error('أمر غير معروف');
  });
  handle('background:setSource', (src) => ctx.background.setSource(src === 'local' ? 'local' : 'browser'));

  // ── المتصفح ──
  const preferBrowser = async () => {
    if (ctx.background.configuredSource === 'local' && !ctx.background.fallbackActive) {
      await ctx.background.setSource('browser');
      send('alert', { level: 'warn', message: 'تم تحويل مصدر الخلفية إلى المتصفح' });
    }
  };
  ctx.preferBrowser = preferBrowser;
  handle('browser:navigate', async (url) => { await preferBrowser(); return ctx.browser.navigate(url); });
  handle('browser:action', async (a) => { if (a !== 'stop') await preferBrowser(); return ctx.browser.action(a); });
  handle('browser:bounds', (rect) => ctx.browser.setBounds(rect));
  handle('browser:hide', () => ctx.browser.hide());

  // ── الإضافات ومانع الإعلانات ──
  handle('ext:list', () => ({ extensions: ctx.extensions.list(), adblock: ctx.adblock.state() }));
  handle('ext:setEnabled', (id, en) => ctx.extensions.setEnabled(ctx.browser.session, id, en), { protectedOp: true });
  handle('ext:addFolder', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'اختر مجلد إضافة غير مضغوطة (يحتوي manifest.json)', properties: ['openDirectory'] });
    if (r.canceled) return null;
    return ctx.extensions.addFromFolder(ctx.browser.session, r.filePaths[0]);
  }, { protectedOp: true });
  handle('ext:remove', (id) => ctx.extensions.remove(ctx.browser.session, id), { protectedOp: true });
  handle('adblock:setMode', (mode) => {
    if (!['auto', 'ublock', 'builtin', 'both', 'off'].includes(mode)) throw new Error('وضع غير معروف');
    db.update((d) => { d.settings.adblock.mode = mode; }, { immediate: true });
    ctx.adblock.apply(ctx.browser.session);
    logger.info('adblock', `وضع مانع الإعلانات: ${mode}`);
    return ctx.adblock.state();
  }, { protectedOp: true });
  handle('adblock:setYoutubeMode', async (m) => {
    db.update((d) => { d.settings.adblock.youtubeMode = m === 'block' ? 'block' : 'mute'; }, { immediate: true });
    logger.info('adblock', m === 'block' ? 'يوتيوب: حجب الإعلانات' : 'يوتيوب: بدون حجب — كتم صوت الإعلان حتى ينتهي');
    await ctx.browser.session.clearCache().catch(() => {});
    return ctx.adblock.state();
  }, { protectedOp: true });
  handle('adblock:selfTest', async () => { selfTestsDone = false; await runSelfTests(); return ctx.adblock.state(); });
  handle('adblock:updateLists', () => ctx.adblock.updateLists(true));
  handle('adblock:resetStats', () => { ctx.adblock.stats = { blocked: 0, redirected: 0, cosmetic: 0, since: Date.now(), byHost: {} }; return true; });

  // ── السجلات ──
  handle('logs:query', (q) => logger.query(q || {}));
  handle('logs:clear', () => { logger.clear(); logger.info('system', 'تم مسح السجل'); return true; });
  handle('logs:export', async (q) => {
    const now = clock.now();
    const name = `AlfajrLog_${T.dateKey(now)}_${T.formatDateTime12(now, true).replace(/:/g, '-').replace(' ', '')}.txt`;
    const r = await dialog.showSaveDialog(mainWindow, { title: 'تصدير السجل', defaultPath: path.join(app.getPath('documents'), name), filters: [{ name: 'ملف نصي', extensions: ['txt'] }] });
    if (r.canceled) return null;
    fs.writeFileSync(r.filePath, '﻿' + logger.toText(logger.query({ ...(q || {}), limit: 100000 })), 'utf8');
    logger.info('system', 'تم تصدير السجل إلى ' + path.basename(r.filePath), { status: 'success' });
    return r.filePath;
  });

  // ── النسخ الاحتياطي والترحيل ──
  handle('backup:create', async () => {
    const r = await dialog.showSaveDialog(mainWindow, { title: 'حفظ نسخة احتياطية', defaultPath: path.join(app.getPath('documents'), backup.defaultName(clock.now())), filters: [{ name: 'نسخة احتياطية', extensions: ['zip'] }] });
    if (r.canceled) return null;
    backup.createBackup(db, r.filePath);
    logger.info('backup', 'تم إنشاء نسخة احتياطية: ' + path.basename(r.filePath), { status: 'success' });
    return r.filePath;
  }, { protectedOp: true });
  handle('backup:restore', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'استعادة نسخة احتياطية', properties: ['openFile'], filters: [{ name: 'نسخة احتياطية', extensions: ['zip'] }] });
    if (r.canceled) return null;
    const c = await dialog.showMessageBox(mainWindow, { type: 'warning', buttons: ['استعادة وإعادة التشغيل', 'إلغاء'], defaultId: 1, cancelId: 1, title: 'تأكيد الاستعادة', message: 'سيتم استبدال كل الإعدادات والجداول الحالية بمحتوى النسخة الاحتياطية ثم إعادة تشغيل البرنامج. هل تريد المتابعة؟' });
    if (c.response !== 0) return null;
    db.frozen = true;
    try {
      backup.restoreBackup(r.filePaths[0]);
    } catch (e) { db.frozen = false; throw e; }
    logger.info('backup', 'تمت الاستعادة من نسخة احتياطية: ' + path.basename(r.filePaths[0]) + ' — إعادة التشغيل', { status: 'success' });
    setTimeout(() => { quitting = true; app.relaunch(); app.exit(0); }, 500);
    return true;
  }, { protectedOp: true });
  handle('migration:importFolder', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'اختر مجلد حزمة الترحيل AlfajrRadio_Migration', properties: ['openDirectory'] });
    if (r.canceled) return null;
    if (!migration.isMigrationPackage(r.filePaths[0])) throw new Error('المجلد المختار ليس حزمة ترحيل صالحة (يجب أن يحتوي data/settings.json و data/prayer-times.csv)');
    const report = db.update((d) => migration.applyPackage(d, r.filePaths[0]), { immediate: true });
    logger.info('migration', `تم استيراد حزمة الترحيل يدوياً: ${report.files} ملف`, { status: 'success' });
    report.warnings.forEach((w) => logger.warn('migration', w));
    refreshDurations().catch(() => {});
    return report;
  }, { protectedOp: true });
  handle('app:openDataFolder', () => shell.openPath(P.data));
  handle('app:info', () => ({ version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, dataDir: P.data }));

}

function startBroadcast() {
  // بث مستمر للحالة وللسجلات
  logger.on('entry', (e) => send('log', e));
  logger.on('cleared', () => send('logs-cleared'));
  setInterval(() => send('state', snapshot()), 1000);
  ctx.db.on('change', () => { clearTimeout(ctx._dbChangeTimer); ctx._dbChangeTimer = setTimeout(() => send('db-changed'), 300); });
  for (const em of ['browser', 'local', 'background', 'playback']) ctx[em].on('state', () => send('state', snapshot()));
  ctx.adblock.on('state', () => send('ext-changed'));
  ctx.extensions.on('state', () => send('ext-changed'));
}

// ───── دورة حياة التطبيق ─────
app.on('second-instance', () => showWindow());

app.whenReady().then(async () => {
  initCore();
  applyStartupSetting();
  applySleepSetting();
  createMainWindow();
  buildTray();
  registerIpc();
  ctx.enginesReady = initEngines();
  await ctx.enginesReady;
  startBroadcast();
  if (process.env.ALFAJR_TEST_SCRIPT && !app.isPackaged) {
    require(path.resolve(process.env.ALFAJR_TEST_SCRIPT))({ ...ctx, mainWindow, app, snapshot });
  }
}).catch((e) => {
  logger.error('system', 'خطأ فادح أثناء بدء التشغيل: ' + (e.stack || e.message), { status: 'fail' });
  dialog.showErrorBox('Ads Alfajr Manager', 'حدث خطأ أثناء بدء التشغيل:\n' + e.message);
});

app.on('before-quit', () => {
  quitting = true;
  try { logger.info('system', 'إيقاف البرنامج'); ctx.db?.saveNow(); } catch { /* ignore */ }
});

app.on('window-all-closed', () => { /* يبقى في شريط النظام */ });

process.on('uncaughtException', (e) => { try { logger.error('system', 'خطأ غير متوقع: ' + (e.stack || e.message), { status: 'fail' }); } catch { /* ignore */ } });
process.on('unhandledRejection', (e) => {
  // سكربتات الفلترة التجميلية قد تفشل في بعض الصفحات — لا تؤثر على النظام
  if (/Script failed to execute/.test(String(e && e.message))) return;
  try { logger.error('system', 'خطأ غير متوقع: ' + (e?.stack || e), { status: 'fail' }); } catch { /* ignore */ } });
