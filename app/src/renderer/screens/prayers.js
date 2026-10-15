'use strict';
(function () {
  const { h, icon, call, act, T, PRAYER_NAMES } = App;
  const KEYS = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
  let root = null;
  let month = new Date().getMonth() + 1;

  async function refresh() { App.db = await call('db:get'); await render(); }

  async function render() {
    if (!root) return;
    const db = App.db;
    const tbl = await call('prayers:table');
    const today = App.state ? new Date(App.state.now) : new Date();
    root.replaceChildren(
      h('div.page-head',
        h('div', h('h1', 'المواقيت والأذان'), h('p', `جدول السنة كاملاً للمدينة: ${db.settings.city} — كل الأوقات بنظام 12 ساعة`)),
        h('div.actions', h('button.btn.primary', { onclick: importFlow }, icon('upload'), 'استيراد من Excel'))),
      adhanCard(db),
      h('div.grid.cols-2', { style: { marginTop: '16px' } }, offsetsCard(tbl), sourceCard(tbl)),
      tableCard(tbl, today));
  }

  function adhanCard(db) {
    const rows = db.prayers.map((p) => {
      const en = App.toggle(p.enabled);
      const preEn = App.toggle(p.preAdhan.enabled);
      const mins = h('input.input.num', { type: 'number', min: 1, max: 60, value: p.preAdhan.minutesBefore });
      const st = { audio: p.audio, pre: p.preAdhan.audio };
      const audioCell = h('div');
      const preCell = h('div');
      const draw = () => {
        audioCell.replaceChildren(h('div.row', App.fileLabel(st.audio, db),
          h('button.btn.sm', { onclick: async () => { const f = await act('files:pick', ['adhan']); if (f?.[0]) { st.audio = f[0].rel; await save(); await refresh(); } } }, 'تغيير'),
          h('button.btn.sm.ghost', { onclick: (e) => App.preview(st.audio, e.currentTarget) }, icon('play'), 'معاينة')));
        preCell.replaceChildren(h('div.row', App.fileLabel(st.pre, db),
          h('button.btn.sm', { onclick: async () => { const f = await act('files:pick', ['pre-adhan']); if (f?.[0]) { st.pre = f[0].rel; await save(); await refresh(); } } }, st.pre ? 'تغيير' : 'اختيار ملف'),
          st.pre ? h('button.btn.sm.ghost', { onclick: (e) => App.preview(st.pre, e.currentTarget) }, icon('play'), 'معاينة') : null));
      };
      draw();
      const collect = () => ({ key: p.key, enabled: en.checked, audio: st.audio, preAdhan: { enabled: preEn.checked, minutesBefore: Number(mins.value), audio: st.pre } });
      const save = () => act('prayers:saveConfig', [[collect()]], 'تم حفظ إعدادات ' + p.name);
      en.addEventListener('change', save);
      preEn.addEventListener('change', save);
      mins.addEventListener('change', save);
      return h('tr', h('td', h('strong', p.name)), h('td', en), h('td', audioCell), h('td', preEn), h('td', h('div.row', mins, h('span.muted.small', 'دقيقة'))), h('td', preCell));
    });
    const fajr = db.prayers.find((p) => p.key === 'fajr');
    return h('div.card',
      h('div.card-title', h('h2', 'الأذان وتنبيه ما قبل الأذان')),
      fajr && fajr.preAdhan.enabled && !fajr.preAdhan.audio ? App.notice('warn', 'ملف تنبيه ما قبل أذان الفجر غير موجود في أرشيف النظام القديم — تُرك فارغاً. الفجر أصلاً معطّل لأن وقته قبل بداية ساعات العمل (07:00 AM).') : null,
      h('table.tbl', { style: { marginTop: '10px' } },
        h('thead', h('tr', h('th', 'الصلاة'), h('th', 'تفعيل'), h('th', 'ملف الأذان'), h('th', 'تنبيه قبل الأذان'), h('th', 'قبل بـ'), h('th', 'ملف التنبيه'))),
        h('tbody', rows)),
      h('div.hint', { style: { marginTop: '8px' } }, 'الشروق يظهر في الجدول للعرض فقط ولا يُشغَّل له صوت، ويُستخدم مرجعاً لأذكار الصباح.'));
  }

  function offsetsCard(tbl) {
    const inputs = {};
    return h('div.card',
      h('div.card-title', h('h2', 'تقديم / تأخير بالدقائق')),
      h('p.small.muted', { style: { marginTop: 0 } }, 'تعديل دائم يُطبَّق على كل أيام السنة ولا يُمحى عند إعادة استيراد الجدول. القيمة السالبة = تقديم.'),
      h('div.grid.cols-3', KEYS.map((k) => App.field(PRAYER_NAMES[k], inputs[k] = h('input.input.num', { type: 'number', min: -60, max: 60, value: tbl.offsets[k] || 0 })))),
      h('div.row', { style: { marginTop: '12px' } },
        h('button.btn.primary', { onclick: async () => { await act('prayers:saveOffsets', [Object.fromEntries(KEYS.map((k) => [k, Number(inputs[k].value)]))], 'تم حفظ التقديم/التأخير'); render(); } }, 'حفظ')));
  }

  function sourceCard(tbl) {
    const src = tbl.source || {};
    const n = Object.keys(tbl.overrides).reduce((a, k) => a + Object.keys(tbl.overrides[k]).length, 0);
    return h('div.card',
      h('div.card-title', h('h2', 'مصدر الجدول')),
      h('div.stack.small',
        h('div', 'عدد الأيام: ', h('strong', String(Object.keys(tbl.table).length))),
        h('div', 'المصدر: ', h('strong', src.type === 'excel' ? `ملف Excel (${src.file})` : src.type === 'migration-csv' ? 'حزمة الترحيل من النظام القديم' : '—')),
        src.importedAt ? h('div', 'تاريخ الاستيراد: ', h('span', T.stamp(new Date(src.importedAt)))) : null,
        h('div', 'تعديلات يدوية على أيام محددة: ', h('strong', String(n))),
        h('div.hint', 'الجدول مرتبط بالشهر واليوم (بدون سنة) ويُستخدم كل عام. انقر على أي وقت في الجدول أدناه لتعديله يدوياً.')));
  }

  function tableCard(tbl, today) {
    const sel = h('select.input', { onchange: () => { month = Number(sel.value); render(); } }, MONTHS.map((m, i) => h('option', { value: i + 1 }, `${i + 1} — ${m}`)));
    sel.value = String(month);
    const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
    const rows = [];
    for (let d = 1; d <= days; d++) {
      const key = `${month}-${d}`;
      const row = tbl.table[key];
      const ov = tbl.overrides[key] || {};
      const isToday = today.getMonth() + 1 === month && today.getDate() === d;
      rows.push(h('tr', { class: isToday ? 'today' : '' },
        h('td', h('strong', String(d)), isToday ? h('span.chip.info', { style: { marginInlineStart: '6px' } }, 'اليوم') : null),
        KEYS.map((k) => {
          const base = row?.[k];
          const val = ov[k] || base;
          let shown = val;
          if (val && tbl.offsets[k]) shown = T.format12(T.parse12(val) + tbl.offsets[k] * 60);
          return h('td', h('button.btn.ghost.sm', { class: ov[k] ? 'edited' : '', title: ov[k] ? `معدّل يدوياً (الأصل ${base})` : 'انقر للتعديل', onclick: () => editCell(key, k, val, base, !!ov[k]) },
            h('span.time', shown || '—')));
        })));
    }
    return h('div.card', { style: { marginTop: '16px' } },
      h('div.card-title', h('h2', 'جدول السنة'), h('div.tools', sel)),
      h('div.hint', { style: { marginBottom: '8px' } }, 'الأوقات المعروضة بعد تطبيق التقديم/التأخير. الأوقات الملوّنة معدّلة يدوياً.'),
      h('div.table-wrap', h('table.tbl', h('thead', h('tr', h('th', 'اليوم'), KEYS.map((k) => h('th', PRAYER_NAMES[k])))), h('tbody', rows))));
  }

  function editCell(dayKey, k, val, base, edited) {
    const [m, d] = dayKey.split('-');
    const ti = App.timeInput(val || '12:00 PM');
    App.modal({
      title: `تعديل ${PRAYER_NAMES[k]} — ${d}/${m}`,
      body: h('div.stack', App.field('الوقت (12 ساعة)', ti), h('div.hint', `القيمة الأصلية من الجدول: ${base || '—'}. التعديل اليدوي محفوظ ولا يُمحى عند إعادة الاستيراد.`)),
      actions: [
        { label: 'حفظ', kind: 'primary', onClick: async () => { await act('prayers:setOverride', [dayKey, k, ti.value], 'تم الحفظ'); render(); } },
        edited ? { label: 'إرجاع للأصل', onClick: async () => { await act('prayers:setOverride', [dayKey, k, null], 'تم الإرجاع'); render(); } } : null,
        { label: 'إلغاء', kind: 'ghost' },
      ].filter(Boolean),
    });
  }

  async function importFlow() {
    let r;
    try { r = await call('prayers:importPreview'); } catch (e) { App.toast('تعذر قراءة الملف: ' + e.message, 'error'); return; }
    if (!r) return;
    let pm = 1;
    const tableBox = h('div');
    const drawPreview = () => {
      const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][pm - 1];
      const rows = [];
      for (let d = 1; d <= days; d++) {
        const row = r.table[`${pm}-${d}`];
        rows.push(h('tr', h('td', String(d)), KEYS.map((k) => h('td', h('span.time', row?.[k] || '—')))));
      }
      tableBox.replaceChildren(h('div.table-wrap', { style: { maxHeight: '340px' } }, h('table.tbl', h('thead', h('tr', h('th', 'اليوم'), KEYS.map((k) => h('th', PRAYER_NAMES[k])))), h('tbody', rows))));
    };
    const msel = h('select.input', { onchange: () => { pm = Number(msel.value); drawPreview(); } }, MONTHS.map((m, i) => h('option', { value: i + 1 }, `${i + 1} — ${m}`)));
    drawPreview();
    App.modal({
      title: 'معاينة الاستيراد قبل الحفظ', wide: true,
      body: h('div.stack',
        App.notice('info', `الملف: ${r.file} — ${r.count} يوماً. تم تصحيح AM/PM تلقائياً: الفجر والشروق صباحاً، الظهر كما هو، العصر والمغرب والعشاء بعد الظهر. تم تجاهل ${r.skipped} صف حشو (أيام غير موجودة بالتقويم).`),
        r.warnings.length ? App.notice('warn', h('div', h('strong', `تحذيرات (${r.warnings.length}):`), h('ul', { style: { margin: '4px 0 0', paddingInlineStart: '18px' } }, r.warnings.slice(0, 30).map((w) => h('li', w))))) : App.notice('ok', 'لا توجد تحذيرات — كل الأيام بترتيب منطقي.'),
        h('div.row', h('span', 'الشهر:'), msel),
        tableBox,
        h('div.hint', 'التعديلات اليدوية والتقديم/التأخير الحالية ستبقى كما هي.')),
      actions: [
        { label: 'حفظ الجدول', kind: 'primary', onClick: async () => { await act('prayers:importCommit', [], 'تم استيراد جدول المواقيت بنجاح'); render(); } },
        { label: 'إلغاء', kind: 'ghost' },
      ],
    });
  }

  App.screens.prayers = {
    async mount(el) { root = el; await render(); },
    unmount() { root = null; },
    onDb() { /* الحفظ يتم بأزرار صريحة؛ لا نعيد الرسم لتفادي فقدان الإدخال */ },
  };
})();
