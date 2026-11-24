// GS1 identifiers: GTIN / SSCC check digits, SGTIN element strings (GS1-128 / DataMatrix / Schedule H2 QR payload)

/** GS1 mod-10 check digit for a numeric string WITHOUT its check digit. */
function checkDigit(digits) {
  if (!/^\d+$/.test(digits)) throw new Error('GS1 data must be numeric');
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const d = Number(digits[digits.length - 1 - i]);
    sum += d * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

function isValidGs1Number(full) {
  if (!/^\d{8,18}$/.test(full)) return false;
  return checkDigit(full.slice(0, -1)) === Number(full.slice(-1));
}

/** Build a GTIN-13 from a 12-digit body. */
function makeGtin13(body12) {
  return body12 + checkDigit(body12);
}

/** SSCC-18: extension digit + company prefix + serial reference (17 digits total) + check digit. */
function makeSscc(companyPrefix, serialRef, extension = 0) {
  const refLen = 16 - companyPrefix.length;
  const body = String(extension) + companyPrefix + String(serialRef).padStart(refLen, '0').slice(-refLen);
  return body + checkDigit(body);
}

function yymmdd(dateIso) {
  const d = new Date(dateIso);
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getUTCFullYear() % 100) + p(d.getUTCMonth() + 1) + p(d.getUTCDate());
}

/** Human-readable GS1 element string for a serialized pack (SGTIN + batch + expiry). */
function sgtinElementString(gtin13, serial, batchNo, expiryIso) {
  const gtin14 = gtin13.padStart(14, '0');
  return `(01)${gtin14}(21)${serial}(10)${batchNo}(17)${yymmdd(expiryIso)}`;
}

/** Parse a parenthesised GS1 element string into its AIs. */
function parseElementString(str) {
  const out = {};
  const re = /\((\d{2,4})\)([^(]+)/g;
  let m;
  while ((m = re.exec(String(str).trim()))) out[m[1]] = m[2].trim();
  return {
    gtin14: out['01'] || null,
    gtin13: out['01'] ? out['01'].replace(/^0/, '') : null,
    serial: out['21'] || null,
    batchNo: out['10'] || null,
    expiry: out['17'] || null,
    sscc: out['00'] || null,
    raw: out,
  };
}

module.exports = { checkDigit, isValidGs1Number, makeGtin13, makeSscc, sgtinElementString, parseElementString, yymmdd };
