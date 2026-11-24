// Cold-chain: Mean Kinetic Temperature (USP <1079>) and excursion evaluation.

const DH_OVER_R = 10000; // ΔH/R in Kelvin (ΔH = 83.144 kJ/mol, R = 8.3144 J/mol·K)

/** Mean Kinetic Temperature in °C for a list of °C readings (equal intervals). */
function mkt(tempsC) {
  if (!tempsC || tempsC.length === 0) return null;
  const sum = tempsC.reduce((s, t) => s + Math.exp(-DH_OVER_R / (Number(t) + 273.15)), 0);
  const tk = DH_OVER_R / -Math.log(sum / tempsC.length);
  return Math.round((tk - 273.15) * 100) / 100;
}

/**
 * Evaluate readings against a storage range.
 * - red   : MKT outside range  -> automatic quarantine
 * - amber : at least one reading outside range but MKT within range (transient excursion)
 * - green : all readings within range
 */
function evaluate(tempsC, range = { min: 2, max: 8 }) {
  const value = mkt(tempsC);
  if (value === null) return { mkt: null, signal: 'green', excursions: 0, quarantine: false };
  const excursions = tempsC.filter((t) => t < range.min || t > range.max).length;
  const mktOut = value < range.min || value > range.max;
  return {
    mkt: value,
    min: Math.min(...tempsC),
    max: Math.max(...tempsC),
    readings: tempsC.length,
    excursions,
    signal: mktOut ? 'red' : excursions > 0 ? 'amber' : 'green',
    quarantine: mktOut,
  };
}

module.exports = { mkt, evaluate };
