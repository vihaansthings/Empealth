import {money} from './engine.js';
export function financialBreakdown(rows, references) {
  const valid=rows.filter(r=>Number.isFinite(r.amount));
  const verified=valid.filter(r=>r.confirmed);
  const comparable=verified.filter(r=>r.comparable&&r.units>0&&Number.isInteger(r.units)&&r.amount>=0&&references.some(p=>p.procedure_code===r.code));
  const charge=comparable.reduce((s,r)=>s+r.amount,0);
  const low=comparable.reduce((s,r)=>s+Number(references.find(p=>p.procedure_code===r.code).fair_price_low_usd)*r.units,0);
  const high=comparable.reduce((s,r)=>s+Number(references.find(p=>p.procedure_code===r.code).fair_price_high_usd)*r.units,0);
  // Difference applies only to comparable confirmed lines; never present it as guaranteed savings or amount owed.
  return {draftTotal:valid.reduce((s,r)=>s+r.amount,0),verifiedTotal:verified.reduce((s,r)=>s+r.amount,0),verifiedCount:verified.length,missingCount:rows.length-valid.length,comparableCount:comparable.length,charge,low,high,difference:Math.max(0,charge-high),largest:[...valid].sort((a,b)=>b.amount-a.amount)[0]};
}
export function explainLine(row, ref) {
  const lines=[];
  if(Number.isFinite(row.amount)&&row.units>0&&Number.isInteger(row.units))lines.push(`${money(row.amount)} for ${row.units} entered unit${row.units===1?'':'s'} equals ${money(row.amount/row.units)} per unit. Confirm whether the bill uses visits, tests, time units or another measure.`);
  if(ref){
    lines.push(`The catalog labels code ${row.code} as "${ref.consumer_label}" in ${ref.category}. The reference covers ${ref.price_scope.toLowerCase()} and uses ${ref.price_unit.toLowerCase()}. A separate facility, laboratory or clinician charge may have a different scope.`);
    if(row.confirmed&&row.comparable&&row.units>0&&row.amount>=0){const high=Number(ref.fair_price_high_usd)*row.units,delta=row.amount-high;lines.push(delta>0?`This line is ${money(delta)} (${(delta/high*100).toFixed(1)}%) above the modeled upper estimate of ${money(high)} for the entered units. Ask the billing team to explain the rate and available discounts.`:`This line does not exceed the modeled upper estimate of ${money(high)} for the entered units. This does not verify your insurance coverage or the accuracy of the coding.`)}
    lines.push('Ask the clinician which documented service this code represents and whether its description matches what was performed. A bill cannot establish a diagnosis, medical necessity or treatment recommendation.');
  }else lines.push('The bill description is retained as written. Request an itemized statement with the procedure code and a plain-language explanation of the service. No code or medical meaning has been guessed.');
  return lines;
}
