# Ads Alfajr Manager 2.0

تطبيق سطح مكتب (Electron 44) لإدارة الإذاعة الداخلية في الفجر هايبر ماركت — بديل ADSManager القديم.
دليل المشرف بالعربي: [docs/دليل-المستخدم.md](docs/دليل-المستخدم.md)

## التشغيل والبناء

```bash
npm install
npm start                # تشغيل للتطوير
npm test                 # اختبارات المنطق (المواقيت، تصحيح Excel، المخطِّط، الترحيل، الأولوية والأصوات)
npm run dist             # بناء ملف التثبيت dist/AdsAlfajrManager-Setup-<version>.exe
```

تحديث الموارد المرفقة (اختياري قبل البناء):

```bash
npm run fetch:ublock     # تنزيل uBlock Origin الرسمي غير مضغوط ← resources/extensions
npm run build:adblock    # بناء قوائم الفلترة مسبقاً ← resources/adblock/engine.bin
npm run make:icons       # توليد الأيقونات ← build/
```

## البنية

| المسار | الوظيفة |
|---|---|
| `src/shared/time12.js` | كل تحويلات الوقت — نظام 12 ساعة فقط |
| `src/main/db.js` | قاعدة بيانات JSON بكتابة ذرّية ونسخة احتياطية تلقائية |
| `src/main/migration.js` | استيراد حزمة `AlfajrRadio_Migration` عند أول تشغيل |
| `src/main/prayers.js` | جدول السنة، استيراد Excel/CSV مع تصحيح AM/PM، أوقات اليوم مع التعديلات |
| `src/main/planner.js` | خطة أحداث اليوم (منطق صافٍ قابل للاختبار) والأولويات ونافذة ساعات العمل |
| `src/main/scheduler.js` | نبضة 250ms، بدء مبكر ليبدأ الصوت بالثانية الصحيحة، مهلة الأحداث الفائتة |
| `src/main/volume.js` | مستويات الصوت والكتم المستقل لكل نوع (منطق صافٍ) |
| `src/main/playback.js` | تسلسل الإيقاف/الصمت/التشغيل/الاستئناف، المقاطعة حسب الأولوية، تكرار الإعلانات |
| `src/main/background.js` | توحيد مصدري الخلفية، التحويل عند انقطاع الإنترنت، منع التشغيل خارج الساعات |
| `src/main/browser.js` | المتصفح المدمج + سكربت التحكم بصوت عناصر الصفحة |
| `src/main/adblock.js`, `extensions.js` | المانع المدمج (Ghostery/EasyList) + تحميل الإضافات + الاختبار الذاتي |
| `src/renderer/` | الواجهة العربية RTL (بدون إطار عمل) + `audio.html` محرك الصوت المخفي |
| `scripts/harness/` | أدوات اختبار تشغيلي (`ALFAJR_TEST_SCRIPT`) مع ساعة مزاحة (`ALFAJR_FAKE_NOW`)، منها `priority-volume.js` (الأولوية ولوحة الأصوات) و`signin.js` (حفظ جلسة الدخول) |

متغيرات بيئة للتطوير فقط (تُتجاهل في النسخة المثبتة ما عدا `ALFAJR_DATA_DIR`):
`ALFAJR_DATA_DIR` مجلد بيانات بديل، `ALFAJR_FAKE_NOW` إزاحة الساعة، `ALFAJR_TEST_SCRIPT` سكربت اختبار، `ALFAJR_LOG_STDOUT` طباعة السجل.
