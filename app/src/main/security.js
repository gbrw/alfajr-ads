'use strict';
// حماية إعدادات المشرف بكلمة مرور (scrypt + ملح). الفتح مؤقت ويُقفل تلقائياً بعد 10 دقائق.
const crypto = require('crypto');

const UNLOCK_MS = 10 * 60 * 1000;

class Security {
  constructor({ db, logger }) {
    this.db = db;
    this.logger = logger;
    this.unlockedUntil = 0;
  }

  get sec() { return this.db.get().settings.security; }
  hasPassword() { return !!this.sec.passwordHash; }
  isUnlocked() { return !this.hasPassword() || Date.now() < this.unlockedUntil; }

  static hash(pw, salt) { return crypto.scryptSync(String(pw), salt, 32).toString('hex'); }

  verify(pw) {
    if (!this.hasPassword()) return true;
    const a = Buffer.from(Security.hash(pw, this.sec.salt), 'hex');
    const b = Buffer.from(this.sec.passwordHash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  unlock(pw) {
    if (!this.verify(pw)) {
      this.logger.warn('settings', 'محاولة دخول بكلمة مرور خاطئة', { status: 'fail' });
      return false;
    }
    this.unlockedUntil = Date.now() + UNLOCK_MS;
    return true;
  }

  lock() { this.unlockedUntil = 0; }

  /** تعيين/تغيير/إزالة كلمة المرور. يتطلب الحالية إن وُجدت. */
  setPassword(current, next) {
    if (this.hasPassword() && !this.verify(current)) throw new Error('كلمة المرور الحالية غير صحيحة');
    if (next) {
      if (String(next).length < 4) throw new Error('كلمة المرور يجب ألا تقل عن 4 أحرف');
      const salt = crypto.randomBytes(16).toString('hex');
      this.db.update((d) => { d.settings.security = { salt, passwordHash: Security.hash(next, salt) }; }, { immediate: true });
      this.unlockedUntil = Date.now() + UNLOCK_MS;
      this.logger.info('settings', 'تم تعيين كلمة مرور المشرف', { status: 'success' });
    } else {
      this.db.update((d) => { d.settings.security = { salt: null, passwordHash: null }; }, { immediate: true });
      this.logger.warn('settings', 'تمت إزالة كلمة مرور المشرف');
    }
  }

  assert() {
    if (!this.isUnlocked()) { const e = new Error('هذا الإجراء محمي بكلمة مرور المشرف'); e.code = 'LOCKED'; throw e; }
    if (this.hasPassword()) this.unlockedUntil = Date.now() + UNLOCK_MS; // تمديد عند النشاط
  }

  status() { return { hasPassword: this.hasPassword(), unlocked: this.isUnlocked() }; }
}

module.exports = { Security };
