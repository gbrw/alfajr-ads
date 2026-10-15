'use strict';
(function () {
  const { h, icon, act, call, T } = App;
  let root = null;
  let selected = null;
  let refs = {};

  function render() {
    if (!root) return;
    const db = App.db;
    const lb = db.localBackground;
    if (!selected || !lb.reciters.find((r) => r.id === selected)) selected = lb.activeReciterId || lb.reciters[0]?.id || null;
    const rec = lb.reciters.find((r) => r.id === selected);
    const src = db.settings.background.source;
    refs = {};

    root.replaceChildren(
      h('div.page-head',
        h('div', h('h1', 'الخلفية المحلية'), h('p', 'مصدر خلفية بديل يعمل بدون إنترنت وبدون إعلانات — قوائم قرّاء وتلاوات من ملفات محلية')),
        h('div.actions',
          h('span.muted', 'المصدر الفعّال:'),
          h('button.btn', { class: src === 'browser' ? 'primary' : '', onclick: () => act('background:setSource', ['browser'], 'المصدر الفعّال: المتصفح') }, icon('browser'), 'المتصفح'),
          h('button.btn', { class: src === 'local' ? 'primary' : '', onclick: () => act('background:setSource', ['local'], 'المصدر الفعّال: المشغل المحلي') }, icon('local'), 'المشغل المحلي'))),
      !lb.reciters.some((r) => r.tracks.length) ? h('div', { style: { marginBottom: '16px' } }, App.notice('info', 'قسم القرآن في النظام القديم كان فارغاً، فلا توجد تلاوات منقولة. أضف قارئاً ثم أضف تلاواته من ملفات على الجهاز (تُنسخ إلى مكتبة البرنامج).')) : null,
      h('div.card', { style: { marginBottom: '16px' } }, refs.player = h('div')),
      h('div.grid', { style: { gridTemplateColumns: '280px 1fr' } },
        h('div.card',
          h('div.card-title', h('h2', 'القرّاء'), h('div.tools', h('button.btn.sm', { onclick: addReciter }, icon('add'), 'إضافة'))),
          h('div.nav.reciter-list', { style: { padding: 0 } }, lb.reciters.length ? lb.reciters.map((r) => h('button', { class: r.id === selected ? 'active' : '', onclick: () => { selected = r.id; render(); } },
            h('span', r.name), h('span.muted.small', { style: { marginInlineStart: 'auto' } }, String(r.tracks.length)))) : h('div.muted.small', 'لا يوجد قرّاء'))),
        h('div.card',
          rec ? [
            h('div.card-title', h('h2', rec.name), h('div.tools',
              h('button.btn.sm.primary', { onclick: () => act('local:addTracks', [rec.id]).then((n) => n && App.toast(`تمت إضافة ${n} تلاوة`)) }, icon('add'), 'إضافة تلاوات'),
              h('button.btn.sm', { onclick: () => renameReciter(rec) }, icon('edit'), 'تسمية'),
              h('button.btn.sm.ghost', { onclick: async () => { if (await App.confirmBox(`حذف القارئ "${rec.name}" وكل تلاواته من القائمة؟`, { okLabel: 'حذف', danger: true })) await act('local:deleteReciter', [rec.id], 'تم حذف القارئ'); } }, icon('trash')))),
            rec.tracks.length ? h('table.tbl', h('thead', h('tr', h('th', '#'), h('th', 'التلاوة'), h('th', 'المدة'), h('th', ''))),
              h('tbody', rec.tracks.map((t, i) => h('tr',
                h('td', String(i + 1)), h('td', t.title, db.fileExists[t.file] === false ? h('span.chip.bad', { style: { marginInlineStart: '6px' } }, 'الملف غير موجود') : null),
                h('td.time', db.audioMeta[t.file]?.duration ? T.formatDuration(db.audioMeta[t.file].duration) : '—'),
                h('td', h('div.row', { style: { justifyContent: 'flex-end' } },
                  h('button.btn.sm', { onclick: () => act('local:control', ['play', rec.id, i]) }, icon('play'), 'تشغيل'),
                  h('button.btn.sm.ghost', { onclick: () => act('local:removeTrack', [rec.id, t.id]) }, icon('trash')))))))) : h('div.empty', 'لا توجد تلاوات — اضغط "إضافة تلاوات" لاختيار ملفات متعددة'),
          ] : h('div.empty', 'أضف قارئاً للبدء'))));
    if (App.state) drawPlayer(App.state);
  }

  function drawPlayer(s) {
    if (!refs.player) return;
    const L = s.local || {};
    const shuffle = App.db.localBackground.shuffle;
    const playing = L.status === 'playing';
    const pct = L.duration ? (L.position / L.duration) * 100 : 0;
    refs.player.replaceChildren(
      h('div.row',
        h('button.btn.icon', { title: 'السابق', onclick: () => act('local:control', ['prev']) }, icon('prev')),
        playing ? h('button.btn.big.primary', { onclick: () => act('local:control', ['pause']) }, icon('pause'), 'إيقاف مؤقت')
          : h('button.btn.big.primary', { onclick: () => act('local:control', [L.status === 'paused' ? 'resume' : 'play', selected]) }, icon('play'), 'تشغيل'),
        h('button.btn.icon', { title: 'إيقاف', onclick: () => act('local:control', ['stop']) }, icon('stop')),
        h('button.btn.icon', { title: 'التالي', onclick: () => act('local:control', ['next']) }, icon('next')),
        h('button.btn', { class: shuffle ? 'on' : '', onclick: () => act('local:control', ['shuffle', !shuffle]) }, icon('shuffle'), shuffle ? 'خلط عشوائي: مفعّل' : 'خلط عشوائي'),
        h('div', { style: { flex: 1, minWidth: '200px' } },
          h('div', h('strong', L.trackTitle || 'لا يوجد تشغيل'), L.reciterName ? h('span.muted', ` — ${L.reciterName}`) : null),
          h('div.progress', { style: { marginTop: '6px' } }, h('i', { style: { width: pct + '%' } })),
          h('div.small.muted.time', L.duration ? `${T.formatDuration(L.position)} / ${T.formatDuration(L.duration)}` : '')),
        s.background?.outsideWindow ? h('span.chip.warn', 'خارج ساعات العمل') : null,
        s.background?.duck < 1 ? h('span.chip.warn', 'منخفض أثناء الأذان/الإعلان') : null));
  }

  function addReciter() {
    const name = h('input.input', { placeholder: 'اسم القارئ' });
    App.modal({
      title: 'إضافة قارئ', body: App.field('الاسم', name),
      actions: [{ label: 'إضافة', kind: 'primary', onClick: async () => { if (!name.value.trim()) return false; selected = await act('local:addReciter', [name.value], 'تمت الإضافة'); return true; } }, { label: 'إلغاء', kind: 'ghost' }],
    });
    setTimeout(() => name.focus(), 50);
  }

  function renameReciter(rec) {
    const name = h('input.input', { value: rec.name });
    App.modal({
      title: 'تسمية القارئ', body: App.field('الاسم', name),
      actions: [{ label: 'حفظ', kind: 'primary', onClick: () => act('local:renameReciter', [rec.id, name.value], 'تم الحفظ') }, { label: 'إلغاء', kind: 'ghost' }],
    });
  }

  App.screens.local = {
    mount(el) { root = el; render(); },
    unmount() { root = null; refs = {}; },
    onDb() { render(); },
    onState(s) { drawPlayer(s); },
  };
})();
