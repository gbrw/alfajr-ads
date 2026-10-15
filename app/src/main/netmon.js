'use strict';
// مراقبة الاتصال بالإنترنت وتسجيل تغيّر حالته.
const { net } = require('electron');
const { EventEmitter } = require('events');

class NetMonitor extends EventEmitter {
  constructor({ logger }) {
    super();
    this.logger = logger;
    this.online = null;
    this.timer = null;
  }

  async check() {
    let ok = net.isOnline();
    if (ok) {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 6000);
        const r = await net.fetch('https://www.google.com/generate_204', { method: 'HEAD', signal: ctl.signal, cache: 'no-store' });
        clearTimeout(t);
        ok = r.status === 204 || r.ok;
      } catch { ok = false; }
    }
    if (ok !== this.online) {
      const first = this.online === null;
      this.online = ok;
      if (ok) this.logger.info('network', first ? 'الاتصال بالإنترنت: متصل' : 'عاد الاتصال بالإنترنت', { status: 'success' });
      else this.logger.warn('network', first ? 'الاتصال بالإنترنت: غير متصل' : 'انقطع الاتصال بالإنترنت', { status: 'fail' });
      this.emit('change', ok);
    }
    return ok;
  }

  start(intervalMs = 15000) {
    this.check();
    this.timer = setInterval(() => this.check(), intervalMs);
  }
}

module.exports = { NetMonitor };
