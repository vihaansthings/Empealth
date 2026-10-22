// Additional searchable procedures have no invented price benchmarks.
const source = 'https://www.cms.gov/Research-Statistics-Data-and-Systems/Statistics-Trends-and-Reports/MedicareFeeforSvcPartsAB/Downloads/LabServ12.pdf';
export const additionalProcedures = [
  ['80048', 'Basic metabolic panel'],
  ['82043', 'Urine albumin measurement'],
  ['82565', 'Creatinine blood test'],
  ['82746', 'Folate blood test'],
  ['84439', 'Free T4 thyroid hormone test'],
  ['85610', 'Prothrombin time blood clotting test'],
].map(([procedure_code, consumer_label]) => ({
  procedure_code, consumer_label, code_system: 'CPT', category: 'Laboratory tests',
  price_unit: 'per test or panel', price_scope: 'Laboratory service; no price benchmark available',
  default_setting: 'Laboratory', scope_ambiguity: 'Confirm with provider',
  fair_price_low_usd: null, fair_price_mid_usd: null, fair_price_high_usd: null,
  pricing_status: 'unpriced', applicability_tier: 'catalog only',
  model_method: 'No price estimate', model_basis: 'Added procedure; request a provider or insurer quote.',
  source_url: source, source_kind: 'CMS historical code listing (2012); not a current coding or price authority',
}));
export function hasEstimate(row) {
  return !!row && ['fair_price_low_usd', 'fair_price_high_usd'].every(k => row[k] !== null && row[k] !== '' && Number.isFinite(Number(row[k])) && Number(row[k]) >= 0);
}
export function catalogForZip(prices, zip) {
  if (!/^\d{5}$/.test(zip)) return [];
  const codes = new Set(prices.map(r => r.procedure_code));
  return [...prices, ...additionalProcedures.filter(r => !codes.has(r.procedure_code)).map(r => ({...r, zip5: zip}))];
}
