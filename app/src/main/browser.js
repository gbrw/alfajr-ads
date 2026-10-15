'use strict';
/*
 * المتصفح المدمج: WebContentsView بجلسة دائمة (تحفظ تسجيلات الدخول)، مع سكربت خفض الصوت داخل الصفحة.
 * آلية الخفض:
 *  1) الأساس: اعتراض خاصية volume لكل عناصر الصوت/الفيديو، فالصوت الفعلي = صوت الموقع × معامل الخفض.
 *     يُعاد تطبيقه دورياً وبعد كل تنقل لأن المواقع تعيد ضبط الصوت وحدها.
 *  2) عند فشل التحقق: إيقاف مؤقت للعناصر ثم استئنافها لاحقاً.
 *  3) الملاذ الأخير: كتم صوت محتوى المتصفح بالكامل (setAudioMuted).
 * تسجيل الدخول إلى Google: يتم في صفحة Google الرسمية نفسها (بلا تعديل عليها)، والكوكيز في جلسة
 * دائمة تُكتب إلى القرص فور تغيّرها وعند الخروج. إن رفضت Google الدخول من متصفح مدمج نكتشف صفحة الرفض
 * ونعرض البدائل المدعومة بدلاً من محاولة الالتفاف على فحص الأمان.
 */
const { WebContentsView, BrowserWindow, session } = require('electron');
const { EventEmitter } = require('events');

const PARTITION = 'persist:browser';
const SIGNIN_URL = 'https://accounts.google.com/ServiceLogin?service=youtube&continue=' + encodeURIComponent('https://www.youtube.com/signin?action_handle_signin=true&next=%2F');
const GOOGLE_AUTH_HOST = /^accounts\.google\.[a-z.]+$/i;
// صفحة رفض Google لتسجيل الدخول من المتصفحات المدمجة ("This browser or app may not be secure")
const REJECTED_URL = /^https:\/\/accounts\.google\.[a-z.]+\/(v\d+\/)?signin\/rejected/i;
const REJECTED_TEXT = /may not be secure|This browser or app|قد لا يكون هذا المتصفح|المتصفح أو التطبيق.*آمن/i;
// كوكيز تدل على جلسة يوتيوب مسجّلة
const YT_LOGIN_COOKIES = ['LOGIN_INFO', 'SAPISID', '__Secure-3PAPISID'];

const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ''; } };

const DUCK_SCRIPT = String.raw`(() => {
  if (window.__alfajrDuck) return true;
  const proto = HTMLMediaElement.prototype;
  const vd = Object.getOwnPropertyDescriptor(proto, 'volume');
  const logical = new WeakMap();
  const tracked = new Set();
  const clamp = (v) => Math.max(0, Math.min(1, Number(v) || 0));
  const S = window.__alfajrDuck = { factor: 1, target: 1, timer: null, hold: false, pausedByUs: [] };
  const logicalOf = (el) => { if (!logical.has(el)) logical.set(el, vd.get.call(el)); return logical.get(el); };
  const seen = (el) => { for (const r of tracked) if (r.deref() === el) return true; return false; };
  const track = (el) => { if (!seen(el)) tracked.add(new WeakRef(el)); vd.set.call(el, clamp(logicalOf(el) * S.factor)); };
  Object.defineProperty(proto, 'volume', {
    configurable: true, enumerable: true,
    get() { return logical.has(this) ? logical.get(this) : vd.get.call(this); },
    set(v) { logical.set(this, v); vd.set.call(this, clamp(v * S.factor)); },
  });
  const origPlay = proto.play;
  proto.play = function () { track(this); return origPlay.apply(this, arguments); };
  const all = () => {
    const out = [];
    for (const r of tracked) { const el = r.deref(); if (!el) tracked.delete(r); else out.push(el); }
    document.querySelectorAll('video,audio').forEach((el) => { if (!out.includes(el)) { tracked.add(new WeakRef(el)); out.push(el); } });
    return out;
  };
  const apply = () => all().forEach((el) => vd.set.call(el, clamp(logicalOf(el) * S.factor)));
  S.fadeTo = (to, ms) => {
    clearInterval(S.timer); S.timer = null;
    const from = S.factor; const t0 = performance.now(); S.target = to;
    if (!ms) { S.factor = to; apply(); return; }
    S.timer = setInterval(() => {
      const t = Math.min(1, (performance.now() - t0) / ms);
      S.factor = from + (to - from) * (t * t * (3 - 2 * t));
      apply();
      if (t >= 1) { clearInterval(S.timer); S.timer = null; }
    }, 30);
  };
  S.ensure = (f, hold) => {
    S.hold = !!hold;
    if (!S.timer && (Math.abs(S.factor - f) > 0.001 || Math.abs(S.target - f) > 0.001)) S.fadeTo(f, 0);
    else if (!S.timer) apply();
    if (S.hold) S.pauseAll();
  };
  S.pauseAll = () => { all().forEach((el) => { if (!el.paused) { S.pausedByUs.push(new WeakRef(el)); el.pause(); } }); };
  S.resumeAll = () => {
    const list = S.pausedByUs; S.pausedByUs = []; S.hold = false;
    list.forEach((r) => { const el = r.deref(); if (el && el.paused && el.isConnected) el.play().catch(() => {}); });
  };
  S.status = () => all().map((el) => ({ paused: el.paused, actual: vd.get.call(el), expected: clamp(logicalOf(el) * S.factor) }));
  document.addEventListener('play', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLMediaElement)) return;
    track(el);
    if (S.hold) { el.pause(); S.pausedByUs.push(new WeakRef(el)); }
  }, true);
  return true;
})()`;

class EmbeddedBrowser extends EventEmitter {
  constructor({ db, logger }) {
    super();
    this.db = db;
    this.logger = logger;
    this.view = null;
    this.window = null;
    this.factor = 1;        // معامل الصوت الحالي المطلوب (حجم الخلفية × الخفض)
    this.hold = false;      // منع التشغيل (خارج ساعات العمل / إيقاف طارئ / مصدر محلي)
    this.fadeUntil = 0;
    this.audible = false;
    this.userMuted = false;  // كتم المشرف (زر الكتم)
    this.adMuted = false;    // كتم تلقائي أثناء إعلان يوتيوب
    this.adStats = { muted: 0, skipped: 0 };
    this.mediaPlaying = false;
    this.visible = false;
    this._saveUrlTimer = null;
    this.signedIn = null;        // null = لم يُفحص بعد
    this.signinBlocked = false;  // Google رفضت تسجيل الدخول من المتصفح المدمج
    this.authWindow = null;
  }

  get session() { return session.fromPartition(PARTITION); }

  /** وكيل مستخدم كروم قياسي (بدون Electron) حتى لا ترفض يوتيوب/جوجل تسجيل الدخول. */
  static chromeUA() {
    const v = process.versions.chrome || '140.0.0.0';
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v.split('.')[0]}.0.0.0 Safari/537.36`;
  }

  create(window) {
    this.window = window;
    const ses = this.session;
    ses.setUserAgent(EmbeddedBrowser.chromeUA());
    ses.setPermissionRequestHandler((_wc, permission, cb) => cb(['fullscreen', 'clipboard-sanitized-write'].includes(permission)));

    this.view = new WebContentsView({
      webPreferences: {
        session: ses,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
        contextIsolation: true,
        sandbox: true,
      },
    });
    this.view.setVisible(false);
    window.contentView.addChildView(this.view);
    const wc = this.view.webContents;
    wc.setMaxListeners(100);

    wc.setWindowOpenHandler(({ url }) => {
      // نوافذ تسجيل الدخول المنبثقة تحتاج window.opener: تُفتح نافذةً حقيقية بنفس الجلسة
      if (GOOGLE_AUTH_HOST.test(hostOf(url))) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            parent: window, width: 520, height: 720, autoHideMenuBar: true, title: 'تسجيل الدخول إلى Google',
            webPreferences: { session: ses, contextIsolation: true, sandbox: true },
          },
        };
      }
      if (/^https?:/i.test(url)) wc.loadURL(url);
      return { action: 'deny' };
    });
    wc.on('did-create-window', (child) => {
      this.authWindow = child;
      child.on('closed', () => { if (this.authWindow === child) this.authWindow = null; this.refreshSignIn(); });
      this._watchAuthPage(child.webContents);
    });
    this._watchAuthPage(wc);

    // حفظ الجلسة: الكوكيز تُكتب للقرص فور تغيّرها (لا تضيع إن أُغلق البرنامج فجأة)
    ses.cookies.on('changed', (_e, cookie) => {
      if (!/(^|\.)(google|youtube)\.[a-z.]+$/i.test(cookie.domain.replace(/^\./, ''))) return;
      clearTimeout(this._cookieTimer);
      this._cookieTimer = setTimeout(() => { this.flushSession(); this.refreshSignIn(); }, 1500);
    });
    this.refreshSignIn();
    const inject = () => this._inject().catch(() => {});
    wc.on('dom-ready', inject);
    wc.on('did-frame-finish-load', inject);
    wc.on('did-navigate', (_e, url) => this._onNav(url));
    wc.on('did-navigate-in-page', (_e, url, isMain) => { if (isMain) this._onNav(url); inject(); });
    wc.on('page-title-updated', () => this.emit('state', this.state()));
    wc.on('did-start-loading', () => this.emit('state', this.state()));
    wc.on('did-stop-loading', () => this.emit('state', this.state()));
    wc.on('media-started-playing', () => { this.mediaPlaying = true; this.emit('state', this.state()); });
    wc.on('media-paused', () => { this.mediaPlaying = false; this.emit('state', this.state()); });
    wc.on('audio-state-changed', (e) => { this.audible = !!e.audible; this.emit('state', this.state()); });
    // نقرة أو كتابة داخل الصفحة = المشرف يريد المتصفح مصدراً للخلفية
    wc.on('input-event', (_e, input) => {
      if (Date.now() < (this._synthUntil || 0)) return; // نقرة "تخطي" الآلية ليست تفاعلاً من المشرف
      if (input.type === 'mouseDown' || input.type === 'keyDown') this.emit('user-interaction');
    });
    wc.on('did-fail-load', (_e, code, desc, url, isMain) => {
      if (isMain && code !== -3) this.logger.warn('background', `تعذر تحميل الصفحة ${url}: ${desc} (${code})`, { status: 'fail' });
    });
    wc.on('render-process-gone', (_e, d) => {
      this.logger.error('background', `توقفت صفحة المتصفح (${d.reason}) — إعادة التحميل`, { status: 'fail' });
      setTimeout(() => { try { wc.reload(); } catch { /* ignore */ } }, 2000);
    });

    // إعادة تطبيق الخفض دورياً لأن المواقع تعيد ضبط الصوت
    this._ensureTimer = setInterval(() => this._ensure(), 1500);
    // كتم إعلانات يوتيوب التي يفلت بها المانع: يُكتم الصوت أثناء الإعلان ويعود بعده
    this._adTimer = setInterval(() => this._checkYoutubeAd(), 500);
  }

  loadInitial() {
    const s = this.db.get().settings.background;
    const url = s.lastUrl || s.homeUrl || 'https://www.youtube.com/';
    this.navigate(url);
  }

  _onNav(url) {
    clearTimeout(this._saveUrlTimer);
    this._saveUrlTimer = setTimeout(() => {
      if (/^https?:/i.test(url)) this.db.update((d) => { d.settings.background.lastUrl = url; }, { silent: true });
    }, 1500);
    this.emit('state', this.state());
  }

  _frames() {
    if (!this.alive()) return [];
    // صفحات تسجيل الدخول لا تُحقن بأي سكربت
    try { return this.view.webContents.mainFrame.framesInSubtree.filter((f) => !GOOGLE_AUTH_HOST.test(hostOf(f.url))); } catch { return []; }
  }

  /** يراقب صفحات Google لاكتشاف رفض تسجيل الدخول من المتصفح المدمج. */
  _watchAuthPage(wc) {
    const check = async () => {
      if (wc.isDestroyed()) return;
      const url = wc.getURL();
      if (!GOOGLE_AUTH_HOST.test(hostOf(url))) return;
      let blocked = REJECTED_URL.test(url);
      if (!blocked) {
        const text = await Promise.race([
          wc.mainFrame.executeJavaScript('document.title + " " + (document.body ? document.body.innerText.slice(0, 2000) : "")').catch(() => ''),
          new Promise((r) => setTimeout(() => r(''), 2000)),
        ]);
        blocked = REJECTED_TEXT.test(text) && /signin|ServiceLogin|rejected/i.test(url);
      }
      if (blocked && !this.signinBlocked) {
        this.signinBlocked = true;
        this.logger.warn('background', 'رفضت Google تسجيل الدخول من المتصفح المدمج ("قد لا يكون هذا المتصفح آمناً") — اعرض البدائل المدعومة من زر "حساب Google"', { status: 'fail' });
        this.emit('signin-blocked');
        this.emit('state', this.state());
      }
    };
    wc.on('did-navigate', check);
    wc.on('did-stop-loading', check);
  }

  /** يفحص كوكيز يوتيوب لمعرفة هل الجلسة مسجّلة. */
  async refreshSignIn() {
    try {
      const list = await this.session.cookies.get({ domain: 'youtube.com' });
      const now = list.some((c) => YT_LOGIN_COOKIES.includes(c.name));
      if (now !== this.signedIn) {
        const first = this.signedIn === null;
        this.signedIn = now;
        if (now) {
          this.signinBlocked = false;
          this.logger.info('background', first ? 'جلسة YouTube محفوظة من التشغيل السابق — مسجّل الدخول' : 'تم تسجيل الدخول إلى YouTube — الجلسة محفوظة وستبقى بعد إعادة فتح البرنامج', { status: 'success' });
          if (this.authWindow && !this.authWindow.isDestroyed()) this.authWindow.close();
        } else if (!first) {
          this.logger.info('background', 'تم تسجيل الخروج من YouTube');
        }
        this.emit('state', this.state());
      }
    } catch { /* الجلسة قيد التهيئة */ }
    return this.signedIn;
  }

  /** كتابة الكوكيز وبيانات الجلسة إلى القرص. */
  async flushSession() {
    try { await this.session.cookies.flushStore(); } catch { /* ignore */ }
  }

  /** فتح صفحة تسجيل الدخول الرسمية لـ Google داخل المتصفح المدمج. */
  signIn() {
    this.signinBlocked = false;
    this.navigate(SIGNIN_URL);
    this.emit('state', this.state());
  }

  /** تسجيل الخروج: حذف كوكيز Google/YouTube من جلسة المتصفح. */
  async signOut() {
    const ses = this.session;
    const all = await ses.cookies.get({});
    const mine = all.filter((c) => /(^|\.)(google|youtube)\.[a-z.]+$/i.test(c.domain.replace(/^\./, '')));
    await Promise.all(mine.map((c) => {
      const url = `http${c.secure ? 's' : ''}://${c.domain.replace(/^\./, '')}${c.path || '/'}`;
      return ses.cookies.remove(url, c.name).catch(() => {});
    }));
    await this.flushSession();
    this.signedIn = false;
    this.signinBlocked = false;
    this.logger.info('background', `تم تسجيل الخروج من Google/YouTube في المتصفح المدمج (حُذف ${mine.length} ملف تعريف)`);
    if (/youtube\.com|google\./.test(hostOf(this.view.webContents.getURL()))) this.view.webContents.reload();
    this.emit('state', this.state());
  }

  async _execAll(code) {
    const results = [];
    await Promise.all(this._frames().map(async (f) => {
      // مهلة لكل إطار: الإطار أثناء التنقل قد لا يرد أبداً، ولا يجوز أن يجمّد ذلك تسلسل الأذان
      try { results.push(await Promise.race([f.executeJavaScript(code), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2500))])); } catch { /* إطار قيد التحميل */ }
    }));
    return results;
  }

  async _inject() {
    await this._execAll(`${DUCK_SCRIPT};window.__alfajrDuck.ensure(${this.factor}, ${this.hold});true`);
  }

  _ensure() {
    if (!this.view || Date.now() < this.fadeUntil) return;
    this._execAll(`window.__alfajrDuck ? (window.__alfajrDuck.ensure(${this.factor}, ${this.hold}), true) : (${DUCK_SCRIPT}, window.__alfajrDuck.ensure(${this.factor}, ${this.hold}), true)`).catch(() => {});
  }

  /** تدرّج معامل الصوت داخل الصفحة. */
  async fadeTo(factor, ms) {
    this.factor = Math.max(0, Math.min(1, factor));
    this.fadeUntil = Date.now() + ms + 200;
    await this._execAll(`${DUCK_SCRIPT};window.__alfajrDuck.fadeTo(${this.factor}, ${Math.round(ms)});true`);
    await new Promise((r) => setTimeout(r, ms));
  }

  /** يتحقق أن الصوت الفعلي للعناصر العاملة يطابق المطلوب. */
  async verify() {
    const res = await this._execAll('window.__alfajrDuck ? window.__alfajrDuck.status() : []');
    const items = res.flat().filter((x) => x && !x.paused);
    const bad = items.filter((x) => Math.abs(x.actual - x.expected) > 0.05);
    return { ok: bad.length === 0, playing: items.length, mismatched: bad.length };
  }

  async pauseMedia() {
    this.hold = true;
    await this._execAll('window.__alfajrDuck && (window.__alfajrDuck.hold = true, window.__alfajrDuck.pauseAll()); true');
  }

  async resumeMedia() {
    this.hold = false;
    await this._execAll('window.__alfajrDuck && window.__alfajrDuck.resumeAll(); true');
  }

  /** منع التشغيل بدون استئناف ما أُوقف (خارج ساعات العمل / المصدر المحلي فعّال). */
  async setHold(hold) {
    this.hold = !!hold;
    if (hold) await this.pauseMedia();
  }

  setMuted(m) { this.userMuted = !!m; this._applyMute(); }

  _applyMute() { if (this.alive()) this.view.webContents.setAudioMuted(this.userMuted || this.adMuted); }

  /**
   * يكتشف إعلان يوتيوب (المشغّل في وضع الإعلان) فيكتم صوت المتصفح حتى ينتهي ثم يعيده.
   * إن ظهر زر "تخطي" يُضغط بنقرة ماوس حقيقية (يوتيوب يتجاهل النقرات البرمجية).
   */
  async _checkYoutubeAd() {
    if (!this.alive() || this._adBusy) return;
    const wc = this.view.webContents;
    if (!/^https:\/\/([a-z]+\.)?youtube\.com\//.test(wc.getURL())) {
      if (this.adMuted) { this.adMuted = false; this._applyMute(); }
      return;
    }
    this._adBusy = true;
    try {
      const r = await Promise.race([
        wc.mainFrame.executeJavaScript(`(() => {
          const p = document.querySelector('#movie_player');
          const ad = !!(p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting')));
          let skip = null;
          if (ad) {
            const b = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern');
            if (b && b.offsetParent !== null) {
              const rc = b.getBoundingClientRect();
              if (rc.width > 0 && rc.height > 0) skip = { x: Math.round(rc.left + rc.width / 2), y: Math.round(rc.top + rc.height / 2) };
            }
          }
          return { ad, skip };
        })()`),
        new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
      ]);
      if (!r) return;
      if (r.ad !== this.adMuted) {
        this.adMuted = r.ad;
        this._applyMute();
        if (r.ad) { this.adStats.muted++; this._skipLogged = false; this.logger.info('background', 'إعلان يوتيوب — تم كتم الصوت حتى ينتهي'); }
        else this.logger.info('background', 'انتهى إعلان يوتيوب — عاد الصوت طبيعياً');
        this.emit('state', this.state());
      }
      // نقرة حقيقية على "تخطي" (مرة كل ثانيتين كحد أقصى، وفقط والمتصفح ظاهر)
      if (r.ad && r.skip && this.visible && Date.now() - (this._lastSkipAt || 0) > 2000) {
        this._lastSkipAt = Date.now();
        this._synthUntil = Date.now() + 800;
        for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) {
          wc.sendInputEvent({ type, x: r.skip.x, y: r.skip.y, button: 'left', clickCount: 1 });
        }
        this.adStats.skipped++;
        if (!this._skipLogged) { this._skipLogged = true; this.logger.info('background', 'تم الضغط على "تخطي الإعلان" في يوتيوب'); }
      }
    } catch { /* الصفحة قيد التحميل */ } finally { this._adBusy = false; }
  }

  isPlaying() { return this.mediaPlaying || this.audible; }

  alive() { return !!(this.view && this.view.webContents && !this.view.webContents.isDestroyed()); }

  setBounds(rect) {
    if (!this.view) return;
    if (!rect || rect.width < 10 || rect.height < 10) { this.visible = false; this.view.setVisible(false); return; }
    this.view.setBounds({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) });
    this.visible = true;
    this.view.setVisible(true);
  }

  hide() { this.visible = false; if (this.view) this.view.setVisible(false); }

  navigate(input) {
    let url = String(input || '').trim();
    if (!url) return;
    if (!/^[a-z]+:\/\//i.test(url)) {
      url = /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(url) ? 'https://' + url : 'https://www.google.com/search?q=' + encodeURIComponent(url);
    }
    if (!/^https?:/i.test(url)) return;
    this.view.webContents.loadURL(url).catch(() => {});
  }

  action(a) {
    const wc = this.view.webContents;
    const nav = wc.navigationHistory;
    if (a === 'back' && nav.canGoBack()) nav.goBack();
    else if (a === 'forward' && nav.canGoForward()) nav.goForward();
    else if (a === 'reload') wc.reload();
    else if (a === 'stop') wc.stop();
    else if (a === 'home') this.navigate(this.db.get().settings.background.homeUrl);
  }

  state() {
    if (!this.view || !this.view.webContents || this.view.webContents.isDestroyed()) return {};
    const wc = this.view.webContents;
    return {
      url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward(),
      playing: this.isPlaying(), factor: this.factor, hold: this.hold, adMuted: this.adMuted,
      userMuted: this.userMuted, signedIn: this.signedIn, signinBlocked: this.signinBlocked,
      onSignInPage: GOOGLE_AUTH_HOST.test(hostOf(wc.getURL())),
    };
  }
}

module.exports = { EmbeddedBrowser, PARTITION, DUCK_SCRIPT, SIGNIN_URL, REJECTED_URL, REJECTED_TEXT };
