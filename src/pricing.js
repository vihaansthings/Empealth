// Deterministic interpolation of the supplied estimates. This is not a fitted market-price model.
const amountFields = ['fair_price_low_usd', 'fair_price_mid_usd', 'fair_price_high_usd'];
const median = values => { const s = [...values].sort((a,b)=>a-b); const n=s.length; return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2; };
const round = n => Math.round(n * 100) / 100;
const mainland = state => !['AK','HI','PR','VI','GU','AS','MP','FM','MH','PW','AA','AE','AP'].includes(state);
function distance(a,b) {
  const rad = v => v * Math.PI/180;
  const dLat=rad(b[2]-a[2]), dLon=rad(b[3]-a[3]);
  const h=Math.sin(dLat/2)**2+Math.cos(rad(a[2]))*Math.cos(rad(b[2]))*Math.sin(dLon/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
export function createPricingModel(data, geography={}) {
  const byZip = new Map(), byCode = new Map(), cache = new Map();
  for (const row of data) {
    if(!byZip.has(row.zip5))byZip.set(row.zip5,[]); byZip.get(row.zip5).push(row);
    if(!byCode.has(row.procedure_code))byCode.set(row.procedure_code,[]); byCode.get(row.procedure_code).push(row);
  }
  return zip => {
    if(!/^\d{5}$/.test(zip))return [];
    if(cache.has(zip))return cache.get(zip);
    if(byZip.has(zip)) {
      const result=byZip.get(zip).map(r=>({...r,model_method:'Source ZIP estimate',model_basis:`Existing estimate for ZIP ${zip}`,model_sources:zip}));
      cache.set(zip,result);return result;
    }
    const target=geography[zip];
    const candidates=target ? [...byZip.keys()].filter(z=>geography[z] && (mainland(target[1])?mainland(geography[z][1]):geography[z][1]===target[1])).map(z=>({zip:z,km:distance(target,geography[z])})).sort((a,b)=>a.km-b.km||a.zip.localeCompare(b.zip)).slice(0,3):[];
    const result=[...byCode.values()].map(group=>{
      const donors=candidates.map(c=>({row:group.find(r=>r.zip5===c.zip),...c})).filter(d=>d.row);
      const exemplar=group[0];
      const modeled={...exemplar,zip5:zip,city:target?.[0]||'National estimate',state:target?.[1]||'',pricing_zip5:'',pricing_status:donors.length?'distance_weighted_model':'national_anchor_model',geo_id_type:donors.length?'ZIP centroid distance weighting':'National anchor fallback',applicability_tier:'modeled',model_method:donors.length?'Nearby ZIP model':'National fallback',model_sources:donors.map(d=>d.zip).join(', '),model_basis:donors.length?`Weighted from ${donors.map(d=>`${d.zip} (${Math.round(d.km)} km)`).join(', ')}`:'National anchor with price-range ratios from the supplied data. No verified local geography.',scope_ambiguity:exemplar.scope_ambiguity};
      if(donors.length) {
        const weight=d=>1/Math.max(d.km,25)**2, sum=donors.reduce((s,d)=>s+weight(d),0);
        for(const field of amountFields)modeled[field]=String(round(donors.reduce((s,d)=>s+Number(d.row[field])*weight(d),0)/sum));
        modeled.applied_geo_factor=String(round(donors.reduce((s,d)=>s+Number(d.row.applied_geo_factor)*weight(d),0)/sum));
      } else {
        for(const field of amountFields)modeled[field]=String(round(Number(exemplar.national_anchor_usd)*median(group.map(r=>Number(r[field])/(Number(r.national_anchor_usd)*Number(r.applied_geo_factor))))));
        modeled.applied_geo_factor='1';
      }
      return modeled;
    });
    cache.set(zip,result);return result;
  };
}
