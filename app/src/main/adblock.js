'use strict';
/*
 * حجب الإعلانات في المتصفح المدمج.
 * نتيجة الاختبار الفعلي (Electron 44 + uBlock Origin 1.75): الإضافة تُحمَّل لكنها لا تحجب أي طلب،
 * لأن Electron لا يوفر لها chrome.webNavigation ولا يمرر حجب webRequest للإضافات.
 * لذلك: المحرك المدمج (قوائم EasyList/EasyPrivacy/فلاتر uBlock عبر @ghostery/adblocker) هو الأساس في الوضع التلقائي،
 * ويُجرى اختبار ذاتي فعلي عند الإقلاع لكل محرك وتُعرض النتيجة للمشرف.
 */
const fs = require('fs');
const path = require('path');
const { BrowserWindow, session } = require('electron');
const { EventEmitter } = require('events');
const { P } = require('./paths');

const UPDATE_EVERY_MS = 7 * 24 * 3600 * 1000;

const PROBES = {
  'pagead2.googlesyndication.com': 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
  'securepubads.g.doubleclick.net': 'https://securepubads.g.doubleclick.net/tag/js/gpt.js',
  'googletagservices.com': 'https://www.googletagservices.com/tag/js/gpt.js',
  'amazon-adsystem.com': 'https://c.amazon-adsystem.com/aax2/apstag.js',
  'taboola.com': 'https://cdn.taboola.com/libtrc/loader.js',
};
const CONTROL = 'https://code.jquery.com/jquery-3.7.1.min.js';

class AdBlock extends EventEmitter {
  constructor({ db, logger }) {
    super();
    this.db = db;
    this.logger = logger;
    this.blocker = null;
    this.enabledIn = new Set();
    this.stats = { blocked: 0, redirected: 0, cosmetic: 0, since: Date.now(), byHost: {} };
    this.engineInfo = null;
    this.selfTest = { builtin: null, ublock: null }; // {ok, blocked, total, at, note}
  }

  get mode() { return this.db.get().settings.adblock.mode; }


  /**
   * إصلاح لمكتبة @ghostery/adblocker-electron: النسخة الأصلية تحقن السكربتات في الإطار الرئيسي
   * كلما طلبها أي إطار فرعي (فتتكرر وتفشل بخطأ "already declared"). هنا نحقن في الإطار الطالب فقط.
   */
  /** في وضع "كتم" لا يتدخل المانع داخل يوتيوب إطلاقاً (يوتيوب يكتشفه فيعطّل التشغيل: Experiencing interruptions). */
  youtubeBypass() { return this.db.get().settings.adblock.youtubeMode !== 'block'; }

  _patch(blocker) {
    const { parse } = require('tldts-experimental');
    const YT = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|googlevideo\.com|ytimg\.com|ggpht\.com|youtubei\.googleapis\.com)$/;
    const isYt = (u) => { try { return YT.test(new URL(u).hostname); } catch { return false; } };
    const fromYouTube = (d) => {
      let page = '';
      try { page = d.webContents && !d.webContents.isDestroyed() ? d.webContents.getURL() : ''; } catch { /* ignore */ }
      return isYt(page) || isYt(d.url) || isYt(d.referrer || '');
    };
    const origReq = blocker.onBeforeRequest;
    const origHdr = blocker.onHeadersReceived;
    blocker.onBeforeRequest = (d, cb) => (this.youtubeBypass() && fromYouTube(d) ? cb({}) : origReq(d, cb));
    blocker.onHeadersReceived = (d, cb) => (this.youtubeBypass() && fromYouTube(d) ? cb({}) : origHdr(d, cb));
    blocker.onInjectCosmeticFilters = async (event, url, msg) => {
      const frame = event.senderFrame;
      if (!frame) return;
      if (this.youtubeBypass() && (isYt(url) || isYt(event.sender.getURL()))) return;
      const parsed = parse(url);
      const isFirstRun = msg === undefined;
      const { active, styles, scripts } = blocker.getCosmeticsFilters({
        domain: parsed.domain || '', hostname: parsed.hostname || '', url,
        classes: msg?.classes, hrefs: msg?.hrefs, ids: msg?.ids,
        getBaseRules: isFirstRun, getInjectionRules: isFirstRun, getExtendedRules: false,
        getRulesFromHostname: isFirstRun, getRulesFromDOM: !isFirstRun,
        callerContext: { frameId: event.frameId, processId: event.processId, lifecycle: msg?.lifecycle },
      });
      if (active === false) return;
      if (styles.length > 0) {
        this.stats.cosmetic++;
        if (frame === event.sender.mainFrame) event.sender.insertCSS(styles, { cssOrigin: 'user' }).catch(() => {});
        else frame.executeJavaScript(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(styles)};(document.head||document.documentElement).appendChild(s)})()`).catch(() => {});
      }
      // كل سكربت في نطاق كتلة مستقل حتى لا تتصادم تعريفات const المشتركة (مثل JSONPath) بين السكربتات
      for (const script of scripts) frame.executeJavaScript(`{
${script}
}`).catch(() => {});
    };
    blocker.on('request-blocked', (req) => this._count('blocked', req));
    blocker.on('request-redirected', (req) => this._count('redirected', req));
    return blocker;
  }

  async _loadEngine() {
    const { ElectronBlocker } = require('@ghostery/adblocker-electron');
    const candidates = [path.join(P.adblockCache, 'engine.bin'), path.join(P.bundledAdblock, 'engine.bin')];
    for (const f of candidates) {
      try {
        if (!fs.existsSync(f)) continue;
        this.blocker = ElectronBlocker.deserialize(new Uint8Array(fs.readFileSync(f)));
        this.engineInfo = { file: f === candidates[0] ? 'محدّثة' : 'مرفقة مع البرنامج', mtime: fs.statSync(f).mtime.toISOString() };
        break;
      } catch (e) {
        this.logger.warn('adblock', `تعذر قراءة قوائم الفلترة (${path.basename(path.dirname(f))}): ${e.message}`);
      }
    }
    if (!this.blocker) {
      this.blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
      this._saveEngine();
      this.engineInfo = { file: 'منزّلة الآن', mtime: new Date().toISOString() };
    }
    this._patch(this.blocker);
  }

  _count(kind, req) {
    this.stats[kind]++;
    try {
      const h = new URL(req.url).hostname;
      this.stats.byHost[h] = (this.stats.byHost[h] || 0) + 1;
    } catch { /* ignore */ }
  }

  _saveEngine() {
    try {
      fs.mkdirSync(P.adblockCache, { recursive: true });
      fs.writeFileSync(path.join(P.adblockCache, 'engine.bin'), this.blocker.serialize());
    } catch (e) { this.logger.warn('adblock', 'تعذر حفظ قوائم الفلترة: ' + e.message); }
  }

  /** تحديث القوائم من الإنترنت (أسبوعياً). */
  async updateLists(force = false) {
    const last = this.db.get().settings.adblock.lastListUpdate;
    if (!force && last && Date.now() - new Date(last).getTime() < UPDATE_EVERY_MS) return false;
    try {
      const { ElectronBlocker } = require('@ghostery/adblocker-electron');
      const fresh = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
      const sessions = [...this.enabledIn];
      for (const s of sessions) this.blocker.disableBlockingInSession(s);
      this.blocker = this._patch(fresh);
      for (const s of sessions) this.blocker.enableBlockingInSession(s);
      this._saveEngine();
      this.engineInfo = { file: 'محدّثة', mtime: new Date().toISOString() };
      this.db.update((d) => { d.settings.adblock.lastListUpdate = new Date().toISOString(); }, { silent: true });
      this.logger.info('adblock', 'تم تحديث قوائم الفلترة (EasyList وغيرها)', { status: 'success' });
      return true;
    } catch (e) {
      this.logger.warn('adblock', 'تعذر تحديث قوائم الفلترة: ' + e.message, { status: 'fail' });
      return false;
    }
  }

  async init() {
    await this._loadEngine();
  }

  /** هل يُفعَّل المحرك المدمج حسب الوضع ونتيجة اختبار uBlock؟ */
  builtinWanted() {
    const m = this.mode;
    if (m === 'off' || m === 'ublock') return false;
    if (m === 'builtin' || m === 'both') return true;
    // auto: المحرك المدمج إلا إذا ثبت أن uBlock يعمل فعلياً
    return !(this.selfTest.ublock && this.selfTest.ublock.ok);
  }

  apply(ses) {
    const want = this.builtinWanted();
    const has = this.enabledIn.has(ses);
    if (want && !has) { this.blocker.enableBlockingInSession(ses); this.enabledIn.add(ses); }
    if (!want && has) { this.blocker.disableBlockingInSession(ses); this.enabledIn.delete(ses); }
    this.emit('state');
  }

  /**
   * اختبار فعلي: صفحة في جلسة معزولة تطلب سكربتات إعلانية معروفة + طلب سليم للمقارنة.
   * engine: 'builtin' | 'ublock'
   */
  async runSelfTest(engine, { ublockDir } = {}) {
    // جلسة معزولة دائمة (Electron لا يسمح بتحميل الإضافات في الجلسات المؤقتة)
    const ses = session.fromPartition(`persist:alfajr-selftest-${engine}`);
    await ses.clearCache().catch(() => {});
    let ext = null;
    let win = null;
    try {
      // ربط مباشر بمحرك الشبكة (enableBlockingInSession يسجّل معالجات ipc عامة لا تتكرر)
      if (engine === 'builtin') ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (d, cb) => this.blocker.onBeforeRequest(d, cb));
      else {
        ext = await ses.extensions.loadExtension(ublockDir, { allowFileAccess: true });
        await new Promise((r) => setTimeout(r, 12000)); // تهيئة قوائم uBlock
      }
      win = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true } });
      await win.loadURL('https://example.com/');
      const page = `window.__r={};let n=${Object.keys(PROBES).length + 1};const add=(k,u)=>{const s=document.createElement('script');s.src=u;s.onload=()=>{__r[k]='loaded';n--};s.onerror=()=>{__r[k]='blocked';n--};document.head.appendChild(s)};` +
        Object.entries(PROBES).map(([k, u]) => `add(${JSON.stringify(k)},${JSON.stringify(u)});`).join('') + `add('control',${JSON.stringify(CONTROL)});window.__done=()=>n===0;true`;
      await win.webContents.executeJavaScript(page);
      for (let i = 0; i < 40; i++) {
        if (await win.webContents.executeJavaScript('window.__done()')) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      const r = await win.webContents.executeJavaScript('window.__r');
      const total = Object.keys(PROBES).length;
      const blocked = Object.keys(PROBES).filter((k) => r[k] === 'blocked').length;
      const controlOk = r.control === 'loaded';
      const res = {
        ok: controlOk && blocked === total, blocked, total, controlOk, at: new Date().toISOString(),
        note: !controlOk ? 'لا يوجد اتصال بالإنترنت — تعذر الحكم' : `حُجب ${blocked} من ${total} طلبات إعلانية`,
        version: ext ? ext.version : undefined,
      };
      this.selfTest[engine] = res;
      return res;
    } catch (e) {
      const res = { ok: false, blocked: 0, total: Object.keys(PROBES).length, controlOk: false, at: new Date().toISOString(), note: 'فشل الاختبار: ' + e.message };
      this.selfTest[engine] = res;
      return res;
    } finally {
      if (win) win.destroy();
      if (engine === 'builtin') { try { ses.webRequest.onBeforeRequest(null); } catch { /* ignore */ } }
      if (ext) { try { ses.extensions.removeExtension(ext.id); } catch { /* ignore */ } }
      this.emit('state');
    }
  }

  state() {
    return {
      mode: this.mode, youtubeMode: this.db.get().settings.adblock.youtubeMode, builtinActive: this.enabledIn.size > 0, engineInfo: this.engineInfo,
      stats: { ...this.stats, topHosts: Object.entries(this.stats.byHost).sort((a, b) => b[1] - a[1]).slice(0, 10) },
      selfTest: this.selfTest, lastListUpdate: this.db.get().settings.adblock.lastListUpdate,
    };
  }
}

module.exports = { AdBlock, PROBES };
