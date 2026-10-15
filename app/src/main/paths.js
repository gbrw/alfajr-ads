'use strict';
// كل المسارات نسبية لمجلد بيانات التطبيق أو لمجلد موارد البرنامج — لا مسارات مطلقة مثبتة.
const path = require('path');
const fs = require('fs');

let electronApp = null;
try { electronApp = require('electron').app; } catch { /* يعمل أيضاً خارج Electron في الاختبارات */ }

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function dataDir() {
  if (process.env.ALFAJR_DATA_DIR) return path.resolve(process.env.ALFAJR_DATA_DIR);
  if (electronApp && typeof electronApp.getPath === 'function') return electronApp.getPath('userData');
  return path.join(PROJECT_ROOT, '.data');
}

/** مجلد الموارد المرافقة (الإضافات، قوائم الفلترة، حزمة الترحيل). */
function resourcesDir() {
  if (electronApp && electronApp.isPackaged) return path.join(process.resourcesPath, 'bundled');
  return path.join(PROJECT_ROOT, 'resources');
}

const LIBRARY_CATEGORIES = ['adhan', 'pre-adhan', 'azkar', 'ads', 'background'];

const P = {
  get data() { return dataDir(); },
  get db() { return path.join(dataDir(), 'db.json'); },
  get library() { return path.join(dataDir(), 'library'); },
  get logs() { return path.join(dataDir(), 'logs'); },
  get backups() { return path.join(dataDir(), 'backups'); },
  get adblockCache() { return path.join(dataDir(), 'adblock'); },
  get userExtensions() { return path.join(dataDir(), 'extensions'); },
  get resources() { return resourcesDir(); },
  get bundledExtensions() { return path.join(resourcesDir(), 'extensions'); },
  get bundledMigration() { return path.join(resourcesDir(), 'migration', 'AlfajrRadio_Migration'); },
  get bundledAdblock() { return path.join(resourcesDir(), 'adblock'); },
};

function ensureDirs() {
  for (const d of [P.data, P.library, P.logs, P.backups, P.adblockCache, P.userExtensions]) {
    fs.mkdirSync(d, { recursive: true });
  }
  for (const c of LIBRARY_CATEGORIES) fs.mkdirSync(path.join(P.library, c), { recursive: true });
}

/** مسار نسبي مخزّن (مثل library/ads/x.wav) ← مسار كامل. يرفض الخروج من مجلد البيانات. */
function resolveData(rel) {
  if (!rel) return null;
  const full = path.resolve(P.data, rel);
  const root = path.resolve(P.data) + path.sep;
  if (!full.startsWith(root)) throw new Error('مسار خارج مجلد البيانات: ' + rel);
  return full;
}

function toDataRelative(full) {
  return path.relative(P.data, full).split(path.sep).join('/');
}

module.exports = { P, ensureDirs, resolveData, toDataRelative, LIBRARY_CATEGORIES, PROJECT_ROOT };
