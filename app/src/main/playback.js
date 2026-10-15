'use strict';
/*
 * منسّق التشغيل ذي الأولوية (الأذان، التنبيه، الإعلانات، الأذكار).
 * التسلسل المعتمد (من النظام القديم):
 *   خفض/إيقاف الخلفية بتدرّج ← صمت قبل (2ث) ← تشغيل بالصوت المحدد ← صمت بعد (2ث) ← إعادة الخلفية بتدرّج.
 * الأولويات: الأذان 0 > الإعلان الطارئ 1 > الأذكار 2 > الإعلان الاعتيادي 3.
 * الحدث الأعلى يقاطع الأدنى، والمقاطَع يُعاد إلى الطابور ويُستأنف من موضعه (بلا ضياع).
 */
const { EventEmitter } = require('events');
const T = require('../shared/time12');
const { AudioEngine } = require('./audio-engine');
const { windowAllows } = require('./planner');

const TYPE_CAT = { adhan: 'adhan', preadhan: 'preadhan', ad: 'ads', azkar: 'azkar' };
const WINDOW_NAMES = { adhan: 'الأذان', ads: 'الإعلانات', azkar: 'الأذكار', background: 'الخلفية' };

class Abort extends Error { constructor() { super('aborted'); this.aborted = true; } }

class Playback extends EventEmitter {
  constructor({ db, logger, audio, background, clock }) {
    super();
    Object.assign(this, { db, logger, audio, background, clock });
    this.queue = [];
    this.pendingRepeats = [];
    this.current = null;
    this.phase = 'idle'; // idle | ducking | silence-before | playing | silence-after | restoring
    this.running = false;
    this.stopped = false;
    this.muted = false;
    this.bgDucked = false;
    this.bgPaused = false;
    this.holdDuckSeries = new Set();
    this.seq = 0;
    this._sleepers = new Set();
    this._waitEnd = null;

    audio.on('ended', (p) => this._onAudio('ended', p));
    audio.on('error', (p) => this._onAudio('error', p));
    audio.on('progress', (p) => {
      if (p.channel === 'priority' && this.current && p.token === this.current.token) {
        this.current.position = p.position;
        this.current.duration = p.duration;
        this.emit('state');
      }
    });
    audio.on('crashed', () => {
      if (this._waitEnd) this._waitEnd({ reason: 'error', message: 'توقف محرك الصوت' });
    });
  }

  get s() { return this.db.get().settings; }

  _onAudio(kind, p) {
    if (p.channel !== 'priority' || !this.current || p.token !== this.current.token || !this._waitEnd) return;
    this._waitEnd(kind === 'ended' ? { reason: 'ended' } : { reason: 'error', message: p.message });
  }

  _sleep(ms) {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this._sleepers.delete(s); resolve(); }, ms);
      const s = { cancel: () => { clearTimeout(t); reject(new Abort()); } };
      this._sleepers.add(s);
    });
  }

  _abortSleeps() { for (const s of this._sleepers) s.cancel(); this._sleepers.clear(); }

  /** إضافة حدث إلى الطابور. job: حدث من المخطِّط أو تشغيل يدوي. */
  enqueue(ev, { manual = false } = {}) {
    if (this.stopped && !manual) return false;
    const job = {
      ...ev, seq: ++this.seq, manual,
      repeatIndex: ev.repeatIndex || 1,
      seriesId: ev.seriesId || `${ev.id}#${Date.now()}`,
      resumeAt: ev.resumeAt || 0,
      enqueuedAt: this.clock.now().getTime(),
    };
    this.queue.push(job);
    this.queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
    if (this.current && (this.phase !== 'idle')) {
      if (job.priority < this.current.job.priority && this.phase === 'playing') {
        this._preempt(job);
      } else if (['ducking', 'silence-before', 'playing'].includes(this.phase)) {
        this.logger.info(TYPE_CAT[job.type], `مؤجَّل: ${this._label(job)} — بانتظار انتهاء ${this._label(this.current.job)}`, { status: 'deferred' });
      }
    }
    this.emit('state');
    this._kick();
    return true;
  }

  _label(job) {
    return job.repeatCount > 1 ? `${job.label} (التكرار ${job.repeatIndex} من ${job.repeatCount})` : job.label;
  }

  async _preempt(byJob) {
    const cur = this.current;
    if (!cur || cur.preempted) return;
    cur.preempted = true;
    const r = await this.audio.call('stop', { channel: 'priority', fadeOutMs: 600 }).catch(() => ({ position: cur.position || 0 }));
    this.logger.warn(TYPE_CAT[cur.job.type], `أُوقف ${this._label(cur.job)} مؤقتاً لصالح ${byJob.label} (أولوية أعلى) — سيُستأنف بعده من ${T.formatDuration(r.position)}`, { status: 'deferred' });
    if (this._waitEnd) this._waitEnd({ reason: 'preempted', position: r.position });
  }

  async _kick() {
    if (this.running) return;
    this.running = true;
    try {
      while (!this.stopped && this.queue.length) {
        const job = this.queue.shift();
        try {
          await this._run(job);
        } catch (e) {
          if (e.aborted) break;
          this.logger.error(TYPE_CAT[job.type], `خطأ أثناء تشغيل ${job.label}: ${e.message}`, { status: 'fail' });
        }
      }
      if (!this.stopped && this.bgDucked && this.holdDuckSeries.size === 0 && this.queue.length === 0) {
        this.phase = 'restoring'; this.emit('state');
        await this.background.restore();
        this.bgDucked = false; this.bgPaused = false;
      }
    } catch (e) {
      if (!e.aborted) this.logger.error('scheduler', 'خطأ في منسّق التشغيل: ' + e.message, { status: 'fail' });
    } finally {
      this.phase = 'idle';
      this.current = null;
      this.running = false;
      this.emit('state');
      // ربما أُضيف حدث أثناء الإعادة
      if (!this.stopped && this.queue.length) setImmediate(() => this._kick());
    }
  }

  async _run(job) {
    const cat = TYPE_CAT[job.type];
    const now = new Date(Math.max(this.clock.now().getTime(), job.playAt || 0));
    const st = this.s;

    // 1) ساعات العمل
    if (!job.manual && !windowAllows(st, job.windowClass, now)) {
      this.logger.warn(cat, `رُفض تشغيل ${this._label(job)} الساعة ${T.formatDateTime12(now)}: خارج ساعات العمل المسموحة (${st.timeWindow.start} – ${st.timeWindow.end}) لـ${WINDOW_NAMES[job.windowClass]}`, { status: 'fail' });
      this._scheduleNextRepeat(job, now, true);
      return;
    }
    // 2) وجود الملف
    const url = AudioEngine.urlFor(job.audio);
    if (!url) {
      this.logger.error(cat, `الملف الصوتي غير موجود: ${this._label(job)}${job.audio ? ' (' + job.audio + ')' : ' (لم يُحدَّد ملف)'}`, { status: 'fail' });
      this.emit('alert', { level: 'error', message: `الملف الصوتي غير موجود: ${job.label}` });
      return;
    }

    this.current = { job, token: `p-${job.seq}-${Date.now()}`, position: job.resumeAt, duration: 0, preempted: false };

    // 3) خفض/إيقاف الخلفية
    const wantPause = st.ducking.mode === 'pause' || ((job.type === 'adhan' || job.type === 'preadhan') && st.ducking.pauseBackgroundDuringAdhan);
    let justDucked = false;
    if (!this.bgDucked || (wantPause && !this.bgPaused)) {
      this.phase = 'ducking'; this.emit('state');
      await this.background.duckFor({ pause: wantPause });
      this.bgDucked = true;
      this.bgPaused = this.bgPaused || wantPause;
      justDucked = true;
    }

    // 4) صمت قبل (بعد الخفض مباشرة) ثم انتظار الثانية المحددة بالضبط
    this.phase = 'silence-before'; this.emit('state');
    const silenceMs = justDucked ? (Number(st.ducking.silenceBeforePrioritySeconds) || 0) * 1000 : 0;
    const startAt = Math.max(this.clock.now().getTime() + silenceMs, job.playAt || 0);
    while (this.clock.now().getTime() < startAt) {
      // حدث أعلى أولوية وصل أثناء الانتظار ← يتقدّم، ويعود هذا للطابور دون أن يبدأ
      if (this.queue.some((j) => j.priority < job.priority)) {
        this.queue.push({ ...job, seq: ++this.seq });
        this.queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
        this.current = null;
        return;
      }
      await this._sleep(Math.min(100, startAt - this.clock.now().getTime()));
    }

    // 5) التشغيل
    const vol = Math.max(0, Math.min(1, st.volume.master * (st.volume[job.volumeClass] ?? 1)));
    this.phase = 'playing'; this.emit('state');
    const endPromise = new Promise((resolve) => { this._waitEnd = resolve; });
    let result;
    try {
      const r = await this.audio.call('play', { channel: 'priority', url, volume: vol, startAt: job.resumeAt, token: this.current.token });
      this.current.duration = r?.duration || 0;
      this.logger.info(cat, `بدء تشغيل ${this._label(job)}${job.resumeAt ? ` (استئناف من ${T.formatDuration(job.resumeAt)})` : ''} — المدة ${T.formatDuration(r?.duration)}، الصوت ${Math.round(vol * 100)}%${job.manual ? ' [تشغيل يدوي]' : ''}`);
      this.emit('event-start', job);
      result = await endPromise;
    } catch (e) {
      result = { reason: 'error', message: e.message };
    } finally {
      this._waitEnd = null;
    }

    if (result.reason === 'stopped') return;
    if (result.reason === 'preempted') {
      this.queue.push({ ...job, seq: ++this.seq, resumeAt: Math.max(0, (result.position || 0) - 1), priority: job.priority });
      this.queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
      return;
    }
    if (result.reason === 'error') {
      this.logger.error(cat, `فشل تشغيل ${this._label(job)}: ${result.message}`, { status: 'fail' });
      this.emit('alert', { level: 'error', message: `فشل تشغيل ${job.label}` });
    } else {
      this.logger.info(cat, `انتهى تشغيل ${this._label(job)}`, { status: 'success' });
    }

    // 6) تكرار الإعلان
    this._scheduleNextRepeat(job, this.clock.now(), false);

    // 7) صمت بعد
    this.phase = 'silence-after'; this.emit('state');
    await this._sleep((Number(st.ducking.silenceAfterSeconds) || 0) * 1000);
  }

  _scheduleNextRepeat(job, now, skipped) {
    if (job.type !== 'ad' || job.repeatIndex >= job.repeatCount) {
      this.holdDuckSeries.delete(job.seriesId);
      return;
    }
    const dueAt = now.getTime() + job.repeatIntervalSeconds * 1000;
    const next = { ...job, repeatIndex: job.repeatIndex + 1, resumeAt: 0, dueAt };
    delete next.seq;
    this.pendingRepeats.push(next);
    this._persistRepeats();
    if (!this.s.ducking.resumeBackgroundBetweenAdRepeats && !skipped) this.holdDuckSeries.add(job.seriesId);
    this.logger.info('ads', `انتظار الفاصل ${job.repeatIntervalSeconds} ثانية قبل ${job.label} (التكرار ${next.repeatIndex} من ${job.repeatCount}) — الموعد ${T.formatDateTime12(new Date(dueAt))}`);
  }

  _persistRepeats() {
    this.db.update((d) => { d.runtime.pendingRepeats = this.pendingRepeats.map((r) => ({ ...r, at: undefined })); }, { silent: true });
  }

  /** يُستدعى كل نبضة من المجدول. */
  tick(now, leadMs = 0) {
    if (!this.pendingRepeats.length || this.stopped) return;
    const t = now.getTime() + leadMs;
    const due = this.pendingRepeats.filter((r) => r.dueAt <= t);
    if (!due.length) return;
    this.pendingRepeats = this.pendingRepeats.filter((r) => r.dueAt > t);
    this._persistRepeats();
    for (const r of due) this.enqueue({ ...r, playAt: r.dueAt });
  }

  /** بعد إعادة التشغيل: استعادة تكرارات الإعلانات المعلّقة ضمن المهلة. */
  restoreRepeats(graceMs) {
    const saved = this.db.get().runtime.pendingRepeats || [];
    const now = this.clock.now().getTime();
    this.pendingRepeats = saved.filter((r) => r.dueAt + graceMs >= now);
    const dropped = saved.length - this.pendingRepeats.length;
    if (dropped) this.logger.warn('ads', `تم تجاوز ${dropped} تكرار إعلان فات موعده أثناء توقف البرنامج`, { status: 'fail' });
    this._persistRepeats();
  }

  async emergencyStop() {
    this.stopped = true;
    const dropped = this.queue.length + this.pendingRepeats.length;
    this.queue = [];
    this.pendingRepeats = [];
    this._persistRepeats();
    this.holdDuckSeries.clear();
    this._abortSleeps();
    if (this._waitEnd) this._waitEnd({ reason: 'stopped' });
    await this.audio.call('stop', { channel: 'priority' }).catch(() => {});
    await this.background.setEmergency(true);
    this.bgDucked = false; this.bgPaused = false;
    this.logger.warn('system', `إيقاف طارئ: تم إيقاف المجدول وكل الأصوات فوراً${dropped ? ` (أُلغي ${dropped} حدث في الانتظار)` : ''}`, { status: 'fail' });
    this.emit('state');
  }

  async resumeFromEmergency() {
    this.stopped = false;
    await this.background.setEmergency(false);
    this.logger.info('system', 'تم استئناف التشغيل بعد الإيقاف الطارئ — النظام يعمل بشكل طبيعي', { status: 'success' });
    this.emit('state');
  }

  async setMuted(m) {
    this.muted = !!m;
    await this.audio.call('mute', { muted: this.muted }).catch(() => {});
    this.background.browser.setMuted(this.muted);
    this.logger.info('system', this.muted ? 'تم كتم الصوت' : 'تم إلغاء الكتم');
    this.emit('state');
  }

  /** إيقاف الحدث الحالي فقط (من زر "تخطي"). */
  async skipCurrent() {
    if (!this.current || this.phase !== 'playing') return;
    this.logger.warn(TYPE_CAT[this.current.job.type], `تم تخطي ${this._label(this.current.job)} يدوياً`, { status: 'fail' });
    await this.audio.call('stop', { channel: 'priority' }).catch(() => {});
    if (this._waitEnd) this._waitEnd({ reason: 'ended' });
  }

  state() {
    const c = this.current;
    return {
      phase: this.phase, stopped: this.stopped, muted: this.muted,
      current: c ? { label: this._label(c.job), type: c.job.type, position: c.position || 0, duration: c.duration || 0 } : null,
      queue: this.queue.map((j) => ({ label: this._label(j), type: j.type })),
      pendingRepeats: this.pendingRepeats.map((r) => ({ label: this._label(r), dueAt: T.formatDateTime12(new Date(r.dueAt)) })),
    };
  }
}

module.exports = { Playback };
