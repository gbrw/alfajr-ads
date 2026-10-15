'use strict';
/*
 * متحكم الخلفية الصوتية: يوحّد المصدرين (المتصفح المدمج / المشغل المحلي).
 * - الصوت الفعلي للخلفية = المستوى العام × مستوى الخلفية × معامل الخفض.
 * - الخفض والرفع بتدرّج (الافتراضي 3 ثوانٍ).
 * - يمنع تشغيل الخلفية خارج ساعات العمل، وأثناء الإيقاف الطارئ.
 * - عند انقطاع الإنترنت ينتقل تلقائياً للمصدر المحلي إن كان مفعّلاً وفيه تلاوات.
 */
const { EventEmitter } = require('events');

class BackgroundController extends EventEmitter {
  constructor({ db, logger, browser, local }) {
    super();
    this.db = db;
    this.logger = logger;
    this.browser = browser;
    this.local = local;
    this.duck = 1;               // 1 = طبيعي، أقل = منخفض، 0 = صامت
    this.pausedByDuck = false;
    this.emergency = false;
    this.outsideWindow = false;
    this.online = true;
    this.fallbackActive = false;
    this.localPausedByHold = false;
  }

  get s() { return this.db.get().settings; }
  get configuredSource() { return this.s.background.source; }
  get effectiveSource() {
    if (this.fallbackActive) return 'local';
    // مصدر محلي بلا تلاوات لا معنى له: لا نوقف المتصفح بسببه
    if (this.configuredSource === 'local' && !this.local.hasContent()) return 'browser';
    return this.configuredSource;
  }
  get blocked() { return this.emergency || this.outsideWindow; }

  baseVolume() { return this.s.volume.master * this.s.volume.background; }

  /** يطبّق المستوى الحالي على المصدرين بتدرّج. */
  async applyLevel(fadeMs = 0) {
    const target = this.baseVolume() * this.duck;
    await Promise.all([
      this.browser.fadeTo(this.effectiveSource === 'browser' ? target : 0, fadeMs).catch(() => {}),
      this.local.setVolume(target, fadeMs).catch(() => {}),
    ]);
  }

  /** خفض الخلفية قبل صوت ذي أولوية. pause=true يوقفها مؤقتاً بعد التدرّج. */
  async duckFor({ pause }) {
    const d = this.s.ducking;
    const fadeMs = (Number(d.fadeOutSeconds) || 0) * 1000;
    const level = pause ? 0 : Math.max(0, Math.min(1, Number(d.duckedLevel)));
    if (this.duck !== level || (pause && !this.pausedByDuck)) {
      this.duck = Math.min(this.duck, level);
      await this.applyLevel(this.isPlaying() ? fadeMs : 0);
    }
    if (pause && !this.pausedByDuck) {
      this.pausedByDuck = true;
      if (this.effectiveSource === 'browser') {
        await this.browser.pauseMedia();
      } else if (this.local.status === 'playing') {
        await this.local.pause();
        this._localPausedByDuck = true;
      }
    }
    // تحقق من نجاح الخفض داخل المتصفح؛ إن فشل نوقفه مؤقتاً (البديل)
    if (!pause && this.effectiveSource === 'browser' && this.browser.isPlaying()) {
      const v = await this.browser.verify().catch(() => ({ ok: true }));
      if (!v.ok) {
        this.logger.warn('background', `فشل خفض صوت المتصفح (${v.mismatched} عنصر) — تم الإيقاف المؤقت بدلاً منه`, { status: 'deferred' });
        this.pausedByDuck = true;
        await this.browser.pauseMedia();
      }
    }
    this.emit('state');
  }

  /** إعادة الخلفية بتدرّج بعد انتهاء الصوت ذي الأولوية. */
  async restore() {
    const fadeMs = (Number(this.s.ducking.fadeInSeconds) || 0) * 1000;
    if (this.pausedByDuck) {
      this.pausedByDuck = false;
      if (!this.blocked) {
        this.duck = 0;
        await this.applyLevel(0);
        if (this.effectiveSource === 'browser') await this.browser.resumeMedia();
        else if (this._localPausedByDuck) await this.local.resume();
      }
      this._localPausedByDuck = false;
    }
    this.duck = 1;
    await this.applyLevel(fadeMs);
    this.emit('state');
  }

  isPlaying() {
    return this.effectiveSource === 'browser' ? this.browser.isPlaying() : this.local.status === 'playing';
  }

  /** يحدّث منع التشغيل حسب (إيقاف طارئ، ساعات العمل، المصدر الفعال). */
  async refreshHold() {
    const browserHold = this.blocked || this.effectiveSource !== 'browser' || this.pausedByDuck;
    await this.browser.setHold(browserHold).catch(() => {});
    if (!browserHold && this.browser.hold === false) await this.browser.resumeMedia().catch(() => {});

    if (this.blocked || this.effectiveSource !== 'local') {
      if (this.local.status === 'playing') { await this.local.pause(); this.localPausedByHold = true; }
    } else if (this.localPausedByHold && !this.pausedByDuck) {
      this.localPausedByHold = false;
      await this.local.resume();
    }
    await this.applyLevel(0);
    this.emit('state');
  }

  async setEmergency(on) {
    this.emergency = on;
    if (on) {
      await this.browser.pauseMedia().catch(() => {});
      if (this.local.status !== 'stopped') { await this.local.pause(); this.localPausedByHold = true; }
    }
    this.pausedByDuck = false;
    this.duck = 1;
    await this.refreshHold();
  }

  async setOutsideWindow(outside) {
    if (this.outsideWindow === outside) return;
    this.outsideWindow = outside;
    if (outside) this.logger.warn('background', 'الخلفية خارج ساعات العمل المسموحة — تم إيقافها ومنع تشغيلها', { status: 'deferred' });
    else this.logger.info('background', 'بدأت ساعات العمل — يُسمح بتشغيل الخلفية');
    await this.refreshHold();
  }

  async setSource(src) {
    if (src === 'local' && !this.local.hasContent()) throw new Error('لا توجد تلاوات في الخلفية المحلية — أضف قارئاً وتلاوات أولاً');
    if (src === this.configuredSource) { await this.refreshHold(); return; }
    this.db.update((d) => { d.settings.background.source = src; });
    this.logger.info('background', `مصدر الخلفية الفعّال: ${src === 'browser' ? 'المتصفح' : 'المشغل المحلي'}`);
    if (src === 'local' && !this.blocked && this.local.status !== 'playing' && this.local.hasContent()) await this.local.resume();
    await this.refreshHold();
  }

  async setOnline(online) {
    if (this.online === online) return;
    this.online = online;
    const bg = this.s.background;
    if (!online && bg.source === 'browser' && bg.autoFallbackToLocal) {
      if (this.local.hasContent()) {
        this.fallbackActive = true;
        this.logger.warn('background', 'انقطع الإنترنت — انتقلت الخلفية تلقائياً إلى المصدر المحلي', { status: 'deferred' });
        this.emit('alert', { level: 'warn', message: 'انقطع الإنترنت — تم التحويل إلى الخلفية المحلية' });
        await this.refreshHold();
        if (!this.blocked && this.local.status !== 'playing') await this.local.resume();
      } else {
        this.logger.warn('background', 'انقطع الإنترنت ولا توجد تلاوات في الخلفية المحلية للتحويل إليها', { status: 'fail' });
      }
    } else if (online && this.fallbackActive) {
      this.fallbackActive = false;
      await this.local.stop();
      this.logger.info('background', 'عاد الإنترنت — عادت الخلفية إلى المتصفح');
      await this.refreshHold();
    }
    this.emit('state');
  }

  /** عند الإقلاع: إن كان المصدر محلياً نبدأ التشغيل تلقائياً. */
  async autostart() {
    if (this.effectiveSource === 'local' && !this.blocked && this.local.hasContent()) await this.local.play();
    await this.refreshHold();
  }

  state() {
    return {
      configuredSource: this.configuredSource, effectiveSource: this.effectiveSource, fallbackActive: this.fallbackActive,
      duck: this.duck, pausedByDuck: this.pausedByDuck, emergency: this.emergency, outsideWindow: this.outsideWindow,
      online: this.online, playing: this.isPlaying(),
    };
  }
}

module.exports = { BackgroundController };
