// First-Expiry-First-Out allocation across inventory batches.

/**
 * @param {Array} rows inventory rows {batchNo, qty, expiry, quarantined}
 * @param {number} qty quantity required
 * @param {Date} [asOf] reference date; expired stock is never allocated
 * @returns {{picks: Array<{batchNo, qty, expiry, row}>, shortfall: number}}
 */
function allocate(rows, qty, asOf = new Date()) {
  const eligible = rows
    .filter((r) => r.qty > 0 && !r.quarantined && new Date(r.expiry) > asOf)
    .sort((a, b) => new Date(a.expiry) - new Date(b.expiry));
  const picks = [];
  let remaining = qty;
  for (const row of eligible) {
    if (remaining <= 0) break;
    const take = Math.min(row.qty, remaining);
    picks.push({ batchNo: row.batchNo, qty: take, expiry: row.expiry, row });
    remaining = Math.round((remaining - take) * 1000) / 1000;
  }
  return { picks, shortfall: Math.max(0, remaining) };
}

function daysToExpiry(expiry, asOf = new Date()) {
  return Math.floor((new Date(expiry) - asOf) / 86400000);
}

function expiryBucket(expiry, asOf = new Date()) {
  const d = daysToExpiry(expiry, asOf);
  if (d < 0) return 'expired';
  if (d <= 30) return '30';
  if (d <= 60) return '60';
  if (d <= 90) return '90';
  if (d <= 180) return '180';
  return 'ok';
}

module.exports = { allocate, daysToExpiry, expiryBucket };
