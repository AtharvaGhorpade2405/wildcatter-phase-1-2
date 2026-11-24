// ALCOA+ style append-only audit trail, hash-chained (tamper-evident) - 21 CFR Part 11 inspired.
const crypto = require('crypto');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hashRecord(rec) {
  const { hash, ...rest } = rec;
  return sha256(JSON.stringify(rest));
}

function append(log, { user, action, ref, data }) {
  const prev = log.length ? log[log.length - 1] : null;
  const rec = {
    seq: prev ? prev.seq + 1 : 1,
    ts: new Date().toISOString(),
    user: user || 'system',
    action,
    ref: ref || null,
    data: data === undefined ? null : data,
    prevHash: prev ? prev.hash : '0'.repeat(64),
  };
  rec.hash = hashRecord(rec);
  log.push(rec);
  return rec;
}

/** Recompute the chain; returns the first broken record if any. */
function verify(log) {
  for (let i = 0; i < log.length; i++) {
    const rec = log[i];
    const expectedPrev = i === 0 ? '0'.repeat(64) : log[i - 1].hash;
    if (rec.prevHash !== expectedPrev) return { valid: false, brokenAt: rec.seq, reason: 'prevHash link broken', records: log.length };
    if (hashRecord(rec) !== rec.hash) return { valid: false, brokenAt: rec.seq, reason: 'record content altered', records: log.length };
  }
  return { valid: true, records: log.length, head: log.length ? log[log.length - 1].hash : null };
}

module.exports = { append, verify, sha256 };
