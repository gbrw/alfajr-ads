'use strict';
(function () {
  const { h, icon, act, T, TYPE_NAMES } = App;
  let refs = null;

  const PHASES = {
    idle: 'جاهز', ducking: 'خفض الخلفية…', 'silence-before': 'صمت قبل التشغيل…', playing: 'يُشغَّل الآن',
    'silence-after': 'صمت بعد التشغيل…', restoring: 'إعادة الخلفية…',
  };

  App.screens.dashboard = {
    mount(el) {
      refs = {};
      el.append(
        h('div.page-head', h('div', h('h1', 'لوحة التحكم'), h('p', 'منظم الإعلانات والأذان والأذكار — الرمادي'))),
        h('div.hero',
          h('div.card.status-card',
            h('div.status-line', refs.dot = h('span.status-dot'), refs.statusText = h('span.status-text', '…')),
            refs.windowNote = h('div.small.muted'),
            h('hr.sep'),
            refs.nowPlaying = h('div')),
          h('div.card.next-card',
            h('h3', 'الحدث التالي'),
            refs.countdown = h('div.countdown', '--:--:--'),
            refs.nextWhat = h('div.what', '—'),
            refs.nextMeta = h('div.small.muted'))),
        h('div.card', { style: { marginBottom: '16px' } },
          h('div.card-title', h('h2', 'مواقيت اليوم'), refs.city = h('span.muted.small')),
          refs.strip = h('div.prayer-strip'))
        ,
        h('div.grid.cols-2',
          h('div.card', h('div.card-title', h('h2', 'جدول اليوم')), refs.timeline = h('div.timeline')),
          h('div.stack',
            h('div.card', h('div.card-title', h('h2', 'الخلفية الصوتية')), refs.bg = h('div.stack')),
            h('div.card', h('div.card-title', h('h2', 'طابور الانتظار')), refs.queue = h('div.stack')))));
    },
    unmount() { refs = null; },
    onState(s) {
      if (!refs) return;
      const stopped = s.status === 'stopped';
      refs.dot.classList.toggle('stopped', stopped);
      refs.statusText.textContent = stopped ? 'متوقف (إيقاف طارئ)' : 'يعمل بشكل طبيعي';
      const w = s.timeWindow;
      refs.windowNote.textContent = w.enabled
        ? `ساعات العمل المسموحة: ${w.start} – ${w.end} ${s.insideWindow ? '(داخل النافذة الآن)' : '— خارج النافذة الآن: لا يُشغَّل صوت'}`
        : 'نافذة ساعات العمل غير مفعّلة';

      // يُشغَّل الآن
      const p = s.playback;
      if (p && p.current) {
        const pct = p.current.duration ? Math.min(100, (p.current.position / p.current.duration) * 100) : 0;
        refs.nowPlaying.replaceChildren(
          h('div.now-playing',
            p.phase === 'playing' ? h('div.eq', h('i'), h('i'), h('i'), h('i')) : icon('pause'),
            h('div', { style: { flex: 1 } },
              h('div', h('strong', p.current.label)),
              h('div.small.muted', PHASES[p.phase] || p.phase, p.current.duration ? ` — ${T.formatDuration(p.current.position)} / ${T.formatDuration(p.current.duration)}` : '')),
            p.phase === 'playing' ? h('button.btn.sm', { onclick: () => act('control:skip') }, 'تخطي') : null),
          h('div.progress', { style: { marginTop: '10px' } }, h('i', { style: { width: pct + '%' } })));
      } else {
        refs.nowPlaying.replaceChildren(h('div.muted', stopped ? 'كل الأصوات متوقفة' : 'لا يوجد تشغيل ذو أولوية الآن'));
      }

      // الحدث التالي
      if (s.next) {
        refs.countdown.textContent = T.formatCountdown(s.next.secondsLeft);
        refs.nextWhat.textContent = s.next.label;
        refs.nextMeta.replaceChildren(`${s.next.dayLabel} الساعة `, h('span.time', s.next.time),
          s.next.outsideWindow ? h('span.chip.warn', { style: { marginInlineStart: '8px' } }, 'خارج ساعات العمل — لن يُشغَّل') : null);
      } else {
        refs.countdown.textContent = '--:--:--';
        refs.nextWhat.textContent = 'لا توجد أحداث قادمة';
        refs.nextMeta.textContent = '';
      }

      // المواقيت
      const nextPrayer = s.prayers.find((x) => !x.past && x.key !== 'sunrise');
      refs.strip.replaceChildren(...s.prayers.map((x) => h('div.prayer-tile', {
        class: [x.past ? 'past' : '', nextPrayer && nextPrayer.key === x.key ? 'next' : '', x.enabled === false ? 'off' : ''].join(' '),
      }, h('div.n', x.name), h('div.t.time', x.time),
        h('div.s', x.key === 'sunrise' ? 'للعرض فقط' : x.enabled ? (x.offset ? `معدّل ${x.offset > 0 ? '+' : ''}${x.offset} د` : 'مفعّل') : 'معطّل'))));

      // الجدول الزمني
      const items = s.today;
      refs.timeline.replaceChildren(...(items.length ? items.map((e) => h('div.tl-item', { class: e.past ? 'past' : '' },
        h('span.time', e.time),
        h('span', h('span', { class: 'type-' + e.type }, `${TYPE_NAMES[e.type]} • `), e.label),
        e.fired ? h('span.chip', 'تم') : e.outsideWindow ? h('span.chip.warn', 'خارج الساعات') : e.past ? h('span.chip', 'فات') : h('span.chip.info', 'قادم')))
        : [h('div.empty', 'لا توجد أحداث اليوم')]));

      // الخلفية
      const b = s.background || {};
      const src = b.effectiveSource === 'local' ? 'المشغل المحلي' : 'المتصفح المدمج';
      const bgState = b.emergency ? ['bad', 'متوقفة (إيقاف طارئ)'] : b.outsideWindow ? ['warn', 'متوقفة — خارج ساعات العمل'] :
        b.pausedByDuck ? ['warn', 'متوقفة مؤقتاً أثناء الأذان/الإعلان'] : b.duck < 1 ? ['warn', `منخفضة إلى ${Math.round(b.duck * 100)}%`] :
          b.playing ? ['ok', 'تعمل'] : ['', 'لا يوجد تشغيل'];
      refs.bg.replaceChildren(
        h('div.row', h('span', 'المصدر الفعّال:'), h('strong', src), b.fallbackActive ? h('span.chip.warn', 'تحويل تلقائي بسبب انقطاع الإنترنت') : null),
        h('div.row', h('span', 'الحالة:'), h('span.chip', { class: bgState[0] }, h('span.dot'), bgState[1])),
        b.effectiveSource === 'local' && s.local?.trackTitle ? h('div.small.muted', `${s.local.reciterName} — ${s.local.trackTitle}`) :
          s.browser?.title ? h('div.small.muted', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, s.browser.title) : null,
        h('div.row.small', h('span.muted', 'مانع الإعلانات:'), s.adblockActive ? h('span.chip.ok', 'مفعّل') : h('span.chip.warn', 'غير مفعّل'),
          s.extensionsActive.length ? h('span.muted', `الإضافات المحمّلة: ${s.extensionsActive.join('، ')}`) : null));

      // الطابور
      const q = [...(p?.queue || []).map((x) => h('div.row', h('span.chip.warn', 'مؤجل'), x.label)),
        ...(p?.pendingRepeats || []).map((x) => h('div.row', h('span.chip.info', 'تكرار'), x.label, h('span.muted.small', 'الساعة '), h('span.time.small', x.dueAt)))];
      refs.queue.replaceChildren(...(q.length ? q : [h('div.muted.small', 'لا يوجد شيء في الانتظار')]));
    },
  };
})();
