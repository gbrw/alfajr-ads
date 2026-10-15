'use strict';
(function () {
  const { h, icon, act, T, WEEKDAYS } = App;
  let root = null;

  function weekdaysText(w) {
    if (!w || w.length === 7) return 'كل الأيام';
    return w.map((d) => WEEKDAYS[d]).join('، ');
  }

  function render() {
    if (!root) return;
    const db = App.db;
    const ads = [...db.ads].sort((a, b) => T.parse12(a.playTime) - T.parse12(b.playTime));
    root.replaceChildren(
      h('div.page-head',
        h('div', h('h1', 'الإعلانات'), h('p', 'إعلانات ترويجية مجدولة مع التكرار والفاصل — الإعلان الطارئ يأتي بعد الأذان مباشرة في الأولوية')),
        h('div.actions', h('button.btn.primary', { onclick: () => edit(null) }, icon('add'), 'إعلان جديد'))),
      ads.length ? h('div', ads.map((a) => item(a, db))) : h('div.card.empty', 'لا توجد إعلانات بعد'));
  }

  function item(a, db) {
    const dur = db.audioMeta[a.audio]?.duration;
    const total = a.repeatCount > 1 && dur ? dur * a.repeatCount + a.repeatIntervalSeconds * (a.repeatCount - 1) : null;
    const en = App.toggle(a.enabled, null, (v) => act('ads:save', [{ ...a, enabled: v }], v ? 'تم تفعيل الإعلان' : 'تم إيقاف الإعلان'));
    return h('div.list-item',
      en,
      h('div.grow',
        h('div.row', h('span.title', a.name), a.priority === 'emergency' ? h('span.chip.bad', 'طارئ') : h('span.chip', 'اعتيادي'),
          a.enabled ? null : h('span.chip', 'موقوف')),
        h('div.row.small.muted', { style: { marginTop: '4px' } },
          h('span', 'الساعة ', h('strong.time', a.playTime)),
          h('span', `• ${a.repeatCount} ${a.repeatCount > 1 ? 'مرات' : 'مرة'}`),
          a.repeatCount > 1 ? h('span', `• فاصل ${a.repeatIntervalSeconds} ثانية (${T.formatDuration(a.repeatIntervalSeconds)})`) : null,
          h('span', '• ' + weekdaysText(a.weekdays)),
          a.startDate || a.endDate ? h('span', `• من ${a.startDate || '…'} إلى ${a.endDate || '…'}`) : null,
          total ? h('span', `• المدة الكلية ≈ ${T.formatDuration(total)}`) : null),
        h('div', { style: { marginTop: '6px' } }, App.fileLabel(a.audio, db))),
      h('button.btn.sm.ghost', { onclick: (e) => App.preview(a.audio, e.currentTarget) }, icon('play'), 'معاينة'),
      h('button.btn.sm', { title: 'تشغيل الآن عبر المجدول (مع خفض الخلفية)', onclick: () => act('ads:playNow', [a.id], 'أُضيف الإعلان للتشغيل الآن') }, 'تشغيل الآن'),
      h('button.btn.sm', { onclick: () => edit(a) }, icon('edit'), 'تعديل'),
      h('button.btn.sm.ghost', { onclick: async () => { if (await App.confirmBox(`حذف الإعلان "${a.name}"؟`, { okLabel: 'حذف', danger: true })) await act('ads:delete', [a.id], 'تم حذف الإعلان'); } }, icon('trash')));
  }

  function edit(ad) {
    const db = App.db;
    const a = ad ? { ...ad } : { name: '', audio: null, playTime: '10:00 AM', repeatCount: 1, repeatIntervalSeconds: 60, enabled: true, priority: 'normal', startDate: null, endDate: null, weekdays: [0, 1, 2, 3, 4, 5, 6] };
    const name = h('input.input', { value: a.name, placeholder: 'مثال: عروض نهاية الأسبوع' });
    const time = App.timeInput(a.playTime);
    const rc = h('input.input.num', { type: 'number', min: 1, max: 50, value: a.repeatCount });
    const ri = h('input.input.num', { type: 'number', min: 0, max: 86400, value: a.repeatIntervalSeconds });
    const pr = h('select.input', h('option', { value: 'normal' }, 'اعتيادي'), h('option', { value: 'emergency' }, 'طارئ (أولوية أعلى)'));
    pr.value = a.priority;
    const sd = h('input.input', { type: 'date', value: a.startDate || '' });
    const ed = h('input.input', { type: 'date', value: a.endDate || '' });
    const wd = h('div.weekdays', WEEKDAYS.map((n, i) => h('label', h('input', { type: 'checkbox', checked: a.weekdays.includes(i), value: i }), h('span', n))));
    const en = App.toggle(a.enabled, 'مفعّل');
    const fileBox = h('div');
    const drawFile = () => fileBox.replaceChildren(h('div.row', App.fileLabel(a.audio, App.db),
      h('button.btn.sm', { onclick: async () => { const f = await act('files:pick', ['ads']); if (f?.[0]) { a.audio = f[0].rel; App.db = await App.call('db:get'); drawFile(); } } }, icon('folder'), a.audio ? 'تغيير الملف' : 'اختيار ملف'),
      a.audio ? h('button.btn.sm.ghost', { onclick: (e) => App.preview(a.audio, e.currentTarget) }, icon('play'), 'معاينة') : null));
    drawFile();
    const summary = h('div.notice.info');
    const updSummary = () => {
      const dur = App.db.audioMeta[a.audio]?.duration || 0;
      const n = Number(rc.value) || 1;
      const gap = Number(ri.value) || 0;
      let t = T.parse12(time.value);
      const times = [];
      for (let i = 0; i < Math.min(n, 12); i++) { times.push(T.format12(t)); t += Math.round(dur) + gap + 4; }
      summary.replaceChildren(icon('info'), h('div', `مواعيد التشغيل المتوقعة: ${times.join(' ، ')}${n > 12 ? ' …' : ''}`, h('div.hint', 'الفاصل يُحسب بعد انتهاء كل تكرار (+ ثانيتان صمت قبل وبعد). عند تزامن أحداث ذات أولوية أعلى يُؤجَّل الإعلان ثم يُشغَّل بعدها مباشرة.')));
    };
    [rc, ri].forEach((x) => x.addEventListener('input', updSummary));
    time.addEventListener('change', updSummary);
    updSummary();

    App.modal({
      title: ad ? 'تعديل إعلان' : 'إعلان جديد', wide: true,
      body: h('div.stack',
        h('div.grid.cols-2', App.field('اسم الإعلان', name), App.field('الملف الصوتي', fileBox)),
        h('div.grid.cols-4', App.field('وقت التشغيل', time), App.field('عدد التكرار', rc), App.field('الفاصل بالثواني', ri), App.field('الأولوية', pr)),
        h('div.grid.cols-2', App.field('تاريخ البداية (اختياري)', sd), App.field('تاريخ النهاية (اختياري)', ed)),
        App.field('أيام الأسبوع', wd),
        en, summary),
      actions: [
        {
          label: 'حفظ', kind: 'primary', onClick: async () => {
            const weekdays = [...wd.querySelectorAll('input:checked')].map((x) => Number(x.value));
            if (!weekdays.length) { App.toast('اختر يوماً واحداً على الأقل', 'warn'); return false; }
            try {
              await act('ads:save', [{ ...a, name: name.value, playTime: time.value, repeatCount: Number(rc.value), repeatIntervalSeconds: Number(ri.value), priority: pr.value, startDate: sd.value || null, endDate: ed.value || null, weekdays, enabled: en.checked }], 'تم حفظ الإعلان بنجاح');
            } catch { return false; }
            return true;
          },
        },
        { label: 'إلغاء', kind: 'ghost' },
      ],
    });
  }

  App.screens.ads = {
    mount(el) { root = el; render(); },
    unmount() { root = null; },
    onDb() { render(); },
  };
})();
