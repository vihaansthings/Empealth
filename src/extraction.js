// Rule-based extraction. Preserve original text and uncertainty instead of inventing codes or balances.
export function amountsIn(text) {
  const re = /(?:\(\s*)?(?:-\s*)?\$?\s*(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}(?:\s*\))?|\$\s*\d+(?![\d.])/g;
  return [...text.matchAll(re)].map(m=>({text:m[0].trim(),index:m.index,value:Number(m[0].replace(/[^\d.]/g,''))*(/[-(]/.test(m[0])?-1:1)}));
}
const dateRE = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/;
const summaryRE = /\b(total|balance|amount due|you owe|patient responsibility|insurance paid|payments?|adjustments?|deductible|copay|coinsurance|allowed amount|amount billed)\b/i;
const identityRE = /\b(account|invoice|member|policy|claim|tax id|npi|telephone|phone|fax|address|zip|statement date|due date)\s*(?:number|no\.?|id|#|:)/i;
function codeIn(source) {
  const withoutDates=source.replace(dateRE,'');
  // Exclude money so 12345.00 is never read as CPT 12345.
  const clean=withoutDates.replace(/\$?\b[\d,]+\.\d{2}\b/g,'');
  return clean.match(/\b(?:\d{5}|\d{4}[FTU]|[A-Z]\d{4})\b/i)?.[0].toUpperCase()||'';
}
export function extractBill(text) {
  const rows=[], summaries=[], unmatched=[];
  let pending='', page=1, amountColumn=-1;
  for (const original of text.replace(/\r/g,'').split('\n')) {
    const source=original.trim(); if(!source)continue;
    const marker=source.match(/^\[Page (\d+)\]/);if(marker){page=Number(marker[1]);pending='';amountColumn=-1;continue;}
    const columns=source.split(/\t| {2,}/).map(s=>s.trim()).filter(Boolean);
    if(!amountsIn(source).length && /\b(charges?|billed|amount|balance)\b/i.test(source) && /\b(description|service|procedure|code)\b/i.test(source)) {
      amountColumn=columns.findIndex(c=>/^(?:charges?|billed(?: amount)?|amount billed|charge amount)$/i.test(c));pending='';continue;
    }
    if(identityRE.test(source)){pending='';continue;}
    const amounts=amountsIn(source);
    const code=codeIn(source);
    if(summaryRE.test(source)&&!code) {
      if(amounts.length)summaries.push({label:source.slice(0,amounts[0].index).trim()||'Statement amount',amount:amounts.at(-1).value,source,page});
      pending='';continue;
    }
    if(!amounts.length) {
      // Keep one adjacent service/code line for wrapped tables; never join across totals or page boundaries.
      pending = code || /\b(visit|exam|lab|panel|test|therapy|x.?ray|imaging|scan|surgery|anesthesia|treatment|room|emergency|consultation|cleaning|filling|crown)\b/i.test(source) ? source : '';
      continue;
    }
    const combined=pending?`${pending} ${source}`:source; pending='';
    const combinedCode=codeIn(combined), date=combined.match(dateRE)?.[0]||'';
    let description=combined.replace(dateRE,'');
    if(combinedCode)description=description.replace(combinedCode,'');
    description=description.replace(/(?:\(\s*)?-?\$?\s*(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\s*\)?|\$\s*\d+/g,' ').replace(/\b(?:qty|units?)\s*[:x]?\s*\d+\b/ig,'').replace(/\s+/g,' ').trim();
    if(!combinedCode && (!/[a-z]{3}/i.test(description)||!date&&!/\b(visit|exam|lab|panel|test|therapy|x.?ray|imaging|scan|surgery|anesthesia|treatment|room|emergency|consultation|cleaning|filling|crown)\b/i.test(description))) {unmatched.push({source,page});continue;}
    const explicitCharge=amountColumn>=0&&columns[amountColumn]?amountsIn(columns[amountColumn]):[];
    const ambiguous=amounts.length>1&&explicitCharge.length!==1;
    const amount=explicitCharge.length===1?explicitCharge[0].value:amounts[0].value;
    rows.push({id:`line-${rows.length+1}`,code:combinedCode,description,date,provider:'',modifier:combinedCode?(combined.match(new RegExp(combinedCode+'[- ](26|TC|59|76|77|91)\\b','i'))?.[1]||''):'',units:Number(combined.match(/\b(?:qty|units?)\s*[:x]?\s*(\d+)\b/i)?.[1]||1),amount,confirmed:false,comparable:false,source:combined,page,amountCandidates:amounts.map(a=>a.value),extractionNote:ambiguous?'Multiple money columns found. The first amount is a draft; choose the billed charge, not an insurance payment or balance.':!combinedCode?'No procedure code printed or recognized. Ask for the CPT/CDT/HCPCS code before comparing prices.':'Draft extraction. Check the original document.',ambiguous});
  }
  return {rows,summaries,unmatched};
}
// PDFs often emit text column by column, not in reading order. Reconstruct spatial rows first.
export function pdfTextLines(items) {
  const positioned=items.filter(i=>typeof i.str==='string'&&i.str.trim()&&i.transform).map(i=>({text:i.str,x:i.transform[4],y:i.transform[5],width:i.width||0,height:Math.abs(i.transform[3])||10})).sort((a,b)=>b.y-a.y||a.x-b.x);
  const lines=[];
  for(const item of positioned){let line=lines.find(l=>Math.abs(l.y-item.y)<=Math.max(2,Math.min(item.height,12)*.3));if(!line){line={y:item.y,items:[]};lines.push(line)}line.items.push(item)}
  return lines.sort((a,b)=>b.y-a.y).map(l=>{let end=-Infinity;return l.items.sort((a,b)=>a.x-b.x).map(i=>{const first=end===-Infinity,gap=i.x-end;end=i.x+i.width;return `${first?'':gap>12?'\t':' '}${i.text}`}).join('').trim()}).join('\n');
}
