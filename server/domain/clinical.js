// Clinical decision support (demo knowledge base, NOT for real clinical use):
// drug-drug interactions, duplicate therapy, allergy, pregnancy and paediatric checks.

const INTERACTIONS = [
  { a: 'Warfarin', b: 'Aspirin', severity: 'major', effect: 'Additive bleeding risk; monitor INR or avoid combination.' },
  { a: 'Warfarin', b: 'Clopidogrel', severity: 'major', effect: 'Significantly increased bleeding risk.' },
  { a: 'Warfarin', b: 'Clarithromycin', severity: 'major', effect: 'CYP3A4 inhibition raises INR; bleeding risk.' },
  { a: 'Atorvastatin', b: 'Clarithromycin', severity: 'major', effect: 'Raised statin levels; myopathy / rhabdomyolysis risk.' },
  { a: 'Alprazolam', b: 'Clarithromycin', severity: 'major', effect: 'CYP3A4 inhibition; excessive sedation / respiratory depression.' },
  { a: 'Clopidogrel', b: 'Omeprazole', severity: 'moderate', effect: 'Reduced activation of clopidogrel (CYP2C19); prefer pantoprazole.' },
  { a: 'Aspirin', b: 'Clopidogrel', severity: 'moderate', effect: 'Increased bleeding risk; acceptable only as intended dual antiplatelet therapy.' },
  { a: 'Metformin', b: 'Clarithromycin', severity: 'minor', effect: 'Possible dysglycaemia; monitor blood glucose.' },
];

// allergy class -> salts that trigger it (with cross-reactivity notes)
const ALLERGY_MAP = {
  penicillin: { salts: ['Amoxicillin'], cross: { Cefixime: 'Low (~1-2%) cephalosporin cross-reactivity' } },
  nsaid: { salts: ['Aspirin'], cross: {} },
  macrolide: { salts: ['Clarithromycin'], cross: {} },
  sulfa: { salts: [], cross: {} },
};

const PREGNANCY_AVOID = { Warfarin: 'Teratogenic (contraindicated in pregnancy)', Atorvastatin: 'Statins contraindicated in pregnancy', Methylphenidate: 'Use only if clearly needed' };
const PAEDIATRIC = {
  Aspirin: { minAge: 16, note: "Risk of Reye's syndrome under 16 years" },
  Methylphenidate: { minAge: 6, note: 'Not recommended under 6 years' },
  Alprazolam: { minAge: 18, note: 'Safety not established under 18 years' },
};

const SEVERITY_RANK = { contraindicated: 4, major: 3, moderate: 2, minor: 1 };

/**
 * @param {Array<{id, brand, salt, drugClass}>} items products in the cart (plus current medications)
 * @param {{age?: number, allergies?: string[], pregnant?: boolean}} patient
 */
function check(items, patient = {}) {
  const alerts = [];
  const salts = items.map((p) => p.salt);

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const x = items[i], y = items[j];
      if (x.salt === y.salt) {
        alerts.push({ type: 'duplicate', severity: 'moderate', title: `Duplicate therapy: ${x.salt}`, detail: `${x.brand} and ${y.brand} contain the same molecule.`, products: [x.id, y.id] });
        continue;
      }
      if (x.drugClass && x.drugClass === y.drugClass) {
        alerts.push({ type: 'duplicate', severity: 'minor', title: `Same therapeutic class: ${x.drugClass}`, detail: `${x.brand} + ${y.brand}`, products: [x.id, y.id] });
      }
      const hit = INTERACTIONS.find((k) => (k.a === x.salt && k.b === y.salt) || (k.a === y.salt && k.b === x.salt));
      if (hit) alerts.push({ type: 'ddi', severity: hit.severity, title: `Interaction: ${x.salt} + ${y.salt}`, detail: hit.effect, products: [x.id, y.id] });
    }
  }

  for (const allergy of (patient.allergies || []).map((a) => String(a).toLowerCase().trim()).filter(Boolean)) {
    const rule = ALLERGY_MAP[allergy];
    for (const p of items) {
      if (rule && rule.salts.includes(p.salt)) alerts.push({ type: 'allergy', severity: 'contraindicated', title: `Allergy: ${allergy}`, detail: `${p.brand} (${p.salt}) belongs to the ${allergy} class.`, products: [p.id] });
      else if (rule && rule.cross[p.salt]) alerts.push({ type: 'allergy', severity: 'moderate', title: `Possible cross-allergy: ${allergy}`, detail: `${p.brand}: ${rule.cross[p.salt]}`, products: [p.id] });
      else if (!rule && p.salt.toLowerCase() === allergy) alerts.push({ type: 'allergy', severity: 'contraindicated', title: `Allergy: ${p.salt}`, detail: 'Patient is allergic to this molecule.', products: [p.id] });
    }
  }

  if (patient.pregnant) {
    for (const p of items) if (PREGNANCY_AVOID[p.salt]) alerts.push({ type: 'pregnancy', severity: p.salt === 'Methylphenidate' ? 'moderate' : 'contraindicated', title: `Pregnancy: ${p.salt}`, detail: PREGNANCY_AVOID[p.salt], products: [p.id] });
  }

  const age = Number(patient.age);
  if (patient.age !== undefined && patient.age !== '' && !Number.isNaN(age)) {
    for (const p of items) {
      const rule = PAEDIATRIC[p.salt];
      if (rule && age < rule.minAge) alerts.push({ type: 'paediatric', severity: 'major', title: `Age ${age}: ${p.salt}`, detail: rule.note, products: [p.id] });
    }
  }

  alerts.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  const blocking = alerts.filter((a) => SEVERITY_RANK[a.severity] >= 3);
  return { alerts, blocking: blocking.length > 0, checkedSalts: salts, knowledgeBase: 'PharmaChain demo KB v0.1 (not for clinical use)' };
}

module.exports = { check, INTERACTIONS, SEVERITY_RANK };
