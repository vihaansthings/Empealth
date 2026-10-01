import {extractBill} from './extraction.js';
export const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
export function parseCSV(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(field); field = ''; }
    else if (c === '\n' && !quoted) { row.push(field.replace(/\r$/, '')); if (row.some(Boolean)) rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  const headers = rows.shift();
  return rows.map(values => Object.fromEntries(headers.map((h, i) => [h, values[i] || ''])));
}
export const validCode = code => /^(?:\d{5}|\d{4}[FTU]|[A-Z]\d{4})$/.test(code);
export function parseBill(text) { return extractBill(text).rows; }
export function analyze(rows, data, zip, statedTotal = '') {
  const issues = []; const references = new Map(data.filter(r => r.zip5 === zip).map(r => [r.procedure_code, r]));
  for (const row of rows) {
    const add = (type, title, detail) => issues.push({ id: `${row.id}-${type}`, rowId: row.id, code: row.code, type, title, detail });
    if (!row.confirmed) { add('verify', 'Confirm the extracted line', 'Check the code, date, provider, modifier, units and line total against the original bill.'); continue; }
    if (!row.code) add('coverage', 'Procedure code needed', 'This charge can be reviewed by description. Ask the provider for its procedure code before making a price comparison.');
    else if (!validCode(row.code)) add('code', 'Code format needs review', 'This does not match a standard CPT, CDT or HCPCS code format. Ask the provider for the complete code.');
    else if (!data.some(r => r.procedure_code === row.code)) add('coverage', 'Code not in the procedure catalog', 'The procedure catalog is not a complete code directory. A missing code does not mean incorrect billing.');
    if (!Number.isFinite(row.amount) || row.amount < 0 || !Number.isInteger(row.units) || row.units < 1) add('units', 'Check the amount or units', 'Credits and nonstandard quantities require manual review. Price comparisons are skipped.');
    const duplicate = rows.find(r => r.id !== row.id && r.confirmed && row.code && r.code === row.code && r.date && r.date === row.date && r.provider.trim() && r.provider.trim().toLowerCase() === row.provider.trim().toLowerCase() && r.modifier === row.modifier && r.amount === row.amount && r.units === row.units);
    if (duplicate) add('duplicate', 'Possible repeated charge', 'The same code, date, provider, modifier, units and amount appear more than once. Repeat services can be legitimate. Request clarification.');
    const ref = references.get(row.code);
    if (ref && row.comparable && Number.isInteger(row.units) && row.units > 0 && row.amount >= 0 && row.amount / row.units > Number(ref.fair_price_high_usd)) add('price', 'Above the modeled range', `${money(row.amount / row.units)} per unit exceeds the modeled upper estimate of ${money(Number(ref.fair_price_high_usd))}. This is a discussion reference, not evidence of overcharging.`);
  }
  if (statedTotal !== '' && Number.isFinite(Number(statedTotal)) && rows.length && rows.every(r => r.confirmed && Number.isFinite(r.amount))) {
    const sum = rows.reduce((a, r) => a + r.amount, 0);
    if (Math.abs(sum - Number(statedTotal)) > 0.01) issues.push({ id: 'total', type: 'total', title: 'Totals do not reconcile', detail: `Entered lines total ${money(sum)}; stated itemized total is ${money(Number(statedTotal))}. Check missing lines, credits and adjustments.`, code: 'TOTAL' });
  }
  return issues;
}
export function makeScript({ channel, hospital, account, name, zip, issues, rows }) {
  const relevant = issues.filter(i => !['verify', 'coverage'].includes(i.type));
  const items = [...new Map(relevant.map(i => [i.code + i.type, i])).values()].map(i => `- ${i.code}: ${i.title}. ${i.detail}`).join('\n');
  const intro = channel === 'email' ? `Subject: Request for itemized bill review${account ? `, account ${account}` : ''}\n\nDear ${hospital || 'billing team'},` : `Hello, my name is ${name || '[your name]'}. May I speak with someone who can review an itemized bill at ${hospital || '[hospital name]'}?`;
  return `${intro}\n\n${channel === 'email' ? `My name is ${name || '[your name]'}. ` : ''}I am requesting a review of ${account ? `account ${account}` : '[account number]'}. Please provide an itemized statement with service dates, procedure codes, modifiers, units, and any payments or adjustments.\n\n${items ? `Please help me understand these items:\n${items}\n\n` : 'Please confirm that each charge matches the services provided and that no service was billed more than once.\n\n'}${relevant.some(i => i.type === 'price') ? `I reviewed modeled procedure estimates for ZIP ${zip}. Can you explain the difference in scope and share your available self-pay or discounted rate?\n\n` : ''}Please check whether I qualify for financial assistance or a payment plan. If corrections are appropriate, please send a revised statement and explain the changes. Can you place the disputed items on hold while the review is pending and confirm whether any deadlines still apply?\n\n${channel === 'call' ? 'Before we finish, may I have your name, a reference number, and the expected response date? I will record those details in my notes.' : `Please reply in writing with the review outcome and next steps.\n\nThank you,\n${name || '[your name]'}`}`.replace(/[\u2013\u2014]/g, ', ');
}
