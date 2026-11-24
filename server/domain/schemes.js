// Indian wholesale trade-scheme + GST engine.
// Scheme shapes:
//   { type: 'free', buy: 10, free: 1 }                       -> 10+1 free
//   { type: 'free', buy: 5, free: 1, cdPct: 2 }              -> 5+1 free + 2% cash discount
//   { type: 'slab', slabs: [{ minQty: 50, pct: 5 }, ...] }   -> quantity slab trade discount
//   { type: 'cd', cdPct: 3 }                                 -> flat cash discount
//   null                                                     -> no scheme

const r2 = (n) => Math.round(n * 100) / 100;

function freeQty(qty, scheme) {
  if (!scheme || scheme.type !== 'free') return 0;
  return Math.floor(qty / scheme.buy) * scheme.free;
}

function slabPct(qty, scheme) {
  if (!scheme || scheme.type !== 'slab') return 0;
  let pct = 0;
  for (const s of [...scheme.slabs].sort((a, b) => a.minQty - b.minQty)) if (qty >= s.minQty) pct = s.pct;
  return pct;
}

function describe(scheme) {
  if (!scheme) return 'No scheme';
  if (scheme.type === 'free') return `${scheme.buy}+${scheme.free} Free${scheme.cdPct ? ` + ${scheme.cdPct}% CD` : ''}`;
  if (scheme.type === 'slab') return 'Slab: ' + scheme.slabs.map((s) => `${s.minQty}+ → ${s.pct}%`).join(', ');
  if (scheme.type === 'cd') return `${scheme.cdPct}% CD`;
  return 'Custom';
}

/**
 * Price one invoice line.
 * @param {object} p { qty, rate, gstPct, scheme, interState }
 */
function priceLine({ qty, rate, gstPct, scheme = null, interState = false }) {
  if (!(qty > 0)) throw new Error('qty must be > 0');
  const free = freeQty(qty, scheme);
  const gross = r2(qty * rate);
  const tdPct = slabPct(qty, scheme);
  const tradeDiscount = r2((gross * tdPct) / 100);
  const afterTd = gross - tradeDiscount;
  const cdPct = scheme && scheme.cdPct ? scheme.cdPct : 0;
  const cashDiscount = r2((afterTd * cdPct) / 100);
  const taxable = r2(afterTd - cashDiscount);
  const gst = r2((taxable * gstPct) / 100);
  const half = r2(gst / 2);
  return {
    qty,
    free,
    billedQty: qty,
    totalQty: qty + free,
    rate,
    gross,
    tradeDiscountPct: tdPct,
    tradeDiscount,
    cashDiscountPct: cdPct,
    cashDiscount,
    taxable,
    gstPct,
    cgst: interState ? 0 : half,
    sgst: interState ? 0 : r2(gst - half),
    igst: interState ? gst : 0,
    gst,
    total: r2(taxable + gst),
    freeGoodsValue: r2(free * rate), // recoverable from manufacturer via claim debit note
    effectiveRate: r2(taxable / (qty + free)),
    scheme: describe(scheme),
  };
}

function totals(lines) {
  const sum = (k) => r2(lines.reduce((s, l) => s + l[k], 0));
  return {
    gross: sum('gross'),
    tradeDiscount: sum('tradeDiscount'),
    cashDiscount: sum('cashDiscount'),
    taxable: sum('taxable'),
    cgst: sum('cgst'),
    sgst: sum('sgst'),
    igst: sum('igst'),
    gst: sum('gst'),
    total: sum('total'),
    freeGoodsValue: sum('freeGoodsValue'),
  };
}

/** Split a GST-inclusive retail amount (MRP basis) into taxable + GST. */
function splitInclusive(amount, gstPct) {
  const taxable = r2(amount / (1 + gstPct / 100));
  return { taxable, gst: r2(amount - taxable), amount: r2(amount) };
}

module.exports = { priceLine, totals, freeQty, slabPct, describe, splitInclusive, r2 };
