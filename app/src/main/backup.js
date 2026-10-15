'use strict';
// النسخ الاحتياطي والاستعادة: ملف zip واحد يحتوي الإعدادات والجداول (db.json) والملفات الصوتية والإضافات المضافة.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const T = require('../shared/time12');
const { P } = require('./paths');

function defaultName(now = new Date()) {
  const t = T.formatDateTime12(now, true).replace(/:/g, '-').replace(' ', '');
  return `AlfajrBackup_${T.dateKey(now)}_${t}.zip`;
}

function createBackup(db, outFile) {
  db.saveNow();
  const zip = new AdmZip();
  zip.addLocalFile(P.db, '', 'db.json');
  if (fs.existsSync(P.library)) zip.addLocalFolder(P.library, 'library');
  if (fs.existsSync(P.userExtensions)) zip.addLocalFolder(P.userExtensions, 'extensions');
  zip.addFile('backup-info.json', Buffer.from(JSON.stringify({ app: 'Ads Alfajr Manager', createdAt: T.stamp(new Date()) }, null, 2)));
  zip.writeZip(outFile);
  return outFile;
}

/** يتحقق من النسخة ويستعيدها. الإعادة تتطلب إعادة تشغيل البرنامج بعدها. */
function restoreBackup(zipFile) {
  const zip = new AdmZip(zipFile);
  const dbEntry = zip.getEntry('db.json');
  if (!dbEntry) throw new Error('الملف المختار ليس نسخة احتياطية صالحة (db.json غير موجود)');
  const data = JSON.parse(dbEntry.getData().toString('utf8'));
  if (!data.settings || !data.prayerTimes) throw new Error('النسخة الاحتياطية تالفة أو غير مكتملة');
  // نسخة أمان من الوضع الحالي قبل الاستبدال
  const safety = path.join(P.backups, 'before-restore_' + defaultName());
  fs.mkdirSync(P.backups, { recursive: true });
  const cur = new AdmZip();
  if (fs.existsSync(P.db)) cur.addLocalFile(P.db, '', 'db.json');
  cur.writeZip(safety);

  const root = path.resolve(P.data) + path.sep;
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue;
    if (!/^(db\.json|library\/|extensions\/)/.test(e.entryName)) continue;
    const dest = path.resolve(P.data, e.entryName);
    if (!dest.startsWith(root)) continue; // حماية من مسارات خبيثة
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, e.getData());
  }
  return { safety };
}

module.exports = { createBackup, restoreBackup, defaultName };
