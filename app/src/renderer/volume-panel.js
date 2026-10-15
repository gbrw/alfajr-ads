'use strict';
/*
 * لوحة التحكم بالأصوات: مستوى عام + مستوى مستقل لكل نوع، مع كتم مستقل.
 * كل تغيير يُرسل فوراً للعملية الرئيسية فينعكس على الصوت الجاري ويُحفظ تلقائياً (بلا زر حفظ).
 * الترتيب المعروض = ترتيب أولوية التشغيل.
 */
(function () {
  const { h, icon, call, toast } = App;

  const ROWS = [
    ['master', 'المستوى العام', 'يتحكم بجميع الأصوات'],
    ['ads', 'الإعلانات', 'الأولوية 1 (الأعلى)'],
    ['adhan', 'الأذان', 'الأولوية 2'],
    ['preadhan', 'التنبيه قبل الأذان', 'الأولوية 3'],
    ['azkar', 'الأذكار', 'الأولوية 4'],
    ['background', 'صوت المتصفح', 'الأولوية 5 — يتوقف مؤقتاً أثناء أي صوت أعلى'],
  ];
  const TYPE_CLASS = { ad: 'ads', adhan: 'adhan', preadhan: 'preadhan', azkar: 'azkar' };

  App.volumePanel = function volumePanel({ title = true } = {}) {
    const rows = {};
    const pending = {};
    let sendTimer = null;

    // إرسال أحدث قيمة كل 60ms أثناء السحب (لا تتراكم الطلبات)
    const flush = () => {
      sendTimer = null;
      for (const [cls, v] of Object.entries(pending)) {
        delete pending[cls];
        call('volume:set', cls, v).catch((e) => toast(e.message, 'error'));
      }
    };

    for (const [cls, label, hint] of ROWS) {
      const val = h('span.vp-val');
      const range = h('input', { type: 'range', min: 0, max: 100, step: 1, 'aria-label': 'مستوى ' + label });
      const muteBtn = h('button.btn.icon.sm.vp-mute', { type: 'button' });
      const live = h('span.chip.info.vp-live', 'يعمل الآن');
      const row = h('div.vp-row', { class: cls === 'master' ? 'master' : '' },
        muteBtn,
        h('div.vp-label', h('span', label), live, h('span.vp-hint', hint)),
        range, val);
      const r = rows[cls] = { row, range, val, muteBtn, live, dragging: false, muted: false };
      range.addEventListener('pointerdown', () => { r.dragging = true; });
      range.addEventListener('pointerup', () => { r.dragging = false; });
      range.addEventListener('blur', () => { r.dragging = false; });
      range.addEventListener('input', () => {
        val.textContent = range.value + '%';
        pending[cls] = Number(range.value) / 100;
        if (!sendTimer) sendTimer = setTimeout(flush, 60);
      });
      muteBtn.addEventListener('click', () => {
        r.muted = !r.muted;
        paintMute(r, cls);
        call('volume:mute', cls, r.muted).catch((e) => { toast(e.message, 'error'); r.muted = !r.muted; paintMute(r, cls); });
      });
    }

    function paintMute(r, cls) {
      r.row.classList.toggle('is-muted', r.muted);
      r.muteBtn.replaceChildren(icon(r.muted ? 'mute' : 'volume'));
      r.muteBtn.title = (r.muted ? 'إلغاء كتم ' : 'كتم ') + ROWS.find((x) => x[0] === cls)[1];
      r.muteBtn.classList.toggle('on', r.muted);
    }

    const order = h('div.vp-order', 'أولوية التشغيل: ',
      h('strong', 'الإعلانات'), ' ← الأذان ← التنبيه قبل الأذان ← الأذكار ← صوت المتصفح');
    const el = h('div.vp',
      title ? h('div.vp-head', icon('volume'), h('strong', 'التحكم بالأصوات'), h('span.muted.small', 'يُطبَّق فوراً ويُحفظ تلقائياً')) : null,
      ROWS.map(([cls]) => rows[cls].row),
      order);

    function update(s) {
      const a = s && s.audio;
      if (!a) return;
      const masterMuted = !!a.mute.master;
      const cur = s.playback && s.playback.current && s.playback.phase === 'playing' ? TYPE_CLASS[s.playback.current.type] : null;
      const bg = s.background || {};
      const bgLive = !cur && !!bg.playing && !bg.pausedByDuck && bg.duck >= 1 && bg.effectiveSource === 'browser';
      for (const [cls] of ROWS) {
        const r = rows[cls];
        const level = Math.round((a.volume[cls] ?? 1) * 100);
        if (!r.dragging && !(cls in pending) && Number(r.range.value) !== level) { r.range.value = level; }
        if (!r.dragging && !(cls in pending)) r.val.textContent = r.range.value + '%';
        r.muted = !!a.mute[cls];
        paintMute(r, cls);
        r.row.classList.toggle('dimmed', cls !== 'master' && masterMuted);
        r.live.hidden = !(cls === cur || (cls === 'background' && bgLive));
      }
    }

    return { el, update };
  };
})();
