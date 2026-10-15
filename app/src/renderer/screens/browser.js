'use strict';
(function () {
  const { h, icon, call, act } = App;
  let refs = null;
  let ro = null;
  let vol = null;
  let panelOpen = true;
  try { panelOpen = localStorage.getItem('browserVolPanel') !== '0'; } catch { /* ignore */ }

  function setPanel(open) {
    panelOpen = open;
    try { localStorage.setItem('browserVolPanel', open ? '1' : '0'); } catch { /* ignore */ }
    if (!refs) return;
    refs.side.hidden = !open;
    refs.volBtn.classList.toggle('on', open);
    requestAnimationFrame(layout);
  }

  /** نافذة حساب Google: الحالة + تسجيل الدخول/الخروج + البدائل المدعومة إن رفضت Google المتصفح المدمج. */
  function accountModal() {
    const b = (App.state && App.state.browser) || {};
    const status = b.signedIn ? App.notice('ok', 'مسجّل الدخول إلى YouTube — الجلسة محفوظة وتبقى بعد إغلاق البرنامج وفتحه.')
      : App.notice('info', 'غير مسجّل الدخول. اضغط "تسجيل الدخول" لفتح صفحة Google الرسمية داخل المتصفح، وبعد الدخول تُحفظ الجلسة تلقائياً.');
    const m = App.modal({
      title: 'حساب Google / YouTube', wide: true,
      body: h('div.stack',
        status,
        b.signinBlocked ? App.notice('warn', h('div',
          h('strong', 'رفضت Google تسجيل الدخول من المتصفح المدمج.'),
          h('div', 'تظهر رسالة "قد لا يكون هذا المتصفح أو التطبيق آمناً" لأن Google لا تدعم رسمياً تسجيل الدخول من المتصفحات المدمجة داخل التطبيقات، والبرنامج لا يتحايل على هذا الفحص الأمني. استخدم أحد البدائل التالية:'))) : null,
        h('div.card.stack', { style: { padding: '12px 14px' } },
          h('strong', '1) التشغيل داخل البرنامج بدون تسجيل دخول (موصى به للخلفية)'),
          h('div.small', 'يوتيوب يعمل للاستماع بدون حساب، ويبقى تحت تحكم البرنامج: يتوقف تلقائياً عند الإعلانات والأذان والأذكار ثم يستأنف. لتشغيل قائمة تشغيل من حسابك: اجعلها "غير مدرجة" (Unlisted) من تطبيق YouTube على الهاتف أو من متصفح النظام، ثم انسخ رابطها والصقه في شريط العنوان هنا.')),
        h('div.card.stack', { style: { padding: '12px 14px' } },
          h('strong', '2) متصفح النظام (Chrome أو Edge) — تسجيل دخول مدعوم رسمياً من Google'),
          h('div.small', 'لإدارة الحساب وقوائم التشغيل. تنبيه: البرنامج لا يستطيع إيقاف صوت متصفح النظام تلقائياً عند الأذان والإعلانات، لذلك لا تستخدمه مصدراً للخلفية أثناء الدوام.'),
          h('div.row', h('button.btn', { onclick: () => act('browser:openExternal', ['https://www.youtube.com/'], 'تم فتح YouTube في متصفح النظام') }, icon('browser'), 'فتح YouTube في متصفح النظام'))),
        h('div.hint', 'تسجيل الدخول يتم في صفحة Google الرسمية نفسها؛ البرنامج لا يرى كلمة المرور ولا يحفظها، ويحفظ فقط ملفات تعريف الجلسة (الكوكيز) في مجلد بيانات البرنامج.')),
      actions: [
        !b.signedIn ? { label: 'تسجيل الدخول داخل البرنامج', kind: 'primary', onClick: () => act('browser:signIn') } : null,
        b.signedIn ? { label: 'تسجيل الخروج', kind: 'danger', onClick: async () => { if (await App.confirmBox('تسجيل الخروج من Google/YouTube في المتصفح المدمج؟', { okLabel: 'تسجيل الخروج', danger: true })) await act('browser:signOut', [], 'تم تسجيل الخروج'); } } : null,
        { label: 'إغلاق', kind: 'ghost' },
      ].filter(Boolean),
    });
    return m;
  }

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
          h('button.btn.primary', { onclick: go }, 'انتقال'),
          refs.account = h('button.btn', { onclick: accountModal, title: 'تسجيل الدخول إلى Google / YouTube' }, 'حساب Google'),
          refs.volBtn = h('button.btn', { onclick: () => setPanel(!panelOpen), title: 'إظهار/إخفاء لوحة التحكم بالأصوات' }, icon('volume'), 'الأصوات')),
        refs.status = h('div.browser-status'),
        refs.signin = h('div.browser-signin', { hidden: true }),
        h('div.browser-main',
          refs.side = h('aside.browser-side', (vol = App.volumePanel()).el),
          refs.host = h('div.browser-host', h('div.placeholder', 'جارِ تحميل المتصفح…')))));
      setPanel(panelOpen);
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
      vol = null;
    },
    onState(s) {
      if (!refs) return;
      const b = s.browser || {};
      if (document.activeElement !== refs.url && b.url && refs.url.value !== b.url) refs.url.value = b.url;
      vol.update(s);
      refs.account.replaceChildren(b.signedIn ? h('span.chip.ok', 'مسجّل') : h('span.chip', 'غير مسجّل'), 'حساب Google');
      // شريط الإرشاد عند رفض Google أو أثناء صفحة الدخول
      const showSignin = b.signinBlocked || (b.onSignInPage && !b.signedIn);
      refs.signin.hidden = !showSignin;
      if (showSignin) {
        const key = b.signinBlocked ? 'blocked' : 'page';
        if (refs.signin.dataset.k !== key) {
          refs.signin.dataset.k = key;
          refs.signin.replaceChildren(b.signinBlocked
            ? h('div.notice.warn', icon('warn'), h('div', 'رفضت Google تسجيل الدخول من المتصفح المدمج. '), h('button.btn.sm', { onclick: accountModal }, 'البدائل المدعومة'))
            : h('div.notice.info', icon('info'), h('div', 'صفحة تسجيل الدخول الرسمية من Google — بعد الدخول تُحفظ الجلسة تلقائياً وتبقى بعد إعادة فتح البرنامج.')));
          requestAnimationFrame(layout);
        }
      } else if (refs.signin.dataset.k) { refs.signin.dataset.k = ''; requestAnimationFrame(layout); }
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
