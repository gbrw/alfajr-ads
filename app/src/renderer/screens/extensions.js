'use strict';
(function () {
  const { h, icon, act, call, T } = App;
  let root = null;
  let busy = false;

  const MODES = [
    ['auto', 'تلقائي (موصى به)', 'المانع المدمج يعمل دائماً، إلا إذا أثبت الاختبار الفعلي أن uBlock Origin يحجب بنفسه.'],
    ['builtin', 'المانع المدمج فقط', 'حجب على مستوى الطلبات الشبكية بقوائم EasyList / EasyPrivacy / فلاتر uBlock.'],
    ['ublock', 'uBlock Origin فقط', 'يعتمد على الإضافة وحدها — غير موصى به حالياً (انظر نتيجة الاختبار).'],
    ['both', 'كلاهما', 'المانع المدمج + الإضافة معاً.'],
    ['off', 'إيقاف الحجب', 'لا حجب للإعلانات.'],
  ];

  function stamp(iso) { return iso ? T.stamp(new Date(iso)) : '—'; }

  function testChip(r) {
    if (!r) return h('span.chip', 'لم يُختبر بعد');
    if (!r.controlOk) return h('span.chip.warn', r.note);
    return h('span.chip', { class: r.ok ? 'ok' : 'bad' }, r.note);
  }

  async function render() {
    if (!root) return;
    const { extensions, adblock } = await call('ext:list');
    const st = adblock.stats;
    root.replaceChildren(
      h('div.page-head',
        h('div', h('h1', 'الإضافات ومانع الإعلانات'), h('p', 'الإضافات تُحمَّل تلقائياً عند كل إقلاع في جلسة المتصفح الدائمة (Electron لا يتذكرها ولا يقبل إلا غير المضغوطة)')),
        h('div.actions',
          h('button.btn', { disabled: busy, onclick: selfTest }, icon('shield'), busy ? 'جارِ الاختبار…' : 'اختبار فعلي الآن'),
          h('button.btn.primary', { onclick: () => act('ext:addFolder', [], 'تمت إضافة الإضافة').then(render) }, icon('folder'), 'إضافة من مجلد'))),
      h('div.card', { style: { marginBottom: '16px' } },
        h('div.card-title', h('h2', 'إعلانات يوتيوب')),
        h('div.stack', [
          ['mute', 'كتم صوت الإعلان حتى ينتهي (موصى به)', 'لا يتدخل المانع داخل يوتيوب حتى لا يكتشفه ويوقف الفيديو ("Experiencing interruptions"). عند ظهور إعلان يُكتم الصوت ويُضغط "تخطي" تلقائياً، ثم يعود الصوت طبيعياً.'],
          ['block', 'حجب إعلانات يوتيوب', 'يحجب الإعلانات، لكن يوتيوب قد يكتشف ذلك ويعطّل تشغيل الفيديو.'],
        ].map(([k, label, desc]) => h('label.row', { style: { cursor: 'pointer', alignItems: 'flex-start' } },
          h('input', { type: 'radio', name: 'ytmode', checked: (adblock.youtubeMode || 'mute') === k, onchange: () => act('adblock:setYoutubeMode', [k], 'تم الحفظ — أعد تحميل صفحة يوتيوب').then(render) }),
          h('div', h('div', h('strong', label)), h('div.small.muted', desc))))),
        h('div.small.muted', { style: { marginTop: '8px' } }, 'الكتم يعمل في الوضعين كطبقة حماية إضافية. الخلفية المحلية (بدون إنترنت وبدون إعلانات) متاحة دائماً كبديل.')),
      h('div.grid.cols-2', { style: { marginTop: '16px' } },
        h('div.card',
          h('div.card-title', h('h2', 'وضع الحجب')),
          h('div.stack', MODES.map(([k, label, desc]) => h('label.row', { style: { cursor: 'pointer', alignItems: 'flex-start' } },
            h('input', { type: 'radio', name: 'abmode', checked: adblock.mode === k, onchange: () => act('adblock:setMode', [k], 'تم تغيير وضع الحجب').then(render) }),
            h('div', h('div', h('strong', label)), h('div.small.muted', desc))))),
          h('hr.sep'),
          h('div.row', h('span', 'المانع المدمج الآن:'), adblock.builtinActive ? h('span.chip.ok', 'مفعّل') : h('span.chip.warn', 'غير مفعّل'))),
        h('div.card',
          h('div.card-title', h('h2', 'نتائج الاختبار الفعلي داخل البرنامج')),
          h('div.stack.small',
            h('div.row', h('span', { style: { width: '150px' } }, 'المانع المدمج:'), testChip(adblock.selfTest.builtin)),
            h('div.row', h('span', { style: { width: '150px' } }, 'uBlock Origin:'), testChip(adblock.selfTest.ublock)),
            h('div.hint', 'الاختبار يطلب 5 سكربتات إعلانية معروفة (Google Ads / DoubleClick / Amazon / Taboola) وطلباً سليماً للمقارنة داخل جلسة معزولة.'),
            h('hr.sep'),
            h('div', 'قوائم الفلترة: ', h('strong', adblock.engineInfo?.file || '—'), ' — آخر تحديث: ', stamp(adblock.lastListUpdate || adblock.engineInfo?.mtime)),
            h('div.row', h('button.btn.sm', { onclick: () => act('adblock:updateLists', [], 'جارِ/تم تحديث القوائم').then(render) }, icon('reload'), 'تحديث القوائم الآن'))))),
      h('div.card', { style: { marginTop: '16px' } },
        h('div.card-title', h('h2', 'الإضافات المحمّلة')),
        extensions.length ? h('div', extensions.map((e) => h('div.list-item',
          App.toggle(e.enabled, null, (v) => act('ext:setEnabled', [e.id, v], v ? 'تم تفعيل الإضافة' : 'تم تعطيل الإضافة').then(render)),
          h('div.grow',
            h('div.row', h('span.title', e.status.name || e.name), e.status.version ? h('span.muted.small', e.status.version) : null,
              e.source === 'bundled' ? h('span.chip', 'مرفقة مع البرنامج') : h('span.chip.info', 'مضافة')),
            h('div.row.small', { style: { marginTop: '4px' } },
              e.status.loaded ? h('span.chip.ok', 'محمّلة') : e.status.error ? h('span.chip.bad', 'فشل التحميل') : h('span.chip', 'غير محمّلة'),
              e.status.error ? h('span.muted', e.status.error) : null,
              e.id === 'ublock-origin' && adblock.selfTest.ublock && adblock.selfTest.ublock.controlOk && !adblock.selfTest.ublock.ok
                ? h('span.chip.warn', 'محمّلة لكنها لا تحجب داخل Electron — يُعتمد المانع المدمج') : null)),
          e.source !== 'bundled' ? h('button.btn.sm.ghost', { onclick: async () => { if (await App.confirmBox(`إزالة الإضافة "${e.name}"؟`, { okLabel: 'إزالة', danger: true })) act('ext:remove', [e.id], 'تمت الإزالة').then(render); } }, icon('trash')) : null)))
          : h('div.empty', 'لا توجد إضافات')),
      h('div.card', { style: { marginTop: '16px' } },
        h('div.card-title', h('h2', 'إحصاءات الحجب منذ ', stamp(new Date(st.since).toISOString())), h('div.tools', h('button.btn.sm.ghost', { onclick: () => act('adblock:resetStats').then(render) }, 'تصفير'))),
        h('div.grid.cols-3',
          h('div', h('div.muted.small', 'طلبات محجوبة'), h('div', { style: { fontSize: '26px', fontWeight: 700 } }, String(st.blocked))),
          h('div', h('div.muted.small', 'طلبات مُعاد توجيهها'), h('div', { style: { fontSize: '26px', fontWeight: 700 } }, String(st.redirected))),
          h('div', h('div.muted.small', 'حقن تجميلي (إخفاء عناصر)'), h('div', { style: { fontSize: '26px', fontWeight: 700 } }, String(st.cosmetic)))),
        st.topHosts.length ? h('table.tbl', { style: { marginTop: '12px' } }, h('thead', h('tr', h('th', 'النطاق'), h('th', 'محجوب'))),
          h('tbody', st.topHosts.map(([host, n]) => h('tr', h('td', { style: { direction: 'ltr', textAlign: 'right' } }, host), h('td', String(n)))))) : null));
  }

  async function selfTest() {
    busy = true; render();
    try { await act('adblock:selfTest', [], 'انتهى الاختبار'); } finally { busy = false; render(); }
  }

  App.screens.extensions = {
    async mount(el) { root = el; await render(); },
    unmount() { root = null; },
    onExt() { if (!busy) render(); },
  };
})();
