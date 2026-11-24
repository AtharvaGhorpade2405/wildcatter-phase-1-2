// Manufacturing calculations: potency/LOD-adjusted dispensing, API consumption, QC spec evaluation.

const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * Potency & Loss-on-Drying adjusted dispensing quantity.
 * Actual = Theoretical x (100 / Assay%) x (100 / (100 - LOD%))
 */
function dispensingQty({ theoreticalKg, assayPct, lodPct }) {
  const t = Number(theoreticalKg), a = Number(assayPct), l = Number(lodPct);
  if (!(t > 0)) throw new Error('theoreticalKg must be > 0');
  if (!(a > 0 && a <= 100)) throw new Error('assayPct must be in (0, 100]');
  if (!(l >= 0 && l < 100)) throw new Error('lodPct must be in [0, 100)');
  const potencyFactor = 100 / a;
  const lodFactor = 100 / (100 - l);
  const actualKg = t * potencyFactor * lodFactor;
  return {
    theoreticalKg: round(t),
    assayPct: a,
    lodPct: l,
    potencyFactor: round(potencyFactor, 5),
    lodFactor: round(lodFactor, 5),
    actualKg: round(actualKg),
    overageKg: round(actualKg - t),
    formula: 'Actual = Theoretical x (100/Assay) x (100/(100-LOD))',
  };
}

/** kg of API needed for `packs` packs of `packSize` units at `strengthMg` each. */
function apiConsumptionKg(packs, packSize, strengthMg) {
  return round((packs * packSize * strengthMg) / 1e6, 4);
}

/** Generic API release specification (IP/USP/BP/EP harmonised demo spec). */
const API_SPEC = {
  assay: { label: 'Assay (HPLC, % dried basis)', min: 98.0, max: 102.0, unit: '%' },
  lod: { label: 'Loss on Drying', min: 0, max: 0.5, unit: '%' },
  totalImpurities: { label: 'Total impurities (HPLC)', min: 0, max: 1.0, unit: '%' },
  kfWater: { label: 'Water (Karl Fischer)', min: 0, max: 0.5, unit: '%' },
};

/** Evaluate QC results against spec. Returns per-test pass/fail and an overall verdict. */
function evaluateQc(results, spec = API_SPEC) {
  const tests = Object.entries(spec).map(([key, s]) => {
    const value = results[key];
    const present = value !== undefined && value !== null && value !== '' && !Number.isNaN(Number(value));
    const v = Number(value);
    const pass = present && v >= s.min && v <= s.max;
    return { key, label: s.label, value: present ? v : null, min: s.min, max: s.max, unit: s.unit, pass, missing: !present };
  });
  return { pass: tests.every((t) => t.pass), tests };
}

module.exports = { dispensingQty, apiConsumptionKg, API_SPEC, evaluateQc, round };
