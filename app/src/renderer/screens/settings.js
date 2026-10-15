'use strict';
(function () {
  const { h, icon, act, call } = App;
  let root = null;

  function slider(label, value, { min = 0, max = 1, step = 0.05, pct = true } = {}) {
    const val = h('span.val');
    const inp = h('input', { type: 'range', min, max, step, value });
    const upd = () => { val.textContent = pct ? Math.round(inp.value * 100) + '%' : inp.value; };
    inp.addEventListener('input', upd);
    upd();
    const row = h('div.slider-row', h('span', label), inp, val);
    Object.defineProperty(row, 'value', { get: () => Number(inp.value) });
    return row;
  }

  function num(value, min, max) { return h('input.input.num', { type: 'number', min, max, value }); }

  async function render() {
    if (!root) return;
    const sec = await call('security:status');
    root.replaceChildren();
    if (sec.hasPassword && !sec.unlocked) { root.append(lockScreen()); return; }
    const db = App.db;
    const s = db.settings;
    const info = await call('app:info').catch(() => ({}));

    // الصوت
    const vMaster = slider('المستوى العام', s.volume.master);
    const vAdhan = slider('الأذان والتنبيه', s.volume.adhan);
    const vAds = slider('الإعلانات', s.volume.ads);
    const vAzkar = slider('الأذكار', s.volume.azkar);
    const vBg = slider('الخلفية', s.volume.background);

    // الخفض
    const dk = s.ducking;
    const dMode = h('select.input', h('option', { value: 'pause' }, 'إيقاف كامل ثم استئناف (موصى به)'), h('option', { value: 'duck' }, 'خفض إلى مستوى محدد'));
    dMode.value = dk.mode;
    const dLevel = slider('مستوى الخفض', dk.duckedLevel);
    const dOut = num(dk.fadeOutSeconds, 0, 30);
    const dIn = num(dk.fadeInSeconds, 0, 30);
    const dSilB = num(dk.silenceBeforePrioritySeconds, 0, 30);
    const dSilA = num(dk.silenceAfterSeconds, 0, 30);
    const dResume = App.toggle(dk.resumeBackgroundBetweenAdRepeats, 'استئناف الخلفية أثناء فاصل الإعلان');
    const dAdhanPause = App.toggle(dk.pauseBackgroundDuringAdhan, 'إيقاف الخلفية بالكامل أثناء الأذان وتنبيهه (بدلاً من الخفض)');

    // ساعات العمل
    const tw = s.timeWindow;
    const twEn = App.toggle(tw.enabled, 'تفعيل نافذة ساعات العمل');
    const twStart = App.timeInput(tw.start);
    const twEnd = App.timeInput(tw.end);
    const ap = Object.fromEntries(['adhan', 'ads', 'azkar', 'background'].map((k) => [k, App.toggle(tw.applyTo[k])]));

    // الموثوقية
    const grace = num(s.reliability.missedEventGraceMinutes, 0, 60);
    const sleep = App.toggle(s.reliability.preventSleep, 'منع السكون أثناء العمل');
    const startup = App.toggle(s.startup.runOnWindowsStartup, 'التشغيل التلقائي مع Windows');
    const home = h('input.input', { value: s.background.homeUrl, style: { direction: 'ltr' } });
    const fallback = App.toggle(s.background.autoFallbackToLocal, 'التحويل التلقائي للخلفية المحلية عند انقطاع الإنترنت');

    const save = async () => {
      if (twStart.value === twEnd.value && twEn.checked) App.toast('البداية = النهاية تعني السماح طوال اليوم', 'warn');
      await act('settings:save', [{
        volume: { master: vMaster.value, adhan: vAdhan.value, ads: vAds.value, azkar: vAzkar.value, background: vBg.value },
        ducking: { mode: dMode.value, duckedLevel: dLevel.value, fadeOutSeconds: Number(dOut.value), fadeInSeconds: Number(dIn.value), silenceBeforePrioritySeconds: Number(dSilB.value), silenceAfterSeconds: Number(dSilA.value), resumeBackgroundBetweenAdRepeats: dResume.checked, pauseBackgroundDuringAdhan: dAdhanPause.checked },
        timeWindow: { enabled: twEn.checked, start: twStart.value, end: twEnd.value, applyTo: Object.fromEntries(Object.entries(ap).map(([k, t]) => [k, t.checked])) },
        reliability: { missedEventGraceMinutes: Number(grace.value), preventSleep: sleep.checked },
        startup: { runOnWindowsStartup: startup.checked },
        background: { homeUrl: home.value, autoFallbackToLocal: fallback.checked },
      }], 'تم حفظ الإعدادات بنجاح');
    };

    root.append(
      h('div.page-head',
        h('div', h('h1', 'الإعدادات'), h('p', 'كل الأوقات بنظام 12 ساعة AM/PM')),
        h('div.actions',
          sec.hasPassword ? h('button.btn.ghost', { onclick: async () => { await call('security:lock'); render(); } }, icon('lock'), 'قفل') : null,
          h('button.btn.primary.big', { onclick: save }, 'حفظ الإعدادات'))),
      h('div.grid.cols-2',
        h('div.card', h('div.card-title', h('h2', 'مستويات الصوت')), h('div.stack', vMaster, vAdhan, vAds, vAzkar, vBg),
          h('div.hint', { style: { marginTop: '8px' } }, 'الصوت الفعلي = المستوى العام × مستوى النوع.')),
        h('div.card', h('div.card-title', h('h2', 'خفض الصوت التلقائي (Ducking)')),
          h('div.stack',
            App.field('طريقة التعامل مع الخلفية', dMode),
            dLevel,
            h('div.grid.cols-4',
              App.field('مدة الخفض (ث)', dOut), App.field('مدة الرفع (ث)', dIn),
              App.field('صمت قبل (ث)', dSilB), App.field('صمت بعد (ث)', dSilA)),
            dResume, dAdhanPause,
            h('div.hint', 'التسلسل: خفض الخلفية بتدرّج ← صمت ← تشغيل الأذان/الإعلان/الذكر ← صمت ← رفع الخلفية بتدرّج.')))),
      h('div.grid.cols-2', { style: { marginTop: '16px' } },
        h('div.card', h('div.card-title', h('h2', 'ساعات العمل المسموحة')),
          h('div.stack',
            twEn,
            h('div.row', App.field('من', twStart), App.field('إلى', twEnd)),
            h('div.hint', 'تدعم النهاية بعد منتصف الليل (مثلاً من 07:00 AM إلى 02:00 AM). 12:00 AM = منتصف الليل.'),
            h('h3', { style: { marginTop: '8px' } }, 'الأنواع التي تخضع للنافذة'),
            h('div.grid.cols-2',
              h('label.row', ap.adhan, 'الأذان وتنبيهه'), h('label.row', ap.ads, 'الإعلانات'),
              h('label.row', ap.azkar, 'الأذكار'), h('label.row', ap.background, 'الخلفية')),
            h('div.hint', 'إلغاء خضوع الأذكار مفيد عندما يقع "الشروق + الفارق" صيفاً قبل بداية النافذة.'))),
        h('div.card', h('div.card-title', h('h2', 'التشغيل والموثوقية')),
          h('div.stack',
            startup, sleep,
            App.field('مهلة تشغيل حدث فات (بالدقائق)', grace, 'بعد انقطاع الكهرباء أو إعادة التشغيل: يُشغَّل الحدث الذي فات قبل أقل من هذه المهلة فقط.'),
            App.field('الصفحة الرئيسية للمتصفح', home),
            fallback))),
      h('div.grid.cols-2', { style: { marginTop: '16px' } },
        passwordCard(sec),
        h('div.card', h('div.card-title', h('h2', 'النسخ الاحتياطي والترحيل')),
          h('div.stack',
            h('div.row',
              h('button.btn', { onclick: () => act('backup:create').then((p) => p && App.toast('تم إنشاء النسخة الاحتياطية بنجاح')) }, icon('download'), 'إنشاء نسخة احتياطية'),
              h('button.btn', { onclick: () => act('backup:restore') }, icon('upload'), 'استعادة نسخة')),
            h('div.hint', 'النسخة تشمل الإعدادات والجداول والإعلانات والأذكار والملفات الصوتية في ملف zip واحد.'),
            h('hr.sep'),
            h('div.row', h('button.btn', { onclick: () => act('migration:importFolder').then((r) => r && App.toast(`تم الاستيراد: ${r.files} ملف`)) }, icon('folder'), 'استيراد حزمة ترحيل يدوياً')),
            h('div.hint', 'تُستورد حزمة AlfajrRadio_Migration تلقائياً عند أول تشغيل. الاستيراد اليدوي يستبدل الإعلانات والأذكار والأذان وجدول المواقيت.'),
            h('hr.sep'),
            h('div.row', h('button.btn.ghost', { onclick: () => call('app:openDataFolder') }, icon('folder'), 'فتح مجلد بيانات البرنامج')),
            h('div.small.muted', { style: { direction: 'ltr', textAlign: 'right' } }, info.dataDir || ''),
            h('div.small.muted', `الإصدار ${info.version || ''} • Electron ${info.electron || ''} • Chromium ${info.chrome || ''}`)))));
  }

  function passwordCard(sec) {
    const cur = h('input.input', { type: 'password', placeholder: 'كلمة المرور الحالية' });
    const nw = h('input.input', { type: 'password', placeholder: 'كلمة المرور الجديدة' });
    const nw2 = h('input.input', { type: 'password', placeholder: 'تأكيد كلمة المرور الجديدة' });
    return h('div.card', h('div.card-title', h('h2', 'حماية الإعدادات بكلمة مرور')),
      h('div.stack',
        h('div.small.muted', sec.hasPassword ? 'كلمة المرور مفعّلة — الإعدادات والإضافات والنسخ الاحتياطي محمية، وتُقفل تلقائياً بعد 10 دقائق.' : 'لا توجد كلمة مرور — أي شخص يستطيع تغيير الإعدادات.'),
        sec.hasPassword ? cur : null, nw, nw2,
        h('div.row',
          h('button.btn.primary', {
            onclick: async () => {
              if (!nw.value) return App.toast('أدخل كلمة المرور الجديدة', 'warn');
              if (nw.value !== nw2.value) return App.toast('كلمتا المرور غير متطابقتين', 'error');
              await act('security:set', [cur.value, nw.value], 'تم حفظ كلمة المرور');
              render();
            },
          }, sec.hasPassword ? 'تغيير كلمة المرور' : 'تعيين كلمة مرور'),
          sec.hasPassword ? h('button.btn.ghost', { onclick: async () => { await act('security:set', [cur.value, null], 'تمت إزالة كلمة المرور'); render(); } }, 'إزالة كلمة المرور') : null)));
  }

  function lockScreen() {
    const pw = h('input.input', { type: 'password', placeholder: 'كلمة مرور المشرف', style: { width: '100%', textAlign: 'center' } });
    const go = async () => {
      try { await call('security:unlock', pw.value); render(); } catch (e) { App.toast(e.message, 'error'); pw.select(); }
    };
    pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    setTimeout(() => pw.focus(), 50);
    return h('div.lock-overlay', h('div.lock-box.card.stack', icon('lock'), h('h2', 'الإعدادات محمية'), h('p.muted.small', 'أدخل كلمة مرور المشرف للمتابعة'), pw, h('button.btn.primary', { onclick: go }, 'فتح')));
  }

  App.screens.settings = {
    async mount(el) { root = el; el.style.position = 'relative'; await render(); },
    unmount() { if (root) root.style.position = ''; root = null; },
  };
})();
