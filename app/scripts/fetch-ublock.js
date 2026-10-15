'use strict';
/*
 * ينزّل uBlock Origin (النسخة الكاملة MV2) من المستودعات الرسمية على GitHub
 * ويفكّهما (unpacked) داخل resources/extensions ليُضمَّنا في حزمة التطبيق.
 * الاستخدام: node scripts/fetch-ublock.js
 */
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const OUT = path.join(__dirname, '..', 'resources', 'extensions');
const SOURCES = [
  { dir: 'ublock-origin', repo: 'gorhill/uBlock', match: /^uBlock0_.*\.chromium\.zip$/ },
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const s of SOURCES) {
    const rel = await (await fetch(`https://api.github.com/repos/${s.repo}/releases/latest`, { headers: { 'User-Agent': 'alfajr-build' } })).json();
    const asset = rel.assets.find((a) => s.match.test(a.name));
    if (!asset) throw new Error('لم يُعثر على ملف الإصدار في ' + s.repo);
    console.log(`تنزيل ${asset.name} ...`);
    const buf = Buffer.from(await (await fetch(asset.browser_download_url)).arrayBuffer());
    const zip = new AdmZip(buf);
    const target = path.join(OUT, s.dir);
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    // بعض الحزم تحتوي مجلداً جذرياً واحداً (uBlock0.chromium/)
    const entries = zip.getEntries();
    const roots = new Set(entries.map((e) => e.entryName.split('/')[0]));
    const strip = roots.size === 1 && entries.every((e) => e.entryName.includes('/')) ? [...roots][0] + '/' : '';
    for (const e of entries) {
      if (e.isDirectory) continue;
      const name = strip && e.entryName.startsWith(strip) ? e.entryName.slice(strip.length) : e.entryName;
      const dest = path.join(target, name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, e.getData());
    }
    fs.writeFileSync(path.join(target, '.alfajr-source.json'), JSON.stringify({ repo: s.repo, tag: rel.tag_name, asset: asset.name, fetchedAt: new Date().toISOString() }, null, 2));
    const manifest = JSON.parse(fs.readFileSync(path.join(target, 'manifest.json'), 'utf8'));
    console.log(`  ✓ ${manifest.name} ${manifest.version} (MV${manifest.manifest_version}) → ${target}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
