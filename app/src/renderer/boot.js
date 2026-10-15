'use strict';
/* الإقلاع: القائمة الجانبية، الشريط العلوي، التنقل بين الشاشات، وبث الحالة. */
(function () {
  const { h, icon, call, act, T } = App;
  const ORDER = [
    ['dashboard', 'لوحة التحكم'], ['browser', 'المتصفح'], ['prayers', 'المواقيت والأذان'], ['ads', 'الإعلانات'],
    ['azkar', 'الأذكار'], ['local', 'الخلفية المحلية'], ['extensions', 'الإضافات'], ['logs', 'السجلات'], ['settings', 'الإعدادات'],
  ];
  const view = document.getElementById('view');
  const nav = document.getElementById('nav');
  const navButtons = {};
  let errorsSinceVisit = 0;

  for (const [key, label] of ORDER) {
    const b = h('button', { onclick: () => go(key) }, icon(key), h('span', label));
    navButtons[key] = b;
    nav.append(b);
  }

  async function loadDb() {
    App.db = await call('db:get');
    return App.db;
  }

  async function go(key) {
    if (App.current === key && view.childElementCount) return;
    const prev = App.screens[App.current];
    if (prev && prev.unmount) prev.unmount();
    App.stopPreview();
    App.current = key;
    try { localStorage.setItem('screen', key); } catch { /* ignore */ }
    Object.entries(navButtons).forEach(([k, b]) => b.classList.toggle('active', k === key));
    const sc = App.screens[key];
    view.replaceChildren();
    view.scrollTop = 0;
    view.classList.toggle('flush', !!sc.flush);
    if (key === 'logs') { errorsSinceVisit = 0; renderBadge(); }
    if (key !== 'browser') call('browser:hide').catch(() => {});
    await loadDb().catch(() => {});
    await sc.mount(view);
    if (App.state && sc.onState) sc.onState(App.state);
  }
  App.go = go;

  App.syncBrowserVisibility = () => {
    const sc = App.screens[App.current];
    if (App.current === 'browser' && sc && sc.layout) {
      if (App.modalOpen > 0) call('browser:hide').catch(() => {});
      else sc.layout();
    }
  };

  // ── الشريط العلوي ──
  const hdrClock = document.getElementById('hdr-clock');
  const hdrDate = document.getElementById('hdr-date');
  const hdrStatus = document.getElementById('hdr-status');
  const hdrNext = document.getElementById('hdr-next');
  const hdrNet = document.getElementById('hdr-net');
  const btnMute = document.getElementById('btn-mute');
  const btnEm = document.getElementById('btn-emergency');

  btnEm.addEventListener('click', async () => {
    if (App.state?.status === 'stopped') await act('control:resume', [], 'تم استئناف التشغيل');
    else await act('control:emergency', [], 'تم الإيقاف الطارئ — كل الأصوات متوقفة');
  });
  btnMute.addEventListener('click', () => act('control:mute', [!App.state?.playback?.muted]));

  function renderHeader(s) {
    hdrClock.textContent = s.clock;
    hdrDate.textContent = App.arabicDate(s.now);
    const stopped = s.status === 'stopped';
    hdrStatus.className = 'chip big ' + (stopped ? 'bad' : 'ok');
    hdrStatus.lastChild.textContent = stopped ? 'متوقف (إيقاف طارئ)' : 'يعمل بشكل طبيعي';
    btnEm.replaceChildren(icon(stopped ? 'play' : 'stop'), stopped ? 'استئناف التشغيل' : 'إيقاف طارئ');
    btnEm.className = 'btn ' + (stopped ? 'primary' : 'danger');
    const muted = !!s.playback?.muted;
    btnMute.replaceChildren(icon(muted ? 'mute' : 'volume'), muted ? 'إلغاء الكتم' : 'كتم');
    btnMute.classList.toggle('on', muted);
    const n = s.next;
    hdrNext.querySelector('.lbl').textContent = window.bidi(n ? `${n.label} — ${n.dayLabel} ${n.time}` : 'لا توجد أحداث قادمة');
    hdrNext.querySelector('.cd').textContent = n ? T.formatCountdown(n.secondsLeft) : '';
    hdrNet.className = 'chip ' + (s.online === false ? 'bad' : s.online ? 'ok' : '');
    hdrNet.replaceChildren(h('span.dot'), s.online === false ? 'غير متصل' : s.online ? 'متصل' : '…');
  }

  function renderBadge() {
    const b = navButtons.logs;
    b.querySelector('.badge')?.remove();
    if (errorsSinceVisit > 0) b.append(h('span.badge', String(errorsSinceVisit)));
  }

  window.api.on('state', (s) => {
    App.state = s;
    renderHeader(s);
    const sc = App.screens[App.current];
    if (sc && sc.onState) sc.onState(s);
  });
  window.api.on('log', (e) => {
    if (e.level === 'error' && App.current !== 'logs') { errorsSinceVisit++; renderBadge(); }
    const sc = App.screens[App.current];
    if (sc && sc.onLog) sc.onLog(e);
  });
  window.api.on('logs-cleared', () => { const sc = App.screens[App.current]; if (sc && sc.onLogsCleared) sc.onLogsCleared(); });
  window.api.on('alert', (a) => App.toast(a.message, a.level === 'error' ? 'error' : 'warn', 8000));
  window.api.on('db-changed', async () => {
    await loadDb().catch(() => {});
    const sc = App.screens[App.current];
    if (sc && sc.onDb) sc.onDb(App.db);
  });
  window.api.on('ext-changed', () => { const sc = App.screens[App.current]; if (sc && sc.onExt) sc.onExt(); });

  // ── البدء ──
  (async () => {
    const info = await call('app:info').catch(() => null);
    if (info) document.getElementById('side-foot').textContent = `الإصدار ${info.version} • المدينة: الرمادي`;
    let start = 'dashboard';
    try { start = localStorage.getItem('screen') || 'dashboard'; } catch { /* ignore */ }
    if (!App.screens[start]) start = 'dashboard';
    await go(start);
    App.state = await call('state:get').catch(() => null);
    if (App.state) { renderHeader(App.state); App.screens[App.current]?.onState?.(App.state); }
  })();
})();
