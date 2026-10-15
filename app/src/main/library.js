'use strict';
/*
 * مكتبة الصوتيات: أي ملف يختاره المشرف من أي مكان يُنسخ إلى مجلد التطبيق ويُخزَّن بمسار نسبي.
 * الأسماء تُختصر وتُنظَّف (الأسماء العربية الطويلة سببت مشاكل حفظ في النظام القديم).
 */
const fs = require('fs');
const path = require('path');
const { P, toDataRelative, resolveData, LIBRARY_CATEGORIES } = require('./paths');

const AUDIO_EXT = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.opus', '.webm'];

function safeBase(name) {
  const ext = path.extname(name).toLowerCase();
  let base = path.basename(name, path.extname(name))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 40)
    .replace(/^[._]+|[._]+$/g, '');
  if (!base) base = 'audio';
  return { base, ext };
}

function importFile(src, category) {
  if (!LIBRARY_CATEGORIES.includes(category)) throw new Error('فئة غير معروفة: ' + category);
  if (!fs.existsSync(src)) throw new Error('الملف الصوتي غير موجود');
  const { base, ext } = safeBase(path.basename(src));
  if (!AUDIO_EXT.includes(ext)) throw new Error('نوع الملف غير مدعوم: ' + ext);
  const dir = path.join(P.library, category);
  fs.mkdirSync(dir, { recursive: true });
  let dest = path.join(dir, base + ext);
  // نفس الملف موجود مسبقاً بنفس الحجم ← نعيد استخدامه
  if (fs.existsSync(dest) && fs.statSync(dest).size === fs.statSync(src).size) return toDataRelative(dest);
  for (let i = 2; fs.existsSync(dest); i++) dest = path.join(dir, `${base}_${i}${ext}`);
  fs.copyFileSync(src, dest);
  return toDataRelative(dest);
}

function exists(rel) {
  try { return !!rel && fs.existsSync(resolveData(rel)); } catch { return false; }
}

/** حذف ملفات المكتبة غير المستخدمة في أي مكان من قاعدة البيانات. */
function unusedFiles(db) {
  const used = new Set(JSON.stringify(db).match(/library\/[^"]+/g) || []);
  const out = [];
  for (const c of LIBRARY_CATEGORIES) {
    const dir = path.join(P.library, c);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const rel = `library/${c}/${f}`;
      if (!used.has(rel)) out.push(rel);
    }
  }
  return out;
}

module.exports = { importFile, exists, unusedFiles, AUDIO_EXT };
