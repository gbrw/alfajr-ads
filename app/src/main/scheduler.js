'use strict';
/*
 * المجدول: نبضة كل 250ms تقارن الوقت الحالي بخطة اليوم بدقة الثانية.
 * - لا يعيد تشغيل حدث سبق تشغيله (المفاتيح تُحفظ في قاعدة البيانات).
 * - بعد إعادة التشغيل/انقطاع الكهرباء: يشغّل فقط ما فات قبل أقل من المهلة (افتراضياً دقيقتان).
 */
const { EventEmitter } = require('events');
const T = require('../shared/time12');
const { planDay, windowAllows } = require('./planner');
const { getDayTimes } = require('./prayers');
const { PRAYER_KEYS, PRAYER_NAMES } = require('./db');

const ON_TIME_MS = 5000;

class Scheduler extends EventEmitter {
  constructor({ db, logger, playback, background, clock }) {
    super();
    Object.assign(this, { db, logger, playback, background, clock });
    this.events = [];
    this.planDate = null;
    this.timer = null;
    this.firstTick = true;
    this._rebuildTimer = null;
    this._lastSecond = -1;
  }

  /** مهلة البدء المبكر: الخفض + الصمت قبل، ليبدأ الصوت بالثانية الصحيحة تماماً. */
  get leadMs() {
    const d = this.db.get().settings.ducking;
    return ((Number(d.fadeOutSeconds) || 0) + (Number(d.silenceBeforePrioritySeconds) || 0)) * 1000 + 300;
  }

  get graceMs() { return Math.max(0, Number(this.db.get().settings.reliability.missedEventGraceMinutes) || 0) * 60000; }

  start() {
    this.rebuild();
    this.playback.restoreRepeats(this.graceMs);
    this.db.on('change', () => {
      clearTimeout(this._rebuildTimer);
      this._rebuildTimer = setTimeout(() => this.rebuild(), 400);
    });
    this.timer = setInterval(() => this.tick(), 250);
    this.tick();
  }

  stop() { clearInterval(this.timer); }

  rebuild() {
    const now = this.clock.now();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const y = new Date(today); y.setDate(y.getDate() - 1);
    const t = new Date(today); t.setDate(t.getDate() + 1);
    const d = this.db.get();
    this.events = [...planDay(d, y), ...planDay(d, today), ...planDay(d, t)];
    const newDay = this.planDate !== T.dateKey(today);
    this.planDate = T.dateKey(today);
    if (newDay) this._onNewDay(today);
    this.emit('plan', this.events);
  }

  _onNewDay(today) {
    const d = this.db.get();
    const times = getDayTimes(d, today);
    if (times) {
      const txt = PRAYER_KEYS.map((k) => `${PRAYER_NAMES[k]} ${T.format12(times.secs[k])}`).join('، ');
      this.logger.info('prayers', `تحديث مواقيت اليوم ${T.dateKey(today)} (${d.settings.city}): ${txt}`);
    } else {
      this.logger.error('prayers', `لا توجد مواقيت لليوم ${T.dateKey(today)} في الجدول`, { status: 'fail' });
    }
    // تنظيف مفاتيح الأيام القديمة
    const keep = new Set([-1, 0].map((o) => { const x = new Date(today); x.setDate(x.getDate() + o); return T.dateKey(x); }));
    this.db.update((dd) => {
      for (const k of Object.keys(dd.runtime.firedKeys)) if (!keep.has(k)) delete dd.runtime.firedKeys[k];
    }, { silent: true });
  }

  _isFired(ev) {
    const list = this.db.get().runtime.firedKeys[ev.id.split('|')[0]];
    return !!list && list.includes(ev.id);
  }

  _markFired(ev) {
    const dk = ev.id.split('|')[0];
    this.db.update((d) => {
      (d.runtime.firedKeys[dk] ||= []).push(ev.id);
      d.runtime.lastRunAt = this.clock.now().toISOString();
    }, { silent: true });
  }

  tick() {
    const now = this.clock.now();
    if (T.dateKey(now) !== this.planDate) this.rebuild();

    const sec = Math.floor(now.getTime() / 1000);
    const newSecond = sec !== this._lastSecond;
    this._lastSecond = sec;

    let skippedAtStartup = 0;
    const lead = this.leadMs;
    for (const ev of this.events) {
      if (ev.at - lead > now) break; // مرتبة زمنياً
      if (this._isFired(ev)) continue;
      const late = now - ev.at;
      if (this.playback.stopped) {
        if (late > Math.max(ON_TIME_MS, this.graceMs)) {
          this._markFired(ev);
          this.logger.warn(ev.windowClass === 'adhan' ? 'adhan' : ev.type === 'ad' ? 'ads' : 'azkar', `لم يُشغَّل ${ev.label} (${T.format12(ev.sec)}) بسبب الإيقاف الطارئ`, { status: 'fail' });
        }
        continue;
      }
      if (late <= Math.max(ON_TIME_MS, this.graceMs)) {
        this._markFired(ev);
        if (late > ON_TIME_MS) this.logger.warn('scheduler', `تشغيل متأخر لحدث فات قبل ${Math.round(late / 1000)} ثانية (ضمن المهلة): ${ev.label}`, { status: 'deferred' });
        this.playback.enqueue({ ...ev, playAt: ev.at.getTime() });
      } else {
        this._markFired(ev);
        if (this.firstTick) skippedAtStartup++;
        else this.logger.warn('scheduler', `فات موعد ${ev.label} (${T.format12(ev.sec)}) بأكثر من المهلة — لم يُشغَّل`, { status: 'fail' });
      }
    }
    if (this.firstTick && skippedAtStartup) {
      this.logger.info('scheduler', `بدء المجدول: ${skippedAtStartup} حدث سابق اليوم تجاوز المهلة ولن يُشغَّل`);
    }
    this.firstTick = false;

    this.playback.tick(now, lead);

    if (newSecond) {
      // نافذة ساعات العمل للخلفية
      const allowed = windowAllows(this.db.get().settings, 'background', now);
      this.background.setOutsideWindow(!allowed).catch(() => {});
      this.emit('second', now);
    }
  }

  /** الحدث التالي (لم يُشغَّل بعد) مع العد التنازلي. */
  nextEvent() {
    const now = this.clock.now();
    const st = this.db.get().settings;
    for (const ev of this.events) {
      if (ev.at <= now || this._isFired(ev)) continue;
      return {
        id: ev.id, label: ev.label, type: ev.type, time: T.format12(ev.sec), at: ev.at.getTime(),
        dayLabel: T.dateKey(ev.at) === T.dateKey(now) ? 'اليوم' : 'غداً',
        secondsLeft: Math.round((ev.at - now) / 1000),
        outsideWindow: !windowAllows(st, ev.windowClass, ev.at),
      };
    }
    return null;
  }

  todayEvents() {
    const now = this.clock.now();
    const dk = T.dateKey(now);
    const st = this.db.get().settings;
    return this.events.filter((e) => T.dateKey(e.at) === dk).map((e) => ({
      id: e.id, label: e.label, type: e.type, time: T.format12(e.sec), fired: this._isFired(e), past: e.at <= now,
      outsideWindow: !windowAllows(st, e.windowClass, e.at),
    }));
  }
}

module.exports = { Scheduler };
