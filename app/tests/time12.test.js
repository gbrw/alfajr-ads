'use strict';
const test = require('node:test');
const assert = require('node:assert');
const T = require('../src/shared/time12');

test('parse/format 12h', () => {
  assert.strictEqual(T.parse12('12:00 AM'), 0);
  assert.strictEqual(T.parse12('12:30 PM'), 12 * 3600 + 1800);
  assert.strictEqual(T.parse12('11:40 pm'), 23 * 3600 + 40 * 60);
  assert.strictEqual(T.format12(0), '12:00 AM');
  assert.strictEqual(T.format12(13 * 3600 + 5 * 60 + 9, true), '01:05:09 PM');
  assert.throws(() => T.parse12('23:40'));
  assert.throws(() => T.parse12('13:00 PM'));
  assert.strictEqual(T.normalize12('7:5 PM'.replace('7:5', '7:05')), '07:05 PM');
});

test('نافذة العمل تدعم ما بعد منتصف الليل', () => {
  const s = T.parse12('07:00 AM'), e = T.parse12('12:00 AM');
  assert.ok(T.inWindow(T.parse12('11:40 PM'), s, e));
  assert.ok(T.inWindow(T.parse12('07:00 AM'), s, e));
  assert.ok(!T.inWindow(T.parse12('04:45 AM'), s, e));
  const e2 = T.parse12('02:00 AM');
  assert.ok(T.inWindow(T.parse12('01:30 AM'), s, e2));
  assert.ok(!T.inWindow(T.parse12('03:00 AM'), s, e2));
});
