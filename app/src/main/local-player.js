'use strict';
/*
 * مشغّل الخلفية المحلي (بديل يعمل بدون إنترنت وبدون إعلانات): قوائم قرّاء وتلاوات من مكتبة التطبيق.
 * تشغيل / إيقاف مؤقت / إيقاف / التالي / السابق / خلط عشوائي.
 */
const { EventEmitter } = require('events');
const { AudioEngine } = require('./audio-engine');

class LocalPlayer extends EventEmitter {
  constructor({ db, logger, audio }) {
    super();
    this.db = db;
    this.logger = logger;
    this.audio = audio;
    this.status = 'stopped'; // playing | paused | stopped
    this.reciterId = null;
    this.order = [];
    this.pos = 0;
    this.token = null;
    this.volume = 0.7;
    this.position = 0;
    this.duration = 0;

    audio.on('ended', (p) => { if (p.channel === 'local' && p.token === this.token) this.next(true); });
    audio.on('error', (p) => {
      if (p.channel === 'local' && p.token === this.token) {
        this.logger.error('background', `تعذر تشغيل التلاوة: ${this.currentTrack()?.title || ''} (${p.message})`, { status: 'fail' });
        setTimeout(() => this.next(true), 1000);
      }
    });
    audio.on('progress', (p) => {
      if (p.channel === 'local' && p.token === this.token) { this.position = p.position; this.duration = p.duration; this.emit('progress'); }
    });
  }

  lib() { return this.db.get().localBackground; }

  reciter() {
    const lb = this.lib();
    const id = this.reciterId || lb.activeReciterId || lb.reciters[0]?.id;
    return lb.reciters.find((r) => r.id === id) || null;
  }

  hasContent() { return this.lib().reciters.some((r) => r.tracks.length > 0); }

  _buildOrder(startIndex = 0) {
    const r = this.reciter();
    const n = r ? r.tracks.length : 0;
    this.order = [...Array(n).keys()];
    if (this.lib().shuffle) {
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [this.order[i], this.order[j]] = [this.order[j], this.order[i]]; }
      const at = this.order.indexOf(startIndex);
      if (at > 0) [this.order[0], this.order[at]] = [this.order[at], this.order[0]];
      this.pos = 0;
    } else this.pos = Math.min(startIndex, Math.max(0, n - 1));
  }

  currentTrack() {
    const r = this.reciter();
    return r ? r.tracks[this.order[this.pos]] : null;
  }

  async play(reciterId, trackIndex = 0) {
    if (reciterId) {
      this.reciterId = reciterId;
      this.db.update((d) => { d.localBackground.activeReciterId = reciterId; }, { silent: true });
    } else if (!this.reciter() || !this.reciter().tracks.length) {
      // اختيار أول قارئ لديه تلاوات
      const r = this.lib().reciters.find((x) => x.tracks.length);
      if (r) this.reciterId = r.id;
    }
    this._buildOrder(trackIndex);
    return this._playCurrent();
  }

  async _playCurrent(attempt = 0) {
    const t = this.currentTrack();
    if (!t) { this.status = 'stopped'; this.emit('state'); return false; }
    const url = AudioEngine.urlFor(t.file);
    if (!url) {
      this.logger.error('background', `الملف الصوتي غير موجود: ${t.title}`, { status: 'fail' });
      const r = this.reciter();
      if (attempt < (r?.tracks.length || 0)) { this.pos = (this.pos + 1) % this.order.length; return this._playCurrent(attempt + 1); }
      this.status = 'stopped'; this.emit('state'); return false;
    }
    this.token = 'local-' + Date.now();
    try {
      await this.audio.call('play', { channel: 'local', url, volume: this.volume, token: this.token, fadeInMs: 800 });
      this.status = 'playing';
      this.logger.info('background', `الخلفية المحلية: ${this.reciter().name} — ${t.title}`);
    } catch (e) {
      this.logger.error('background', `تعذر تشغيل ${t.title}: ${e.message}`, { status: 'fail' });
      this.status = 'stopped';
    }
    this.emit('state');
    return this.status === 'playing';
  }

  async pause() { if (this.status === 'playing') { await this.audio.call('pause', { channel: 'local' }); this.status = 'paused'; this.emit('state'); } }

  async resume() {
    if (this.status === 'paused') { await this.audio.call('resume', { channel: 'local' }); this.status = 'playing'; this.emit('state'); return true; }
    if (this.status === 'stopped') return this.play();
    return true;
  }

  async stop() { await this.audio.call('stop', { channel: 'local' }).catch(() => {}); this.status = 'stopped'; this.token = null; this.emit('state'); }

  async next(auto = false) {
    if (!this.order.length) return this.play();
    this.pos = (this.pos + 1) % this.order.length;
    if (auto && this.pos === 0 && this.lib().shuffle) this._buildOrder(0);
    return this._playCurrent();
  }

  async prev() {
    if (!this.order.length) return this.play();
    this.pos = (this.pos - 1 + this.order.length) % this.order.length;
    return this._playCurrent();
  }

  async setVolume(v, fadeMs = 0) {
    this.volume = v;
    if (this.status === 'stopped') return;
    if (fadeMs > 0) await this.audio.call('fade', { channel: 'local', to: v, ms: fadeMs }, fadeMs + 10000);
    else await this.audio.call('setVolume', { channel: 'local', volume: v });
  }

  state() {
    const r = this.reciter();
    const t = this.currentTrack();
    return {
      status: this.status, reciterId: r?.id || null, reciterName: r?.name || null,
      trackTitle: t?.title || null, trackIndex: this.order[this.pos] ?? 0, shuffle: this.lib().shuffle,
      position: this.position, duration: this.duration,
    };
  }
}

module.exports = { LocalPlayer };
