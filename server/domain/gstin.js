// GSTIN (India GST identification number) format + mod-36 checksum validation.

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const STATES = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '18': 'Assam',
  '19': 'West Bengal', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '32': 'Kerala', '33': 'Tamil Nadu', '36': 'Telangana',
  '37': 'Andhra Pradesh',
};

/** Compute the checksum character for the first 14 characters of a GSTIN. */
function checksumChar(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CHARS.indexOf(first14[i]);
    if (v < 0) throw new Error('Invalid GSTIN character');
    const product = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

function validate(gstin) {
  const g = String(gstin || '').trim().toUpperCase();
  const errors = [];
  if (!FORMAT.test(g)) errors.push('Format must be 2-digit state + 10-char PAN + entity no + Z + checksum');
  else {
    if (!STATES[g.slice(0, 2)]) errors.push(`Unknown state code ${g.slice(0, 2)}`);
    const expected = checksumChar(g.slice(0, 14));
    if (expected !== g[14]) errors.push(`Checksum mismatch (expected ${expected})`);
  }
  return {
    gstin: g,
    valid: errors.length === 0,
    errors,
    stateCode: g.slice(0, 2),
    state: STATES[g.slice(0, 2)] || null,
    pan: g.length >= 12 ? g.slice(2, 12) : null,
  };
}

/** Build a valid GSTIN from state code + PAN + entity number. */
function build(stateCode, pan, entityNo = '1') {
  const first14 = `${stateCode}${pan}${entityNo}Z`;
  return first14 + checksumChar(first14);
}

module.exports = { validate, build, checksumChar, STATES };
