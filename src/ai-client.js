// Only structured billing facts leave the browser. Free text and identifiers stay local.
export function reviewPayload(rows, zip, total) {
  const providers = new Map(), dates = new Map();
  const token = (map, value, prefix) => {
    if (!value) return '';
    if (!map.has(value)) map.set(value, `${prefix}${map.size + 1}`);
    return map.get(value);
  };
  return {zip, total: total === '' ? null : Number(total), rows: rows.map((r, i) => ({
    id: String(i + 1), code: /^[A-Z0-9]{5}$/.test(r.code) ? r.code : '',
    amount: Number.isFinite(r.amount) ? r.amount : null,
    units: Number.isFinite(r.units) ? r.units : null,
    confirmed: r.confirmed === true, comparable: r.comparable === true,
    provider: token(providers, (r.provider || '').trim().toLowerCase(), 'P'),
    date: token(dates, r.date || '', 'D'),
    modifier: /^[A-Z0-9]{0,4}$/.test(r.modifier || '') ? (r.modifier || '') : 'OTHER',
  }))};
}
export function personalizedEmail(result, profile) {
  return `Subject: ${result.emailSubject}\n\nDear ${profile.hospital || 'billing team'},\n\n${profile.account ? `Regarding account ${profile.account}.\n\n` : ''}${result.emailBody}\n\nThank you,\n${profile.name || '[your name]'}`;
}
