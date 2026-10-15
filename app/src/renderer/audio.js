'use strict';
/*
 * محرك الصوت (نافذة مخفية دائمة): قناتان مستقلتان
 *  - priority: الأذان والإعلانات والأذكار
 *  - local: الخلفية المحلية (التلاوات)
 * التدرج يتم بمنحنى ناعم (smoothstep) على فترات 20ms لتجنب القفزات الصوتية.
 */
(function () {
  const channels = {};
  let globalMuted = false;

  function channel(name) {
    if (!channels[name]) {
      const el = new Audio();
      el.preload = 'auto';
      const ch = { el, token: null, fadeTimer: null, fadeResolve: null };
      el.addEventListener('ended', () => audioBridge.event({ type: 'ended', channel: name, token: ch.token }));
      el.addEventListener('error', () => {
        if (!el.getAttribute('src')) return;
        audioBridge.event({ type: 'error', channel: name, token: ch.token, message: el.error ? `رمز الخطأ ${el.error.code}` : 'خطأ غير معروف' });
      });
      channels[name] = ch;
    }
    return channels[name];
  }

  const clamp = (v) => Math.max(0, Math.min(1, Number(v) || 0));

  function cancelFade(ch) {
    if (ch.fadeTimer) clearInterval(ch.fadeTimer);
    ch.fadeTimer = null;
    if (ch.fadeResolve) { ch.fadeResolve(); ch.fadeResolve = null; }
  }

  function fade(ch, to, ms) {
    cancelFade(ch);
    to = clamp(to);
    const from = ch.el.volume;
    if (!ms || ms <= 0 || Math.abs(from - to) < 0.001) { ch.el.volume = to; return Promise.resolve(); }
    return new Promise((resolve) => {
      const start = performance.now();
      ch.fadeResolve = resolve;
      ch.fadeTimer = setInterval(() => {
        const t = Math.min(1, (performance.now() - start) / ms);
        const s = t * t * (3 - 2 * t); // smoothstep
        ch.el.volume = clamp(from + (to - from) * s);
        if (t >= 1) cancelFade(ch);
      }, 20);
    });
  }

  function waitEvent(el, ok, bad, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { cleanup(); reject(new Error('انتهت مهلة تحميل الملف الصوتي')); }, timeoutMs);
      const onOk = () => { cleanup(); resolve(); };
      const onBad = () => { cleanup(); reject(new Error(el.error ? `تعذر تشغيل الملف (رمز ${el.error.code})` : 'تعذر تشغيل الملف')); };
      function cleanup() { clearTimeout(t); el.removeEventListener(ok, onOk); el.removeEventListener(bad, onBad); }
      el.addEventListener(ok, onOk);
      el.addEventListener(bad, onBad);
    });
  }

  const handlers = {
    async play({ channel: name, url, volume, startAt = 0, token, fadeInMs = 0 }) {
      const ch = channel(name);
      cancelFade(ch);
      ch.token = token;
      const el = ch.el;
      el.muted = globalMuted;
      el.src = url;
      await waitEvent(el, 'loadedmetadata', 'error');
      if (startAt > 0 && startAt < el.duration) el.currentTime = startAt;
      el.volume = fadeInMs > 0 ? 0 : clamp(volume);
      await el.play();
      if (fadeInMs > 0) fade(ch, volume, fadeInMs);
      return { duration: el.duration };
    },
    stop({ channel: name, fadeOutMs = 0 }) {
      const ch = channel(name);
      const doStop = () => {
        const position = ch.el.currentTime || 0;
        ch.el.pause();
        ch.el.removeAttribute('src');
        ch.el.load();
        ch.token = null;
        return { position };
      };
      if (fadeOutMs > 0 && !ch.el.paused) return fade(ch, 0, fadeOutMs).then(doStop);
      cancelFade(ch);
      return doStop();
    },
    pause({ channel: name }) { const ch = channel(name); cancelFade(ch); ch.el.pause(); return { position: ch.el.currentTime }; },
    async resume({ channel: name }) { const ch = channel(name); if (ch.el.getAttribute('src')) await ch.el.play(); return true; },
    fade({ channel: name, to, ms }) { return fade(channel(name), to, ms).then(() => true); },
    setVolume({ channel: name, volume }) { const ch = channel(name); cancelFade(ch); ch.el.volume = clamp(volume); return true; },
    seek({ channel: name, position }) { channel(name).el.currentTime = position; return true; },
    mute({ muted }) { globalMuted = !!muted; for (const ch of Object.values(channels)) ch.el.muted = globalMuted; return true; },
    status() {
      const out = {};
      for (const [n, ch] of Object.entries(channels)) {
        out[n] = { playing: !ch.el.paused && !!ch.el.getAttribute('src'), position: ch.el.currentTime || 0, duration: ch.el.duration || 0, volume: ch.el.volume, token: ch.token };
      }
      return out;
    },
    async probe({ url }) {
      const el = new Audio();
      el.preload = 'metadata';
      el.src = url;
      try {
        await waitEvent(el, 'loadedmetadata', 'error', 20000);
        return { duration: el.duration };
      } finally { el.removeAttribute('src'); el.load(); }
    },
  };

  audioBridge.onCommand(async ({ id, cmd, args }) => {
    try {
      const fn = handlers[cmd];
      if (!fn) throw new Error('أمر غير معروف: ' + cmd);
      audioBridge.reply(id, await fn(args || {}));
    } catch (e) {
      audioBridge.reply(id, null, e.message || String(e));
    }
  });

  // نبضة تقدم للقنوات العاملة (لعرض شريط التقدم في الواجهة)
  setInterval(() => {
    for (const [n, ch] of Object.entries(channels)) {
      if (!ch.el.paused && ch.el.getAttribute('src')) {
        audioBridge.event({ type: 'progress', channel: n, token: ch.token, position: ch.el.currentTime, duration: ch.el.duration });
      }
    }
  }, 1000);
})();
