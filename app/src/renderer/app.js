'use strict';
/* أدوات الواجهة المشتركة: بناء العناصر، الأيقونات، النوافذ المنبثقة، التنبيهات، حقل الوقت 12 ساعة. */
window.__errs = [];
window.addEventListener('error', (e) => window.__errs.push(String(e.message) + ' @' + (e.filename || '') + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => window.__errs.push('rejection: ' + String(e.reason && (e.reason.stack || e.reason.message) || e.reason)));

// تجاهل null/false عند إضافة العناصر (replaceChildren يحوّلها إلى نص "null")
for (const m of ['replaceChildren', 'append', 'prepend']) {
  const orig = Element.prototype[m];
  Element.prototype[m] = function (...nodes) { return orig.apply(this, nodes.flat().filter((n) => n != null && n !== false)); };
}

/* الأوقات بعد نص عربي تُعرض معكوسة ("PM 11:40") بسبب قاعدة الأرقام في خوارزمية الاتجاه؛ نعزلها باتجاه LTR. */
const TIME_RE = /\d{1,2}:\d{2}(?::\d{2})?\s?[AP]M/g;
window.bidi = (s) => String(s).replace(TIME_RE, (m) => '⁦' + m + '⁩');

(function () {
  const T = window.Time12;

  /** h('div.card#id', {attrs/on*}, ...children) */
  function h(tag, props, ...children) {
    const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(tag) || [];
    const el = document.createElement(m[1] || 'div');
    (m[2] || '').replace(/([.#])([\w-]+)/g, (_, t, v) => { if (t === '.') el.classList.add(v); else el.id = v; });
    if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) { children.unshift(props); props = null; }
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'class') el.className += ' ' + v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    const add = (c) => {
      if (c == null || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else el.append(c instanceof Node ? c : document.createTextNode(window.bidi(c)));
    };
    children.forEach(add);
    return el;
  }

  const ICONS = {
    dashboard: '<path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/>',
    browser: '<path d="M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zm0 4v10h16V8H4zm1-3a1 1 0 100 2 1 1 0 000-2zm3 0a1 1 0 100 2 1 1 0 000-2z"/>',
    prayers: '<path d="M12 2c-.5 2.5-3 3.5-3 6.5 0 1.3.6 2.3 1.5 3V22h3V11.5c.9-.7 1.5-1.7 1.5-3C15 5.5 12.5 4.5 12 2zM5 12h3v10H5zm11 0h3v10h-3z"/>',
    ads: '<path d="M3 10v4a1 1 0 001 1h2l4 4V5L6 9H4a1 1 0 00-1 1zm13.5 2A4.5 4.5 0 0014 7.97v8.05A4.5 4.5 0 0016.5 12zM14 3.23v2.06a7 7 0 010 13.42v2.06A9 9 0 0014 3.23z"/>',
    azkar: '<path d="M12 3a9 9 0 109 9 7 7 0 01-9-9z"/>',
    local: '<path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z"/>',
    extensions: '<path d="M20.5 11H19V7a2 2 0 00-2-2h-4V3.5a2.5 2.5 0 00-5 0V5H4a2 2 0 00-2 2v3.8h1.5a2.7 2.7 0 010 5.4H2V20a2 2 0 002 2h3.8v-1.5a2.7 2.7 0 015.4 0V22H17a2 2 0 002-2v-4h1.5a2.5 2.5 0 000-5z"/>',
    logs: '<path d="M4 4h16v2H4zm0 5h16v2H4zm0 5h10v2H4zm0 5h10v2H4z"/>',
    settings: '<path d="M19.4 13a7.6 7.6 0 000-2l2.1-1.6-2-3.5-2.5 1a7 7 0 00-1.7-1L15 3h-4l-.3 2.9a7 7 0 00-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 000 2l-2.1 1.6 2 3.5 2.5-1a7 7 0 001.7 1L11 21h4l.3-2.9a7 7 0 001.7-1l2.5 1 2-3.5L19.4 13zM13 15.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7z"/>',
    stop: '<path d="M6 6h12v12H6z"/>',
    play: '<path d="M8 5v14l11-7z"/>',
    pause: '<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>',
    next: '<path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>',
    prev: '<path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>',
    shuffle: '<path d="M10.6 9.2L5.4 4 4 5.4l5.2 5.2 1.4-1.4zM14.5 4l2 2L4 18.6 5.4 20 18 7.5l2 2V4h-5.5zm.3 9.4l-1.4 1.4 3.1 3.1L14.5 20H20v-5.5l-2 2-3.2-3.1z"/>',
    mute: '<path d="M16.5 12A4.5 4.5 0 0014 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zM19 12c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>',
    volume: '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 7.97v8.05A4.5 4.5 0 0016.5 12zM14 3.23v2.06a7 7 0 010 13.42v2.06A9 9 0 0014 3.23z"/>',
    back: '<path d="M8.6 16.6L13.2 12 8.6 7.4 10 6l6 6-6 6z"/>',
    forward: '<path d="M15.4 16.6L10.8 12l4.6-4.6L14 6l-6 6 6 6z"/>',
    reload: '<path d="M17.65 6.35A7.96 7.96 0 0012 4a8 8 0 108 8h-2a6 6 0 11-1.76-4.24L13 11h7V4l-2.35 2.35z"/>',
    home: '<path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>',
    add: '<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>',
    edit: '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>',
    trash: '<path d="M6 19a2 2 0 002 2h8a2 2 0 002-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>',
    file: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 7V3.5L18.5 9H13z"/>',
    warn: '<path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>',
    info: '<path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>',
    ok: '<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>',
    lock: '<path d="M18 8h-1V6A5 5 0 007 6v2H6a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V10a2 2 0 00-2-2zm-6 9a2 2 0 110-4 2 2 0 010 4zm3.1-9H8.9V6a3.1 3.1 0 016.2 0v2z"/>',
    download: '<path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>',
    upload: '<path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/>',
    search: '<path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>',
    folder: '<path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z"/>',
    shield: '<path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/>',
  };
  function icon(name) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'currentColor');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = ICONS[name] || '';
    return s;
  }

  async function call(channel, ...args) {
    const r = await window.api.invoke(channel, ...args);
    if (!r || !r.ok) {
      const err = new Error((r && r.error) || 'خطأ غير معروف');
      err.code = r && r.code;
      throw err;
    }
    return r.data;
  }

  /** استدعاء مع رسالة نجاح/خطأ بالعربية. */
  async function act(channel, args = [], okMsg) {
    try {
      const d = await call(channel, ...args);
      if (okMsg) toast(okMsg);
      return d;
    } catch (e) {
      if (e.code === 'LOCKED') { toast('هذا الإجراء محمي بكلمة مرور المشرف — افتح القفل من الإعدادات', 'warn'); App.go('settings'); }
      else toast(e.message, 'error');
      throw e;
    }
  }

  function toast(msg, kind = 'ok', ms = 4200) {
    const t = h('div.toast', { class: kind }, msg);
    document.getElementById('toasts').append(t);
    setTimeout(() => t.remove(), ms);
  }

  function modal({ title, body, actions = [], wide = false, onClose }) {
    const close = () => { back.remove(); App.modalOpen--; App.syncBrowserVisibility(); onClose && onClose(); };
    const foot = h('div.modal-foot');
    for (const a of actions) {
      foot.append(h('button.btn', { class: a.kind || '', onclick: async () => { if (a.onClick) { const r = await a.onClick(); if (r === false) return; } close(); } }, a.label));
    }
    const back = h('div.modal-back', h('div.modal', { class: wide ? 'wide' : '' },
      h('div.modal-head', h('h2', title), h('div', { style: { marginInlineStart: 'auto' } }, h('button.btn.ghost.icon', { onclick: close, title: 'إغلاق' }, '✕'))),
      h('div.modal-body', body),
      actions.length ? foot : null));
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    document.body.append(back);
    App.modalOpen++;
    App.syncBrowserVisibility();
    return { close };
  }

  function confirmBox(message, { okLabel = 'تأكيد', danger = false } = {}) {
    return new Promise((resolve) => {
      let done = false;
      modal({
        title: 'تأكيد', body: h('p', { style: { margin: 0 } }, message),
        actions: [
          { label: okLabel, kind: danger ? 'danger' : 'primary', onClick: () => { done = true; resolve(true); } },
          { label: 'إلغاء', kind: 'ghost' },
        ],
        onClose: () => { if (!done) resolve(false); },
      });
    });
  }

  /** حقل وقت بنظام 12 ساعة فقط: ساعة (1–12) : دقيقة : AM/PM */
  function timeInput(value = '12:00 PM', { onChange } = {}) {
    let sec = 12 * 3600;
    try { sec = T.parse12(value); } catch { /* افتراضي */ }
    const h24 = Math.floor(sec / 3600);
    const hh = h('select', { 'aria-label': 'الساعة' }, [...Array(12)].map((_, i) => h('option', { value: i + 1 }, T.pad(i + 1))));
    const mm = h('select', { 'aria-label': 'الدقيقة' }, [...Array(60)].map((_, i) => h('option', { value: i }, T.pad(i))));
    const ap = h('select', { 'aria-label': 'صباحاً/مساءً' }, h('option', { value: 'AM' }, 'AM'), h('option', { value: 'PM' }, 'PM'));
    hh.value = String(h24 % 12 === 0 ? 12 : h24 % 12);
    mm.value = String(Math.floor((sec % 3600) / 60));
    ap.value = h24 >= 12 ? 'PM' : 'AM';
    const wrap = h('span.time12', hh, h('span.colon', ':'), mm, ap);
    Object.defineProperty(wrap, 'value', {
      get: () => `${T.pad(Number(hh.value))}:${T.pad(Number(mm.value))} ${ap.value}`,
      set: (v) => { const s = T.parse12(v); const x = Math.floor(s / 3600); hh.value = String(x % 12 === 0 ? 12 : x % 12); mm.value = String(Math.floor((s % 3600) / 60)); ap.value = x >= 12 ? 'PM' : 'AM'; },
    });
    if (onChange) [hh, mm, ap].forEach((s) => s.addEventListener('change', () => onChange(wrap.value)));
    return wrap;
  }

  function toggle(checked, label, onChange) {
    const inp = h('input', { type: 'checkbox', checked: !!checked });
    if (onChange) inp.addEventListener('change', () => onChange(inp.checked));
    const el = h('label.switch', inp, label ? h('span', label) : null);
    Object.defineProperty(el, 'checked', { get: () => inp.checked, set: (v) => { inp.checked = !!v; } });
    return el;
  }

  function field(label, control, hint) {
    return h('label.field', h('span', label), control, hint ? h('span.hint', hint) : null);
  }

  function notice(kind, text) {
    return h('div.notice', { class: kind }, icon(kind === 'ok' ? 'ok' : kind === 'info' ? 'info' : 'warn'), h('div', text));
  }

  /** مشغّل معاينة داخل الواجهة (لا يمر بالمجدول ولا يخفض الخلفية). */
  let previewAudio = null;
  async function preview(rel, btn) {
    if (previewAudio) {
      const same = previewAudio.dataset.rel === rel;
      previewAudio.pause(); previewAudio = null;
      document.querySelectorAll('[data-previewing]').forEach((b) => { b.removeAttribute('data-previewing'); b.replaceChildren(icon('play'), 'معاينة'); });
      if (same) return;
    }
    if (!rel) { toast('لم يُحدَّد ملف صوتي', 'warn'); return; }
    const url = await call('files:url', rel).catch(() => null);
    if (!url) { toast('الملف الصوتي غير موجود', 'error'); return; }
    previewAudio = new Audio(url);
    previewAudio.dataset.rel = rel;
    previewAudio.volume = 0.8;
    previewAudio.play().catch((e) => toast('تعذر التشغيل: ' + e.message, 'error'));
    if (btn) { btn.setAttribute('data-previewing', ''); btn.replaceChildren(icon('stop'), 'إيقاف'); }
    previewAudio.addEventListener('ended', () => { if (btn) { btn.removeAttribute('data-previewing'); btn.replaceChildren(icon('play'), 'معاينة'); } previewAudio = null; });
  }
  function stopPreview() { if (previewAudio) { previewAudio.pause(); previewAudio = null; } }

  function fileLabel(rel, db) {
    if (!rel) return h('span.chip.warn', 'لم يُحدَّد ملف');
    const name = rel.split('/').pop();
    const exists = db?.fileExists?.[rel] !== false;
    const dur = db?.audioMeta?.[rel]?.duration;
    return h('span.row', { style: { gap: '6px' } },
      h('span.chip', { class: exists ? '' : 'bad', title: rel }, icon('file'), name),
      dur ? h('span.muted.small.time', T.formatDuration(dur)) : null,
      exists ? null : h('span.chip.bad', 'الملف الصوتي غير موجود'));
  }

  const TYPE_NAMES = { adhan: 'أذان', preadhan: 'تنبيه', azkar: 'ذكر', ad: 'إعلان' };
  const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const PRAYER_NAMES = { fajr: 'الفجر', sunrise: 'الشروق', dhuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء' };

  function arabicDate(ms) {
    const d = new Date(ms);
    const g = d.toLocaleDateString('ar-IQ-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    let hij = '';
    try { hij = d.toLocaleDateString('ar-SA-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { /* ignore */ }
    return hij ? `${g} — ${hij}` : g;
  }

  window.App = {
    h, icon, call, act, toast, modal, confirmBox, timeInput, toggle, field, notice, preview, stopPreview, fileLabel, arabicDate,
    TYPE_NAMES, WEEKDAYS, PRAYER_NAMES, T,
    screens: {}, current: null, state: null, db: null, modalOpen: 0,
    syncBrowserVisibility() { /* يُعرَّف في boot.js */ },
    go() { /* يُعرَّف في boot.js */ },
  };
})();
