'use strict';
/*
 * أولوية التشغيل (الإعلان > الأذان > التنبيه > الأذكار > المتصفح)، المقاطعة والاستئناف،
 * مستويات الصوت المستقلة وتطبيقها الفوري، والتنبيه قبل الأذان.
 * لا تحتاج حزمة الترحيل ولا Electron (محرك الصوت والخلفية بدائل وهمية).
 */
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.ALFAJR_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'alfajr-prio-'));
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'electron') return { BrowserWindow: class {}, ipcMain: { on() {} } };
  return origLoad.call(this, req, ...rest);
};

const T = require('../src/shared/time12');
const { defaultDb } = require('../src/main/db');
const { planDay, PRIORITY, preAdhanIssues, findConflicts } = require('../src/main/planner');
const V = require('../src/main/volume');
const { AudioEngine } = require('../src/main/audio-engine');
const { Playback } = require('../src/main/playback');

AudioEngine.urlFor = (rel) => (rel ? 'file:///' + rel : null);

function makeDb() {
  const d = defaultDb();
  d.settings.timeWindow.enabled = false;
  Object.assign(d.settings.ducking, { fadeOutSeconds: 0, fadeInSeconds: 0, silenceBeforePrioritySeconds: 0, silenceAfterSeconds: 0 });
  d.prayers = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].map((key) => ({
    key, name: key, enabled: true, audio: `library/adhan/${key}.mp3`,
    preAdhan: { enabled: true, minutesBefore: 10, audio: `library/pre-adhan/${key}.mp3` },
  }));
  d.prayerTimes['10-15'] = { fajr: '05:00 AM', sunrise: '06:20 AM', dhuhr: '12:00 PM', asr: '03:15 PM', maghrib: '05:40 PM', isha: '07:00 PM' };
  return d;
}

test('ترتيب الأولوية: الإعلان (طارئ واعتيادي) > الأذان > التنبيه > الأذكار', () => {
  assert.ok(PRIORITY.emergencyAd < PRIORITY.adhan);
  assert.ok(PRIORITY.ad < PRIORITY.adhan);
  assert.ok(PRIORITY.adhan < PRIORITY.preadhan);
  assert.ok(PRIORITY.preadhan < PRIORITY.azkar);
});

test('التنبيه قبل الأذان: يُخطَّط قبل كل أذان مفعّل بعدد الدقائق وبمستوى صوت مستقل', () => {
  const d = makeDb();
  d.prayers.find((p) => p.key === 'asr').preAdhan.minutesBefore = 7;
  d.prayers.find((p) => p.key === 'maghrib').enabled = false;          // أذان معطّل ← لا تنبيه
  d.prayers.find((p) => p.key === 'isha').preAdhan.enabled = false;    // تنبيه معطّل
  const ev = planDay(d, new Date(2026, 9, 15));
  const pre = ev.filter((e) => e.type === 'preadhan');
  assert.deepStrictEqual(pre.map((e) => e.refId).sort(), ['asr', 'dhuhr', 'fajr']);
  const asr = pre.find((e) => e.refId === 'asr');
  assert.strictEqual(T.formatDateTime12(asr.at, false), '03:08 PM');
  assert.strictEqual(asr.volumeClass, 'preadhan');
  assert.strictEqual(asr.priority, PRIORITY.preadhan);
  assert.strictEqual(ev.find((e) => e.id.endsWith('|adhan|dhuhr')).volumeClass, 'adhan');
});

test('التنبيه قبل الأذان: تنبيه واضح عند غياب الملف أو فقدانه', () => {
  const d = makeDb();
  d.prayers.find((p) => p.key === 'dhuhr').preAdhan.audio = null;
  d.prayers.find((p) => p.key === 'isha').enabled = false;
  d.prayers.find((p) => p.key === 'isha').preAdhan.audio = null; // الأذان معطّل ← لا يُبلَّغ
  const issues = preAdhanIssues(d, (rel) => !rel.includes('asr'));
  assert.deepStrictEqual(issues.map((i) => [i.key, i.problem]), [['dhuhr', 'no-file'], ['asr', 'missing']]);
  assert.ok(issues[0].text.includes('لم يُحدَّد'));
});

test('التعارض يُحسب حسب الأولوية الجديدة (الإعلان يتقدّم على الأذان)', () => {
  const d = makeDb();
  d.ads.push({ id: 'a1', name: 'عرض', audio: 'library/ads/a.mp3', playTime: '12:00 PM', enabled: true, priority: 'normal', repeatCount: 1, repeatIntervalSeconds: 0 });
  const ev = planDay(d, new Date(2026, 9, 15));
  const c = findConflicts(ev, { 'library/adhan/dhuhr.mp3': 180, 'library/ads/a.mp3': 30 });
  assert.ok(c.some((x) => x.eventId.endsWith('|adhan|dhuhr') && x.withId.endsWith('|ad|a1')), 'الأذان هو الذي يُؤجَّل');
  assert.ok(!c.some((x) => x.eventId.endsWith('|ad|a1')), 'الإعلان لا يُؤجَّل لأحد');
});

test('مستويات الصوت: مستقلة، والمستوى العام يضرب في الجميع، والكتم مستقل لكل نوع', () => {
  const s = defaultDb().settings;
  Object.assign(s.volume, { master: 0.5, ads: 0.8, adhan: 1, preadhan: 0.4, azkar: 0.6, background: 0.3 });
  assert.strictEqual(V.effective(s, 'ads'), 0.4);
  assert.strictEqual(V.effective(s, 'preadhan'), 0.2);
  s.mute.azkar = true;
  assert.strictEqual(V.effective(s, 'azkar'), 0);
  assert.strictEqual(V.effective(s, 'adhan'), 0.5, 'كتم نوع لا يؤثر على غيره');
  s.mute.master = true;
  for (const c of V.CLASSES) assert.strictEqual(V.effective(s, c), 0);
});

// ───── منسّق التشغيل مع محرك صوت وهمي ─────
function harness() {
  const data = makeDb();
  const db = { get: () => data, update: (fn) => fn(data), on() {} };
  const logger = { info() {}, warn() {}, error() {}, log() {} };
  const calls = [];
  const audio = new EventEmitter();
  let playing = null;
  audio.call = async (cmd, args) => {
    calls.push({ cmd, ...args });
    if (cmd === 'play') { playing = { token: args.token, t0: Date.now() - (args.startAt || 0) * 1000 }; return { duration: 60 }; }
    if (cmd === 'stop') { const position = playing ? (Date.now() - playing.t0) / 1000 : 0; playing = null; return { position }; }
    return true;
  };
  const bg = { events: [], level: [] };
  const background = {
    browser: { setMuted: (m) => bg.events.push('browserMuted:' + m) },
    duckFor: async (o) => bg.events.push(o.pause ? 'pause' : 'duck'),
    restore: async () => bg.events.push('restore'),
    applyLevel: async () => bg.level.push(V.effective(data.settings, 'background')),
  };
  const playback = new Playback({ db, logger, audio, background, clock: { now: () => new Date() } });
  const finish = () => { const t = playing.token; playing = null; audio.emit('ended', { channel: 'priority', token: t }); };
  const job = (type, priority, extra = {}) => ({
    id: `2026-10-15|${type}|${extra.refId || type}`, type, priority, label: type, audio: `library/${type}.mp3`, refId: type,
    repeatCount: 1, repeatIntervalSeconds: 0, windowClass: 'ads', volumeClass: { ad: 'ads', adhan: 'adhan', preadhan: 'preadhan', azkar: 'azkar' }[type], sec: 0, ...extra,
  });
  return { data, playback, calls, bg, finish, job, plays: () => calls.filter((c) => c.cmd === 'play') };
}
const until = async (fn, ms = 2000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); } };

test('الإعلان يقاطع الأذان والتنبيه والأذكار، وكل صوت متوقف يُستأنف من موضعه بعده', async () => {
  for (const [type, prio] of [['adhan', PRIORITY.adhan], ['preadhan', PRIORITY.preadhan], ['azkar', PRIORITY.azkar]]) {
    const H = harness();
    H.playback.enqueue(H.job(type, prio));
    await until(() => H.playback.phase === 'playing');
    await new Promise((r) => setTimeout(r, 1200)); // موضع ~1.2 ثانية
    H.playback.enqueue(H.job('ad', PRIORITY.ad));
    await until(() => H.playback.phase === 'playing' && H.playback.current.job.type === 'ad');
    assert.ok(H.calls.some((c) => c.cmd === 'stop'), `${type}: أُوقف مؤقتاً`);
    H.finish();
    await until(() => H.plays().length === 3);
    const resumed = H.plays()[2];
    assert.ok(resumed.url.includes(type), `${type}: يُستأنف بعد الإعلان`);
    assert.ok(resumed.startAt > 0, `${type}: من موضعه (${resumed.startAt})`);
    H.finish();
    await until(() => H.playback.phase === 'idle');
    assert.deepStrictEqual(H.bg.events.filter((e) => e !== 'browserMuted:false'), ['pause', 'restore'], `${type}: المتصفح يتوقف مرة واحدة ويُستأنف في النهاية`);
  }
});

test('ترتيب الطابور: الإعلان ثم الأذان ثم التنبيه ثم الأذكار', async () => {
  const H = harness();
  H.playback.enqueue(H.job('azkar', PRIORITY.azkar));
  H.playback.enqueue(H.job('preadhan', PRIORITY.preadhan, { refId: 'asr', id: '2026-10-15|preadhan|asr' }));
  H.playback.enqueue(H.job('adhan', PRIORITY.adhan, { refId: 'dhuhr', id: '2026-10-15|adhan|dhuhr' }));
  H.playback.enqueue(H.job('ad', PRIORITY.emergencyAd));
  // كل مقطع يُنهى عند بدئه حتى يفرغ الطابور
  let last = null;
  for (;;) {
    await until(() => (H.playback.phase === 'idle' && !H.playback.queue.length) || (H.playback.phase === 'playing' && H.playback.current.token !== last));
    if (H.playback.phase === 'idle') break;
    last = H.playback.current.token;
    await new Promise((r) => setTimeout(r, 30));
    H.finish();
  }
  const order = H.plays().map((p) => p.url.match(/library\/(\w+)/)[1]);
  assert.strictEqual(order[order.length - 4], 'ad');
  assert.deepStrictEqual(order.slice(-3), ['adhan', 'preadhan', 'azkar']);
});

test('بدء الأذان يُلغي ما تبقّى من تنبيهه (لا يُستأنف التنبيه بعد الأذان)', async () => {
  const H = harness();
  H.playback.enqueue(H.job('preadhan', PRIORITY.preadhan, { refId: 'asr', id: '2026-10-15|preadhan|asr' }));
  await until(() => H.playback.phase === 'playing');
  H.playback.enqueue(H.job('adhan', PRIORITY.adhan, { refId: 'asr', id: '2026-10-15|adhan|asr' }));
  await until(() => H.playback.current?.job.type === 'adhan' && H.playback.phase === 'playing');
  H.finish();
  await until(() => H.playback.phase === 'idle');
  assert.deepStrictEqual(H.plays().map((p) => p.url.match(/library\/(\w+)/)[1]), ['preadhan', 'adhan']);
});

test('تغيير المستوى أو الكتم ينعكس فوراً على الصوت الجاري دون إيقاف أو استئناف الخلفية', async () => {
  const H = harness();
  H.data.settings.volume.master = 1;
  H.playback.enqueue(H.job('adhan', PRIORITY.adhan));
  await until(() => H.playback.phase === 'playing');
  const bgBefore = H.bg.events.length;
  await H.playback.setClassVolume('adhan', 0.3);
  assert.strictEqual(H.calls.at(-1).cmd, 'setVolume');
  assert.strictEqual(H.calls.at(-1).volume, 0.3);
  await H.playback.setClassVolume('ads', 0.9); // نوع آخر لا يغيّر الأذان
  assert.strictEqual(H.calls.at(-1).volume, 0.3);
  await H.playback.setClassMuted('adhan', true);
  assert.strictEqual(H.calls.at(-1).volume, 0);
  await H.playback.setClassMuted('adhan', false);
  await H.playback.setClassVolume('master', 0.5);
  assert.strictEqual(H.calls.at(-1).volume, 0.15);
  await H.playback.setClassMuted('background', true);
  assert.ok(H.bg.events.includes('browserMuted:true'));
  assert.strictEqual(H.bg.level.at(-1), 0);
  assert.deepStrictEqual(H.bg.events.slice(bgBefore).filter((e) => !e.startsWith('browserMuted')), [], 'لا خفض/استئناف إضافي للخلفية');
  assert.strictEqual(H.playback.current.job.type, 'adhan', 'الأولوية لم تتغير');
  assert.strictEqual(H.data.settings.volume.adhan, 0.3, 'محفوظ في الإعدادات');
  assert.strictEqual(H.data.settings.mute.background, true);
  H.finish();
  await until(() => H.playback.phase === 'idle');
});

test('الكتم والمستويات تُستعاد من الملف المحفوظ (والتنبيه يرث مستوى الأذان في البيانات القديمة)', () => {
  const { Db } = require('../src/main/db');
  const file = path.join(process.env.ALFAJR_DATA_DIR, 'old.json');
  const old = defaultDb();
  delete old.settings.mute;
  delete old.settings.volume.preadhan;
  old.settings.volume.adhan = 0.85;
  fs.writeFileSync(file, JSON.stringify(old));
  const db = new Db(file).load();
  assert.strictEqual(db.get().settings.volume.preadhan, 0.85);
  assert.strictEqual(db.get().settings.mute.master, false);
  db.update((d) => { d.settings.mute.ads = true; d.settings.volume.azkar = 0.25; }, { immediate: true });
  const again = new Db(file).load().get().settings;
  assert.strictEqual(again.mute.ads, true);
  assert.strictEqual(again.volume.azkar, 0.25);
});
