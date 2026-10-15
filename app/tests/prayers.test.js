'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const T = require('../src/shared/time12');
const prayers = require('../src/main/prayers');

const PKG = path.join(__dirname, '..', 'resources', 'migration', 'AlfajrRadio_Migration');

test('CSV: 366 يوماً و9 أكتوبر يطابق معيار القبول', () => {
  const r = prayers.parseCsvFile(path.join(PKG, 'data', 'prayer-times.csv'));
  assert.strictEqual(r.count, 366);
  assert.deepStrictEqual(r.table['10-9'], {
    fajr: '04:45 AM', sunrise: '06:06 AM', dhuhr: '11:59 AM', asr: '03:15 PM', maghrib: '05:44 PM', isha: '06:59 PM',
  });
  assert.deepStrictEqual(r.warnings, []);
});

for (const f of ['prayer_times_monthly_12_sheets.xlsx', 'ramadi_2021_single_sheet.xlsx']) {
  test(`Excel ${f}: التصحيح يطابق CSV لكل أيام السنة`, async () => {
    const csv = prayers.parseCsvFile(path.join(PKG, 'data', 'prayer-times.csv'));
    const x = await prayers.parseExcelFile(path.join(PKG, 'legacy', 'excel', f));
    assert.strictEqual(x.count, 366);
    assert.ok(x.skipped >= 6, 'صفوف الحشو تُتجاهل');
    assert.deepStrictEqual(x.table, csv.table);
    assert.deepStrictEqual(x.warnings, []);
  });
}

test('قاعدة التصحيح', () => {
  assert.strictEqual(T.format12(prayers.correctAmPm('asr', 2, 55)), '02:55 PM');
  assert.strictEqual(T.format12(prayers.correctAmPm('dhuhr', 11, 56)), '11:56 AM');
  assert.strictEqual(T.format12(prayers.correctAmPm('dhuhr', 12, 26)), '12:26 PM');
  assert.strictEqual(T.format12(prayers.correctAmPm('fajr', 4, 45)), '04:45 AM');
  assert.strictEqual(T.format12(prayers.correctAmPm('isha', 8, 57)), '08:57 PM');
  assert.strictEqual(T.format12(prayers.correctAmPm('isha', 20, 57)), '08:57 PM');
});

test('التحقق يكتشف ترتيباً غير منطقي', () => {
  const w = prayers.validateDay(1, 1, { fajr: T.parse12('05:00 AM'), sunrise: T.parse12('06:30 AM'), dhuhr: T.parse12('12:00 PM'),
    asr: T.parse12('02:55 AM'), maghrib: T.parse12('05:00 PM'), isha: T.parse12('06:30 PM') });
  assert.ok(w.some((s) => s.includes('العصر')));
});

test('getDayTimes مع التقديم والتعديل اليدوي', () => {
  const csv = prayers.parseCsvFile(path.join(PKG, 'data', 'prayer-times.csv'));
  const db = { prayerTimes: csv.table, prayerTimeOverrides: { '10-9': { asr: '03:20 PM' } }, prayerOffsets: { dhuhr: 2 } };
  const r = prayers.getDayTimes(db, new Date(2026, 9, 9, 15, 0));
  assert.strictEqual(T.format12(r.secs.dhuhr), '12:01 PM');
  assert.strictEqual(T.format12(r.secs.asr), '03:20 PM');
  assert.strictEqual(T.format12(r.secs.fajr), '04:45 AM');
  const feb = prayers.getDayTimes(db, new Date(2027, 1, 28));
  assert.ok(feb.secs.fajr > 0);
});
