'use strict';
(function () {
  const { h, icon, act, call, PRAYER_NAMES } = App;
  let root = null;
  let editing = false;

  async function render() {
    if (!root) return;
    const db = App.db;
    const preview = await call('azkar:preview', 7).catch(() => []);
    const today = preview[0];
    root.replaceChildren(
      h('div.page-head',
        h('div', h('h1', 'الأذكار'), h('p', 'وقت الذكر نسبي لمواقيت اليوم: أذكار الصباح بعد الشروق، وأذكار المساء بعد العصر — يتغير يومياً مع الجدول')),
        h('div.actions', h('button.btn', { onclick: addNew }, icon('add'), 'ذكر جديد'))),
      h('div.stack', db.azkar.map((z) => card(z, db, today))),
      weekCard(db, preview));
  }

  function card(z, db, today) {
    const it = today?.items.find((x) => x.id === z.id);
    const anchor = h('select.input', ['sunrise', 'asr', 'maghrib', 'fajr', 'dhuhr', 'isha'].map((k) => h('option', { value: k }, PRAYER_NAMES[k])));
    anchor.value = z.schedule.anchor;
    const dir = h('select.input', h('option', { value: 'after' }, 'بعد'), h('option', { value: 'before' }, 'قبل'));
    dir.value = z.schedule.direction;
    const off = h('input.input.num', { type: 'number', min: 0, max: 600, value: z.schedule.offsetMinutes });
    const en = App.toggle(z.enabled, 'مفعّل');
    const name = h('input.input', { value: z.name });
    const st = { audio: z.audio };
    const fileBox = h('div');
    const drawFile = () => fileBox.replaceChildren(h('div.row', App.fileLabel(st.audio, App.db),
      h('button.btn.sm', { onclick: async () => { const f = await act('files:pick', ['azkar']); if (f?.[0]) { st.audio = f[0].rel; App.db = await call('db:get'); drawFile(); } } }, 'تغيير'),
      st.audio ? h('button.btn.sm.ghost', { onclick: (e) => App.preview(st.audio, e.currentTarget) }, icon('play'), 'معاينة') : null));
    drawFile();
    [anchor, dir, off, name].forEach((x) => x.addEventListener('input', () => { editing = true; }));

    const computed = it ? h('div.notice', { class: it.outsideWindow ? 'warn' : 'ok' }, icon(it.outsideWindow ? 'warn' : 'ok'),
      h('div',
        h('div', 'الوقت المحسوب لهذا اليوم: ', h('strong', PRAYER_NAMES[z.schedule.anchor] + ' '), h('span.time', it.anchorTime),
          ` ${z.schedule.direction === 'before' ? '−' : '+'} ${z.schedule.offsetMinutes} دقيقة = `, h('strong.time', it.time)),
        it.outsideWindow ? h('div.small', db.settings.timeWindow.applyTo.azkar
          ? `⚠ هذا الوقت خارج ساعات العمل (${db.settings.timeWindow.start} – ${db.settings.timeWindow.end}) فسيُرفض التشغيل. يمكنك تفعيل خيار "الأذكار لا تخضع لساعات العمل" من الإعدادات.`
          : '') : null,
        ...(it.conflicts || []).map((c) => h('div.small', '⚠ ' + c)))) : null;

    return h('div.card',
      h('div.card-title', h('h2', z.name), h('div.tools', en)),
      h('div.grid.cols-4',
        App.field('الاسم', name),
        App.field('الفارق بالدقائق (يحدده المشرف)', off),
        App.field('قبل / بعد', dir),
        App.field('المرجع', anchor)),
      h('div', { style: { marginTop: '12px' } }, App.field('الملف الصوتي', fileBox)),
      h('div', { style: { marginTop: '12px' } }, computed),
      h('div.row', { style: { marginTop: '12px' } },
        h('button.btn.primary', {
          onclick: async () => {
            await act('azkar:save', [{ id: z.id, name: name.value, audio: st.audio, enabled: en.checked, schedule: { anchor: anchor.value, direction: dir.value, offsetMinutes: Number(off.value) } }], 'تم حفظ الإعدادات بنجاح');
            editing = false; App.db = await call('db:get'); render();
          },
        }, 'حفظ'),
        h('button.btn', { onclick: () => act('azkar:playNow', [z.id], 'أُضيف الذكر للتشغيل الآن') }, 'تشغيل الآن'),
        h('button.btn.ghost', { style: { marginInlineStart: 'auto' }, onclick: async () => { if (await App.confirmBox(`حذف "${z.name}"؟`, { okLabel: 'حذف', danger: true })) { await act('azkar:delete', [z.id], 'تم الحذف'); App.db = await call('db:get'); render(); } } }, icon('trash'), 'حذف')));
  }

  function weekCard(db, preview) {
    return h('div.card', { style: { marginTop: '16px' } },
      h('div.card-title', h('h2', 'الأوقات المحسوبة للأيام السبعة القادمة')),
      h('table.tbl',
        h('thead', h('tr', h('th', 'التاريخ'), db.azkar.map((z) => h('th', z.name)))),
        h('tbody', preview.map((d) => h('tr', h('td', d.date), d.items.map((it) => h('td',
          h('span.time', it.time), it.outsideWindow ? h('span.chip.warn', { style: { marginInlineStart: '6px' } }, 'خارج الساعات') : null,
          it.conflicts.length ? h('span.chip.bad', { style: { marginInlineStart: '6px' }, title: it.conflicts.join('\n') }, 'تعارض') : null)))))));
  }

  async function addNew() {
    await act('azkar:save', [{ name: 'ذكر جديد', audio: null, enabled: false, schedule: { anchor: 'sunrise', direction: 'after', offsetMinutes: 30 } }], 'أُضيف ذكر جديد — أكمل بياناته واحفظ');
    App.db = await call('db:get');
    render();
  }

  App.screens.azkar = {
    async mount(el) { root = el; editing = false; await render(); },
    unmount() { root = null; },
    onDb() { if (!editing) render(); },
  };
})();
