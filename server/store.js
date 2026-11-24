// Tiny JSON-file persistence layer (MVP stand-in for PostgreSQL / SQLite + CRDT sync).
const fs = require('fs');
const path = require('path');

class Store {
  constructor(dataDir) {
    this.dir = dataDir;
    this.file = path.join(dataDir, 'pharmachain-db.json');
    this.db = null;
    this.listeners = new Set();
    this._timer = null;
  }

  load(seedFn) {
    if (fs.existsSync(this.file)) {
      try {
        this.db = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        return this;
      } catch (e) {
        console.warn('[store] corrupt DB file, re-seeding:', e.message);
      }
    }
    this.db = seedFn();
    this.saveNow();
    return this;
  }

  reset(seedFn) {
    this.db = seedFn();
    this.saveNow();
  }

  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.saveNow(), 400);
  }

  saveNow() {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.db));
    fs.renameSync(tmp, this.file);
  }

  nextId(prefix) {
    const c = this.db.counters;
    c[prefix] = (c[prefix] || 0) + 1;
    return `${prefix}-${String(c[prefix]).padStart(4, '0')}`;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(msg) {
    for (const fn of this.listeners) {
      try { fn(msg); } catch { /* ignore listener errors */ }
    }
  }
}

module.exports = { Store };
