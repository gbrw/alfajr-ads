'use strict';
(function () {
  const { h, icon, call, act } = App;
  let refs = null;
  let ro = null;

  function layout() {
    if (!refs || App.current !== 'browser' || App.modalOpen > 0) return;
    const r = refs.host.getBoundingClientRect();
    call('browser:bounds', { x: r.left, y: r.top, width: r.width, height: r.height }).catch(() => {});
  }

  App.screens.browser = {
    flush: true,
    layout,
    mount(el) {
      refs = {};
      const go = () => act('browser:navigate', [refs.url.value]);
      refs.url = h('input.input.url', { placeholder: 'اكتب رابطاً أو كلمة بحث…', spellcheck: false, onkeydown: (e) => { if (e.key === 'Enter') go(); } });
      el.append(h('div.browser-shell',
        h('div.browser-bar',
          refs.back = h('button.btn.icon', { title: 'رجوع', onclick: () => act('browser:action', ['back']) }, icon('back')),
          refs.fwd = h('button.btn.icon', { title: 'أمام', onclick: () => act('browser:action', ['forward']) }, icon('forward')),
          h('button.btn.icon', { title: 'تحديث', onclick: () => act('browser:action', ['reload']) }, icon('reload')),
          h('button.btn.icon', { title: 'الصفحة الرئيسية', onclick: () => act('browser:action', ['home']) }, icon('home')),
          refs.url,
          h('button.btn.primary', { onclick: go }, 'انتقال')),
        refs.status = h('div.browser-status'),
        refs.host = h('div.browser-host', h('div.placeholder', 'جارِ تحميل المتصفح…'))));
      ro = new ResizeObserver(layout);
      ro.observe(refs.host);
      window.addEventListener('resize', layout);
      requestAnimationFrame(layout);
    },
    unmount() {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', layout);
      call('browser:hide').catch(() => {});
      refs = null;
    },
    onState(s) {
      if (!refs) return;
      const b = s.browser || {};
      if (document.activeElement !== refs.url && b.url && refs.url.value !== b.url) refs.url.value = b.url;
      refs.back.disabled = !b.canGoBack;
      refs.fwd.disabled = !b.canGoForward;
      const bg = s.background || {};
      const ad = s.adblockActive;
      refs.status.replaceChildren(
        h('span.chip', { class: ad ? 'ok' : 'warn' }, icon('shield'), ad ? 'مانع الإعلانات المدمج: مفعّل' : 'مانع الإعلانات: غير مفعّل'),
        s.extensionsActive.length ? h('span.chip', 'الإضافات: ' + s.extensionsActive.join('، ')) : h('span.chip', 'لا إضافات محمّلة'),
        bg.effectiveSource === 'local' ? h('span.chip.warn', 'المصدر الفعّال الآن: المشغل المحلي — المتصفح موقوف') : null,
        bg.outsideWindow ? h('span.chip.warn', 'خارج ساعات العمل — التشغيل ممنوع') : null,
        bg.emergency ? h('span.chip.bad', 'إيقاف طارئ') : null,
        b.adMuted ? h('span.chip.warn', 'إعلان يوتيوب — الصوت مكتوم مؤقتاً') : b.playing ? h('span.chip.info', 'يُشغِّل صوتاً') : null,
        bg.duck < 1 ? h('span.chip.warn', `الصوت منخفض ${Math.round((bg.duck || 0) * 100)}%`) : null,
        h('span', { style: { marginInlineStart: 'auto' } }, b.loading ? 'جارِ التحميل…' : (b.title || '')),
        h('span.muted', '⚠ حجب إعلانات يوتيوب ليس مضموناً 100%'));
    },
  };
})();
