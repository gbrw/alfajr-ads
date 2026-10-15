'use strict';
(function () {
  const { h, icon, act, call } = App;
  const LEVELS = { info: 'معلومة', warn: 'تحذير', error: 'خطأ' };
  const CATS = {
    system: 'النظام', scheduler: 'المجدول', adhan: 'الأذان', preadhan: 'تنبيه قبل الأذان', ads: 'الإعلانات', azkar: 'الأذكار',
    background: 'الخلفية', prayers: 'المواقيت', network: 'الإنترنت', adblock: 'مانع الإعلانات', migration: 'الترحيل', settings: 'الإعدادات', backup: 'النسخ الاحتياطي',
  };
  const STATUS = { success: 'ناجح', fail: 'فاشل', deferred: 'مؤجل' };
  let root = null;
  let list = null;
  let filters = { from: '', to: '', level: '', category: '', status: '', search: '' };
  let live = true;

  function row(e) {
    return h('div.log-row', { class: `l-${e.level} ${e.status ? 's-' + e.status : ''}` },
      h('span.ts', e.stamp),
      h('span.lvl', { class: e.level }, LEVELS[e.level] || e.level),
      h('span.muted', CATS[e.category] || e.category, e.status ? h('span', { class: 'chip ' + ({ success: 'ok', fail: 'bad', deferred: 'warn' }[e.status]), style: { marginInlineStart: '6px', fontSize: '11px', padding: '0 7px' } }, STATUS[e.status]) : null),
      h('span', e.message));
  }

  function matches(e) {
    const f = filters;
    if (f.from && e.date < f.from) return false;
    if (f.to && e.date > f.to) return false;
    if (f.level && e.level !== f.level) return false;
    if (f.category && e.category !== f.category) return false;
    if (f.status && e.status !== f.status) return false;
    if (f.search && !e.message.toLowerCase().includes(f.search.toLowerCase())) return false;
    return true;
  }

  async function load() {
    const q = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
    const entries = await call('logs:query', { ...q, limit: 1500 });
    list.replaceChildren(...(entries.length ? entries.reverse().map(row) : [h('div.empty', 'لا توجد سجلات مطابقة')]));
  }

  function sel(key, opts, label) {
    const s = h('select.input', { onchange: () => { filters[key] = s.value; load(); } }, h('option', { value: '' }, label), Object.entries(opts).map(([k, v]) => h('option', { value: k }, v)));
    s.value = filters[key];
    return s;
  }

  App.screens.logs = {
    async mount(el) {
      root = el;
      const search = h('input.input', { placeholder: 'بحث في الرسائل…', value: filters.search, oninput: () => { filters.search = search.value; clearTimeout(search._t); search._t = setTimeout(load, 250); } });
      const from = h('input.input', { type: 'date', value: filters.from, onchange: () => { filters.from = from.value; load(); } });
      const to = h('input.input', { type: 'date', value: filters.to, onchange: () => { filters.to = to.value; load(); } });
      el.append(
        h('div.page-head',
          h('div', h('h1', 'السجلات'), h('p', 'كل الأوقات بنظام 12 ساعة — يُحتفظ بسجلات آخر 60 يوماً')),
          h('div.actions',
            App.toggle(live, 'عرض مباشر', (v) => { live = v; }),
            h('button.btn', { onclick: () => act('logs:export', [Object.fromEntries(Object.entries(filters).filter(([, v]) => v))]).then((p) => p && App.toast('تم تصدير السجل بنجاح')) }, icon('download'), 'تصدير إلى ملف نصي'),
            h('button.btn.ghost', { onclick: async () => { if (await App.confirmBox('مسح كل السجلات؟ لا يمكن التراجع.', { okLabel: 'مسح', danger: true })) act('logs:clear', [], 'تم مسح السجل').then(load); } }, icon('trash'), 'مسح السجل'))),
        h('div.card.tight', { style: { marginBottom: '12px' } },
          h('div.row',
            h('span', { style: { flex: '1 1 220px', display: 'flex' } }, search),
            h('span.muted.small', 'من'), from, h('span.muted.small', 'إلى'), to,
            sel('level', LEVELS, 'كل المستويات'), sel('category', CATS, 'كل الأنواع'), sel('status', STATUS, 'كل الحالات'),
            h('button.btn.ghost.sm', { onclick: () => { filters = { from: '', to: '', level: '', category: '', status: '', search: '' }; root.replaceChildren(); this.mount(root); } }, 'مسح الفلاتر'))),
        h('div.card', { style: { padding: 0, overflow: 'hidden' } },
          h('div.log-row', { style: { background: 'var(--panel-2)', fontWeight: 600, fontSize: '12.5px', color: 'var(--text-3)' } }, h('span', 'الوقت'), h('span', 'المستوى'), h('span', 'النوع'), h('span', 'الرسالة')),
          list = h('div.log-list')));
      await load();
    },
    unmount() { root = null; list = null; },
    onLog(e) {
      if (!list || !live || !matches(e)) return;
      list.querySelector('.empty')?.remove();
      list.prepend(row(e));
      while (list.childElementCount > 1500) list.lastChild.remove();
    },
    onLogsCleared() { if (list) load(); },
  };
})();
