import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCSV, analyze} from '../src/engine.js';
import {financialBreakdown} from '../src/breakdown.js';
import {createPricingModel} from '../src/pricing.js';
import {catalogForZip, hasEstimate, additionalProcedures} from '../src/catalog.js';
import {reviewPayload, personalizedEmail} from '../src/ai-client.js';
import {buildContext, validatePayload, generateReview, parseResult} from '../server/review.js';
import {createApp} from '../server/app.js';
const source=parseCSV(readFileSync('public/data/prices.csv','utf8'));
const prices=createPricingModel(source);
const pricing=zip=>catalogForZip(prices(zip),zip);
const row={id:'1',code:'99213',date:'2026-09-01',provider:'Private Hospital',description:'Jane Doe account 123',modifier:'',units:1,amount:900,confirmed:true,comparable:true};
const payload=(rows=[row],total='')=>reviewPayload(rows,'10001',total);
const result={fairnessExplanation:'Review the charge. These samples cannot establish fairness.',breakdown:['This checked charge exceeds a synthetic sample. Ask the billing team to explain it.'],emailSubject:'Please review my bill',emailBody:'Please explain the charge and any available assistance.'};
const completed=value=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]});
test('150 unique procedures at any valid ZIP; six added without invented prices',()=>{
 for(const zip of ['10001','98027','00000']){const catalog=pricing(zip);assert.equal(catalog.length,150);assert.equal(new Set(catalog.map(r=>r.procedure_code)).size,150);assert.equal(catalog.filter(hasEstimate).length,144);}
 assert.equal(pricing('bad').length,0);
 for(const r of additionalProcedures){const line={...row,code:r.procedure_code};assert.equal(financialBreakdown([line],pricing('10001')).comparableCount,0);assert.ok(!analyze([line],pricing('10001'),'10001').some(f=>['price','coverage'].includes(f.type)));}
});
test('client payload removes personal data but preserves duplicate matching',()=>{
 const p=payload([row,{...row,id:'2',provider:'private hospital'}]);const serialized=JSON.stringify(p);
 for(const secret of ['Jane Doe','123','Private Hospital','2026-09-01','description'])assert.ok(!serialized.includes(secret));
 const context=buildContext(p,pricing('10001'));assert.ok(context.findings.some(f=>f.type==='duplicate'));
 assert.ok(context.lines.every(line=>!Object.hasOwn(line,'provider')&&!Object.hasOwn(line,'date')));
});
test('fairness evidence handles high, within, mixed, missing-price and unconfirmed bills',()=>{
 assert.equal(buildContext(payload(),pricing('10001')).evidence,'Review recommended');
 assert.equal(buildContext(payload([{...row,amount:100}]),pricing('10001')).evidence,'Within or below sample range');
 assert.equal(buildContext(payload([{...row,amount:100},{...row,confirmed:false}]),pricing('10001')).evidence,'Not enough information');
 assert.equal(buildContext(payload([{...row,code:'80048'}]),pricing('10001')).evidence,'Not enough information');
 assert.equal(buildContext(payload([{...row,amount:100}],150),pricing('10001')).evidence,'Review recommended');
 assert.throws(()=>buildContext(payload([{...row,confirmed:false}]),pricing('10001')),/Confirm at least/);
});
test('unconfirmed amounts never become verified AI line facts or price claims',()=>{
 const c=buildContext(payload([row,{...row,id:'2',amount:900000,confirmed:false}]),pricing('10001'));
 assert.equal(c.lines.length,1);assert.equal(c.checkedCharges,900);assert.equal(c.unconfirmedLines,1);assert.ok(!JSON.stringify(c).includes('900000'));
});
test('request validation bounds cost and rejects personal/free text injection',()=>{
 for(const p of [{...payload(),rows:Array(101).fill(payload().rows[0])},{...payload(),zip:'x'}, {...payload(),total:'100'}, {...payload(),rows:[{...payload().rows[0],provider:'Jane Doe'}]}, {...payload(),rows:[{...payload().rows[0],amount:1e20}]}])assert.throws(()=>validatePayload(p));
});
test('unknown and credit lines do not acquire synthetic comparisons',()=>{
 const c=buildContext(payload([{...row,code:'99999'},{...row,amount:-50}]),pricing('10001'));
 assert.ok(c.lines.every(r=>!r.comparable));assert.equal(c.comparableLines,0);
});
test('API uses structured output, no storage, server key and same evidence for email',async()=>{
 const c=buildContext(payload(),pricing('10001'));let sent;
 const generated=await generateReview(c,{apiKey:'test-key',fetchImpl:async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');sent=JSON.parse(options.body);return {ok:true,json:async()=>completed(result)};}});
 assert.equal(sent.store,false);assert.equal(sent.text.format.strict,true);assert.equal(JSON.parse(sent.input).evidence,c.evidence);assert.equal(generated.evidence,c.evidence);
 assert.equal(generated.breakdown.length,1);assert.ok(!JSON.stringify(sent).includes('test-key'));
 assert.match(personalizedEmail(generated,{name:'Jane',account:'123',hospital:'Team'}),/account 123/);
 assert.ok(!JSON.stringify(sent).includes('Jane'));
});
test('invalid, refused, incomplete and overlong paragraph responses are rejected',()=>{
 for(const response of [{status:'incomplete'}, {status:'completed',output:[{content:[{type:'refusal'}]}]}, completed({...result,breakdown:[]}),completed({...result,breakdown:['a','b','c']}),completed({...result,breakdown:['a\n\nb']})])assert.throws(()=>parseResult(response));
});
test('missing credentials, API failures and network timeouts are actionable and do not expose secrets',async()=>{
 const c=buildContext(payload(),pricing('10001'));
 await assert.rejects(generateReview(c,{}),/not configured/);
 for(const status of [401,429,500])await assert.rejects(generateReview(c,{apiKey:'private-secret',fetchImpl:async()=>({ok:false,status})}),e=>!e.message.includes('private-secret'));
 await assert.rejects(generateReview(c,{apiKey:'x',fetchImpl:async()=>{throw new Error('private-secret')}}),/could not connect/);
});
async function withServer(options,run){const app=createApp({pricing,apiKey:'test',origin:'http://app.test',generate:async c=>({evidence:c.evidence,...result}),...options});await new Promise(r=>app.listen(0,'127.0.0.1',r));try{await run(`http://127.0.0.1:${app.address().port}`)}finally{await new Promise(r=>app.close(r));}}
const request=(url,headers={},body=payload())=>fetch(url+'/api/review',{method:'POST',headers:{origin:'http://app.test','content-type':'application/json',...headers},body:JSON.stringify(body)});
test('HTTP validates origin, JSON, body limits, rate limits and never serves env files',async()=>withServer({rateLimit:2},async url=>{
 assert.equal((await request(url,{origin:'https://evil.test'})).status,403);
 assert.equal((await request(url,{'content-type':'text/plain'})).status,415);
 assert.equal((await fetch(url+'/.env.local')).status,404);
 const first=await request(url);assert.equal(first.status,200);assert.equal(first.headers.get('cache-control'),'no-store');assert.equal((await first.json()).evidence,'Review recommended');
 assert.equal((await request(url,{}, {...payload(),rows:[]})).status,400);
 assert.equal((await request(url)).status,429);
}));
test('HTTP rejects oversized requests and missing server key',async()=>{
 await withServer({},async url=>assert.equal((await request(url,{}, {extra:'x'.repeat(70000)})).status,413));
 await withServer({apiKey:''},async url=>assert.equal((await request(url)).status,503));
});
test('credit exhaustion is distinguished from transient rate limiting',async()=>{
 const c=buildContext(payload(),pricing('10001'));
 await assert.rejects(generateReview(c,{apiKey:'x',fetchImpl:async()=>({ok:false,status:429,json:async()=>({error:{code:'credit_balance_exhausted'}})})}),e=>e.status===503&&/retrying will not fix/.test(e.message));
});
test('Vercel entry point loads bundled data, trusts configured origins and handles parsed request bodies',async()=>{
 const oldKey=process.env.OPENAI_API_KEY, oldOrigin=process.env.APP_ORIGIN, oldFetch=globalThis.fetch;
 process.env.OPENAI_API_KEY='test-only';process.env.APP_ORIGIN='https://app.test';
 globalThis.fetch=async()=>({ok:true,json:async()=>completed(result)});
 try {
  const {default:handler}=await import('../api/review.js');
  const call=async(body,origin)=>{let status,output;const res={writeHead(code){status=code},end(value){output=JSON.parse(value)}};
   await handler({url:'/api/review',method:'POST',headers:{origin,'content-type':'application/json'},socket:{remoteAddress:'test'},body},res);return {status,output};};
  assert.equal((await call(payload(),'https://wrong.test')).status,403);
  const response=await call(payload(),'https://app.test');assert.equal(response.status,200);assert.equal(response.output.evidence,'Review recommended');
  assert.equal((await call({padding:'x'.repeat(70000)},'https://app.test')).status,413);
 } finally {
  globalThis.fetch=oldFetch;
  if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;
  if(oldOrigin===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=oldOrigin;
 }
});

test('email retains the synthetic-price limitation when the model omits it',async()=>{
 const context=buildContext(payload(),pricing('10001'));
 const generated=await generateReview(context,{apiKey:'test',fetchImpl:async()=>({ok:true,json:async()=>completed(result)})});
 assert.match(generated.emailBody,/synthetic sample estimates, not observed market rates/);
 const withDisclosure={...result,emailBody:'These are synthetic sample estimates. Please explain the charge.'};
 const preserved=await generateReview(context,{apiKey:'test',fetchImpl:async()=>({ok:true,json:async()=>completed(withDisclosure)})});
 assert.equal(preserved.emailBody,withDisclosure.emailBody);
});
