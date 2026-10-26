import {catalogForZip, additionalProcedures, hasEstimate} from './catalog.js';
import {reviewPayload, personalizedEmail} from './ai-client.js';
import {listBills, getBill, putBill, deleteBill, billSummary} from './bill-store.js';
import './style.css';
import {extractBill} from './extraction.js';
import {financialBreakdown,explainLine} from './breakdown.js';
import { createPricingModel } from './pricing.js';
import { createIcons, icons } from 'lucide';
import { parseCSV, parseBill, analyze, makeScript, money } from './engine.js';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
let data = [], view = 'review', zip = '10001', query = '', category = 'All procedures', rows = [], raw = '', total = '', sample = false, channel = 'email', busy = false, controller, scriptText = '', details = null;
let scanReport=null, lastFile=null, scanMessage='', extraction={summaries:[],unmatched:[]};
let aiResult=null, aiError='', aiBusy=false, aiConsent=false, aiController=null, aiRevision=0, lastBillKey='';
let billId=null, billName='', billCreatedAt=0, savedBills=[], savedKey='', saveQueue=Promise.resolve(true), savePending=0, saveError='', libraryError='';
let saved = []; try { saved = JSON.parse(localStorage.getItem('empealth-procedures') || '[]').filter(x => typeof x === 'string'); } catch {}
const profile = { hospital: '', account: '', name: '' };
let pricing = () => [];
const issues = () => analyze(rows, local(), zip, total);
const local = () => catalogForZip(pricing(zip), zip);
const location = () => local()[0];
function notify(message) { $('#toast').textContent = message; $('#toast').classList.add('show'); setTimeout(() => $('#toast').classList.remove('show'), 3500); }
function badge(text, cls = '') { return `<span class="badge ${cls}">${text}</span>`; }
function snapshotBill() {
 return structuredClone({zip,rows,raw,total,sample,channel,scriptText,scanReport,extraction,aiResult,profile});
}
function saveMessage() { return savePending?'Saving on this device…':saveError?'Not saved. Your browser could not save this bill. Free up browser storage or leave private browsing, then retry.':billId?'Saved in My bills on this device.':'Uploads and drafts save automatically on this device.'; }
function updateSaveStatus() {
 document.querySelectorAll('[data-save-status]').forEach(el=>el.textContent=saveMessage());
 document.querySelectorAll('[data-retry-save]').forEach(el=>el.hidden=!saveError);
 const count=$('[data-bill-count]');if(count)count.textContent=savedBills.length;
}
function persistCurrent(force=false) {
 if(!billId&&!rows.length&&!raw&&!lastFile)return saveQueue.then(()=>true);
 if(!billId){billId=crypto.randomUUID();billCreatedAt=Date.now();billName=billName||(sample?'Sample bill':scanReport?.name||'Untitled bill');}
 const state=snapshotBill(), key=JSON.stringify({billId,billName,state});
 if(!force&&key===savedKey)return saveQueue;
 savedKey=key;
 const record={id:billId,name:billName,createdAt:billCreatedAt,updatedAt:Date.now(),file:lastFile,state};
 savePending++;updateSaveStatus();
 saveQueue=saveQueue.then(async()=>{
  try{await putBill(record);savedBills=[billSummary(record),...savedBills.filter(b=>b.id!==record.id)].sort((a,b)=>b.updatedAt-a.updatedAt);saveError='';return true;}
  catch{saveError='Save failed';if(savedKey===key)savedKey='';return false;}
  finally{savePending--;updateSaveStatus();if(view==='bills'&&!$('#modal')?.open)render(false);}
 });
 return saveQueue;
}
function resetCurrent() {
 aiRevision++;aiController?.abort();aiBusy=false;aiResult=null;aiError='';aiConsent=false;
 billId=null;billName='';billCreatedAt=0;savedKey='';saveError='';rows=[];raw='';total='';sample=false;
 lastFile=null;scanReport=null;extraction={summaries:[],unmatched:[]};scriptText='';channel='email';
 Object.keys(profile).forEach(k=>profile[k]='');lastBillKey=JSON.stringify({rows,zip,total});
}
async function newBill() {
 if(busy)return;
 if(!await persistCurrent())return notify('Your current bill is not saved. Retry saving before starting another.');
 resetCurrent();view='review';render();window.scrollTo(0,0);
}
async function openBill(id) {
 if(busy)return;
 if(!await persistCurrent())return notify('Your current bill is not saved. Retry saving before opening another.');
 try{
  const record=await getBill(id);if(!record)return notify('This bill is no longer saved in this browser.');
  resetCurrent();const s=record.state;
  billId=record.id;billName=record.name;billCreatedAt=record.createdAt;lastFile=record.file;
  ({zip,rows,raw,total,sample,channel,scriptText,scanReport,extraction,aiResult}=s);
  Object.assign(profile,s.profile);lastBillKey=JSON.stringify({rows,zip,total});
  savedKey=JSON.stringify({billId,billName,state:snapshotBill()});
  view='review';render();window.scrollTo(0,0);
 }catch{notify('Could not open this saved bill. Try again in this browser.');}
}
function downloadFile(file) {
 const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=file.name||'bill';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function askDeleteBill(id) {
 const bill=savedBills.find(b=>b.id===id);if(!bill||busy)return;
 modal(`<h2>Delete this saved bill?</h2><p><strong>${esc(bill.name)}</strong></p><p>This removes its saved file, bill details, AI review and email draft from this browser. Your original file elsewhere on your device is not changed.</p><button id="confirm-delete-bill" class="button danger">Delete saved bill</button>`);
 $('#confirm-delete-bill').onclick=async()=>{
  $('#confirm-delete-bill').disabled=true;
  if(billId===id){aiRevision++;aiController?.abort();aiBusy=false;}
  try{await saveQueue;await deleteBill(id);if(billId===id)resetCurrent();savedBills=savedBills.filter(b=>b.id!==id);view='bills';render();notify('Saved bill deleted from this browser.');}
  catch{notify('Could not delete this bill. Please try again.');$('#confirm-delete-bill').disabled=false;}
 };
}
function billLibrary() {
 return `<section class="panel bill-library"><div class="section-heading"><h2>My bills</h2><button data-new-bill class="button primary" ${busy?'disabled':''}>${icon('plus')} New bill</button></div><p class="library-note">Original files, bill details, AI reviews and email drafts save in this browser on this device. They are not synced to an account or other devices. Anyone using this browser profile can open them. Clearing site data or private browsing can remove them; keep your own copies of important files.</p>${libraryError?`<p class="ai-error">Could not load saved bills. Browser storage may be unavailable. <button id="retry-library" class="text-link">Retry</button></p>`:''}${savedBills.length?`<div class="saved-bill-list">${savedBills.map(b=>`<article class="saved-bill-card"><div class="saved-bill-info">${badge(b.sample?'Sample bill':b.hasFile?'Uploaded bill':'Manual bill',b.sample?'amber':'green')}<h3>${esc(b.name)}</h3><p>${b.lineCount} line${b.lineCount===1?'':'s'} · ${money(b.total)} draft charges${b.hasReview?' · AI review saved':''}</p><p>Updated ${esc(new Date(b.updatedAt).toLocaleString())}</p></div><div class="saved-bill-actions"><button data-open-bill="${esc(b.id)}" class="button primary" ${busy?'disabled':''}>Open bill</button>${b.hasFile?`<button data-download-bill="${esc(b.id)}" class="button secondary">Download original</button>`:''}<button data-delete-bill="${esc(b.id)}" class="text-link delete-link" ${busy?'disabled':''}>Delete</button></div></article>`).join('')}</div>`:`<div class="empty-small"><h3>No saved bills yet.</h3><p>Choose a bill or enter charges manually. Your work will save here automatically.</p><button data-new-bill class="button secondary" ${busy?'disabled':''}>Start a bill</button></div>`}</section>`;
}
async function refreshLibrary() {
 try{savedBills=await listBills();libraryError='';}catch{libraryError='Storage unavailable';}render();
}
function render(autoSave=true) {
 const billKey=JSON.stringify({rows,zip,total});
 if(billKey!==lastBillKey){lastBillKey=billKey;aiRevision++;aiController?.abort();aiBusy=false;aiResult=null;aiError='';scriptText='';}
 const loc = location(), flags = issues();
 $('#app').innerHTML = `<aside class="sidebar"><a class="brand" href="#" aria-label="Empealth home"><span class="brand-mark">${icon('plus')}</span>empealth<span class="brand-dot">.</span></a><div class="nav-label">YOUR WORKSPACE</div><nav aria-label="Main navigation">${[['review','scan-line','Bill review'],['bills','files','My bills'],['procedures','search','Explore prices'],['saved','bookmark','My procedures'],['script','message-square-text','Negotiation script']].map(([v,i,t])=>`<button class="nav-item ${view===v?'active':''}" data-view="${v}" aria-label="${t}">${icon(i)}<span>${t}</span>${v==='saved'?`<b>${saved.length}</b>`:v==='bills'?`<b data-bill-count>${savedBills.length}</b>`:''}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="privacy-icon">${icon('shield-check')}</div><strong>Your bill stays yours.</strong><p>Scans stay on this device. AI uses selected bill details only when you choose.</p><button class="text-link" id="privacy">How it works ${icon('arrow-up-right')}</button></div><div class="sidebar-footer">Clarity. Confidence. Care.</div></aside>
 <div class="workspace"><header><div class="breadcrumb">Workspace <span>/</span> <strong>${{review:'Bill review',bills:'My bills',procedures:'Explore prices',saved:'My procedures',script:'Negotiation script'}[view]}</strong></div><div class="header-right">${badge(`${icon('lock-keyhole')} Private by design`,'privacy')}<span class="avatar">${icon('user-round')}</span></div></header><main><div class="page-heading"><div><div class="eyebrow">A LITTLE CLARITY GOES A LONG WAY</div><h1>${{review:'Your bill, made clearer.',bills:'Your bills, all in one place.',procedures:'Know the price. Plan ahead.',saved:'Your care, on your terms.',script:'Find the words. Take the next step.'}[view]}</h1><p>${{review:'Understand your charges and start a better billing conversation.',bills:'Pick up where you left off, on this device.',procedures:'Explore procedure estimates in your ZIP code.',saved:'A shortlist of procedures, saved only on this device.',script:'A practical starting point for your hospital billing team.'}[view]}</p></div>${view!=='bills'?`<label class="zip-box">${icon('map-pin')}<span>Your ZIP code<input id="zip" aria-label="Your ZIP code" inputmode="numeric" maxlength="5" value="${esc(zip)}"></span><small>${esc(loc ? [loc.city, loc.state].filter(Boolean).join(', ') : 'Enter a ZIP code')}</small></label>`:''}</div>
 <div class="bill-storage-bar"><div>${(view==='review'||view==='script')&&(billId||rows.length||raw||lastFile)?`<label>Bill name<input id="bill-name" aria-label="Bill name" maxlength="120" value="${esc(billName||scanReport?.name||(sample?'Sample bill':'Untitled bill'))}"></label>`:''}<p data-save-status role="status">${esc(saveMessage())}</p><button data-retry-save class="text-link" ${saveError?'':'hidden'}>Retry saving</button></div>${view!=='bills'?`<button data-new-bill class="button secondary" ${busy?'disabled':''}>New bill</button>`:''}</div>
 ${view === 'review' ? review(flags) : view === 'bills' ? billLibrary() : view === 'procedures' || view === 'saved' ? procedures() : composer()}
 <footer><span>Made for a more informed conversation.</span><button id="method-footer">Data & methodology</button><span>Modeled estimates · Before insurance · USD</span></footer></main></div><div id="toast" role="status"></div><dialog id="modal"><div id="modal-body"></div><button id="close-modal" class="button secondary">Close</button></dialog>`;
 createIcons({ icons }); bind();if(autoSave)persistCurrent();updateSaveStatus();
}
function review(flags) {
 const sum = rows.reduce((s,r)=>s+(Number.isFinite(r.amount)?r.amount:0),0);
 return `<div class="review-grid"><section class="panel upload-panel"><div class="section-heading"><div><span class="step">01</span><h2>Start with your bill</h2></div>${badge('On-device OCR','green')}</div><div class="dropzone ${busy?'scanning':''}" id="dropzone"><div class="scan-icon">${icon(busy?'loader-circle':'scan-line')}</div><h3>${busy?'Reading your bill...':'A clear picture starts here.'}</h3><p>Drop an itemized bill, or choose a file.<br>PDF, JPG, PNG or WebP · Up to 25 MB</p><button id="choose-file" class="button primary" ${busy?'disabled':''}>${icon('upload')} Choose a bill</button><input type="file" id="file" accept="application/pdf,image/png,image/jpeg,image/webp,image/bmp" ${busy?'disabled':''} hidden><button id="choose-camera" class="text-link camera" ${busy?'disabled':''}>${icon('camera')} Take a photo</button><input id="camera" type="file" accept="image/*" capture="environment" hidden ${busy?'disabled':''}><div id="scan-progress" role="status">${busy?esc(scanMessage||'Preparing local scanner...'):'Uploads save in My bills in this browser.'}</div>${busy?'<button id="cancel" class="text-link">Cancel scan</button>':''}</div><div class="upload-bottom"><span>Just looking around?</span><button id="demo" class="text-link" ${busy?'disabled':''}>Try a sample bill ${icon('arrow-right')}</button></div></section>
 <section class="panel next-panel"><div class="section-heading"><h2>A little review.<br>A lot more confidence.</h2>${icon('sparkles')}</div><ol class="steps"><li><span>1</span><div><strong>Check what you were charged</strong><p>Review extracted codes, amounts and dates.</p></div></li><li><span>2</span><div><strong>See what needs a second look</strong><p>Spot possible duplicates and compare the right price scope.</p></div></li><li><span>3</span><div><strong>Have a clearer conversation</strong><p>Get a ready-to-edit email or phone script.</p></div></li></ol><div class="privacy-strip">${icon('shield-check')} Local scanning. Optional AI review.</div></section></div>
 ${scanStatus()}<section class="panel bill-panel"><div class="section-heading"><div><span class="step">02</span><h2>Your bill breakdown</h2>${sample?badge('DEMO BILL','amber'):''}</div><button id="add-line" class="button secondary small" ${busy?'disabled':''}>${icon('plus')} Add line manually</button></div>${rows.length?`<div class="bill-summary"><div><span>Draft line total</span><strong>${money(sum)}</strong></div><div><span>Line items</span><strong>${rows.length.toString().padStart(2,'0')}</strong></div><div><span>Items to verify</span><strong>${flags.length.toString().padStart(2,'0')}</strong></div><label>Stated itemized total<input id="total" ${busy?'disabled':''} type="number" step="0.01" placeholder="Optional" value="${esc(total)}"></label></div><p class="muted review-hint">Confirm each line against your bill. Charge means the full line total. Dates and providers must match to flag repeated charges.</p>${detailedBreakdown()}<div class="line-list">${rows.map((r,i)=>lineCard(r,i)).join('')}</div><div class="bill-actions"><button id="clear-bill" class="text-link">${icon('folder-check')} Close current bill</button><button data-view="script" class="button primary">Prepare my script ${icon('arrow-right')}</button></div>`:`<div class="empty-bill">${icon('receipt-text')}<div><h3>Nothing to untangle yet.</h3><p>Add a bill above or enter a line manually to begin.</p></div><span>Ready when you are.</span></div>`}<details class="raw-details"><summary>Paste or review extracted text</summary><p>Automatic parsing is a starting point. Review all lines, including any not detected.</p><textarea id="raw" ${busy?'disabled':''} placeholder="Paste a line such as: 09/01/2026 99213 Office visit $250.00">${esc(raw)}</textarea><button id="parse" class="button secondary" ${busy?'disabled':''}>Extract draft lines</button></details></section>
 ${(rows.length||raw)?guidance():''}
 ${rows.length?`<section class="panel findings"><div class="section-heading"><div><span class="step">03</span><h2>Worth a closer look</h2></div>${badge(`${flags.length} review items`,'amber')}</div><p class="muted">These checks raise questions. They cannot establish fraud, upcoding, clinical appropriateness or code-description errors.</p>${flags.length?flags.map(f=>`<article class="finding ${f.type}"><span class="finding-icon">${icon(f.type==='price'?'chart-no-axes-combined':f.type==='duplicate'?'copy':'circle-help')}</span><div><strong>${esc(f.title)}</strong><p>${esc(f.detail)}</p></div>${badge(esc(f.code||'LINE'))}</article>`).join(''):'<div class="empty-small">No flags from the checks available here. This is not a certification that the bill is correct.</div>'}</section>`:''}`;
}
function scanStatus() {
 if(!scanReport)return '';
 return `<section class="panel scan-result" role="status"><h2>${scanReport.error?'We could not complete this scan':'Your document review'}</h2><p><strong>${esc(scanReport.name)}</strong></p><p>${esc(scanReport.message)}</p>${scanReport.pages.map(p=>`<span class="badge">Page ${p.page}: ${p.method}, ${p.lines} draft lines${p.confidence!==null?`, OCR confidence ${p.confidence}%`:''}</span>`).join(' ')}${scanReport.warnings.map(w=>`<p>${esc(w)}</p>`).join('')}<p class="muted">OCR confidence describes text recognition, not billing accuracy. All detected amounts are drafts until you check them.</p><div class="scan-actions">${lastFile?`<button id="retry-ocr" class="button secondary" ${busy?'disabled':''}>Retry with enhanced OCR</button>`:''}<button id="review-text" class="button secondary">Review extracted text</button></div>${extraction.summaries.length?`<h3>Statement amounts</h3><p>These are separate from individual service charges. They are not added to the line total.</p><div class="statement-values">${extraction.summaries.map(x=>`<div><span>${esc(x.label)} · page ${x.page}</span><strong>${money(x.amount)}</strong></div>`).join('')}</div>`:''}${extraction.unmatched.length?`<details><summary>${extraction.unmatched.length} money-containing lines need manual review</summary>${extraction.unmatched.map(x=>`<p>Page ${x.page}: ${esc(x.source)}</p>`).join('')}</details>`:''}</section>`;
}
function aiPanel(compact=false) {
 const confirmed=rows.some(r=>r.confirmed&&Number.isFinite(r.amount));
 return `<section class="ai-panel" aria-busy="${aiBusy}"><div class="section-heading"><div>${icon('sparkles')}<h2>Your AI bill review</h2></div>${badge('AI bill review','green')}</div><p>Understand which charges need a closer look and how you could lower costs in the future. Your email draft is separate.</p>${aiResult?`<div class="ai-result"><h3>${esc(aiResult.evidence)}</h3>${aiResult.breakdown.map(p=>`<p>${esc(p)}</p>`).join('')}</div>`:''}<label class="ai-consent"><input id="ai-consent" type="checkbox" ${aiConsent?'checked':''} ${aiBusy?'disabled':''}> Allow selected billing details and ZIP to be sent to OpenAI for this review. Names, account numbers, raw text and files stay here.</label><div class="ai-actions"><button id="generate-ai" class="button primary" ${!confirmed||!aiConsent||aiBusy||busy?'disabled':''}>${icon(aiBusy?'loader-circle':'sparkles')} ${aiBusy?'Writing your review...':aiResult?'Regenerate AI review & email':'Generate AI review & email'}</button>${aiBusy?'<button id="cancel-ai" class="button secondary">Cancel</button>':''}${aiResult&&!compact?'<button data-view="script" class="button secondary">Read my AI email</button>':''}</div><p class="small-note">${!confirmed?'Check at least one bill line and its amount to begin. ':''}Changing bill details clears the old AI review. Regenerating replaces the email draft.</p><div role="status" aria-live="polite">${aiError?`<p class="ai-error">${esc(aiError)} Local checks and the template remain available.</p>`:''}</div></section>`;
}
async function runAI() {
 if(aiBusy||!aiConsent||!rows.some(r=>r.confirmed&&Number.isFinite(r.amount)))return;
 aiBusy=true;aiError='';aiController=new AbortController();const requestController=aiController, revision=aiRevision;
 const timer=setTimeout(()=>requestController.abort(),55000);
 render();
 try {
  const response=await fetch('/api/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(reviewPayload(rows,zip,total)),signal:aiController.signal});
  let result;try{result=await response.json()}catch{throw new Error('AI review is unavailable on this host. The app needs its AI server running.')}
  if(!response.ok)throw new Error(result.error||'AI review could not be completed.');
  if(!Array.isArray(result.breakdown)||!result.emailBody||!result.fairnessExplanation)throw new Error('AI returned an incomplete review. Try again.');
  if(revision!==aiRevision)return;
  aiResult=result;scriptText='';
 } catch(e) { if(revision===aiRevision)aiError=e.name==='AbortError'?'AI review timed out. Please try again.':e.message; }
 finally {clearTimeout(timer);if(revision===aiRevision){aiBusy=false;render()}}
}
function detailedBreakdown(){
 const f=financialBreakdown(rows,local());
 return `${aiPanel()}<details class="financial-detail"><summary>See the calculation details</summary><h3>What the numbers tell you</h3><p>You have checked ${f.verifiedCount} of ${rows.length} lines, totaling <strong>${money(f.verifiedTotal)}</strong> in verified entered charges. The draft total is not necessarily your amount owed: it may exclude unread lines, payments, insurance adjustments and credits.${f.missingCount?` ${f.missingCount} line amounts still need entry.`:''}</p>${f.largest?`<p>The largest entered charge is <strong>${money(f.largest.amount)}</strong> for ${esc(f.largest.description||f.largest.code||'an unlabeled service')}. Start by confirming its service, units and rate.</p>`:''}<div class="financial-metrics"><div><span>Comparable confirmed lines</span><strong>${f.comparableCount}</strong></div><div><span>Charges on those lines</span><strong>${money(f.charge)}</strong></div><div><span>Modeled range, same lines</span><strong>${f.comparableCount?`${money(f.low)} to ${money(f.high)}`:'Confirm scope to compare'}</strong></div><div><span>Difference above upper range</span><strong>${f.comparableCount?money(f.difference):'Not calculated'}</strong></div></div><p>Price differences are discussion amounts, not guaranteed savings or a payment recommendation. Possible duplicate charges are not subtracted or counted again as savings.</p></details>`;
}
function guidance(){return `<section class="panel billing-guidance"><div class="section-heading"><h2>Your next steps, in plain language</h2></div><div class="guidance-grid"><article><h3>1. Reconcile the insurance math</h3><p>Compare the service dates, billed amounts, insurer payments, adjustments and patient responsibility with your Explanation of Benefits. An EOB explains claim processing; it is not a bill. Ask the provider to explain any difference before agreeing to a revised balance.</p><a href="https://www.cms.gov/initiatives/your-patient-rights/medical-bill-rights/get-help/medical-bill-guides-resources/check-your-medical-bill-errors" target="_blank" rel="noopener noreferrer">CMS: check billing errors</a></article><article><h3>2. Ask about affordable options</h3><p>Request the hospital's financial assistance application and eligibility criteria. Ask about self-pay discounts or an interest-free plan, including fees and due dates. Compare those options before moving the balance to a credit card. Confirm any review hold and deadlines in writing.</p><a href="https://www.consumerfinance.gov/ask-cfpb/what-should-i-do-if-i-cant-pay-a-medical-bill-en-2125/" target="_blank" rel="noopener noreferrer">CFPB: help with medical bills</a></article><article><h3>3. Clarify the medical services</h3><p>Ask for a plain-language description of unfamiliar tests, procedures and medications. Check whether the service was performed and whether separate professional and facility fees explain similar-looking lines. Ask the treating clinician about medical necessity; this bill review cannot determine a diagnosis or advise you to stop treatment.</p><a href="https://www.cms.gov/initiatives/your-patient-rights/medical-bill-rights/get-help/medical-bill-guides-resources/how-read-your-medical-bill" target="_blank" rel="noopener noreferrer">CMS: understand your bill</a></article></div></section>`;}
function lineCard(r, i) {
 const ref = local().find(p=>p.procedure_code===r.code);
 return `<article class="bill-line" data-id="${r.id}"><div class="line-top"><span class="line-number">${String(i+1).padStart(2,'0')}</span><strong>${esc(ref?.consumer_label || r.description || 'New bill line')}</strong><button ${busy?'disabled':''} data-remove="${r.id}" class="icon-button" aria-label="Remove line ${i+1}">${icon('x')}</button></div><div class="line-fields">${[['description','Bill description','text'],['code','Code','text'],['date','Service date','text'],['provider','Provider','text'],['modifier','Modifier','text'],['units','Units','number'],['amount','Line charge, $','number']].map(([key,label,type])=>`<label>${label}<input ${busy?'disabled':''} data-field="${key}" aria-label="Line ${i+1} ${label}" type="${type}" ${type==='number'?'step="'+(key==='units'?'1':'0.01')+'"':''} value="${esc(r[key])}" placeholder="${key==='date'?'YYYY-MM-DD':key==='modifier'?'None':''}"></label>`).join('')}</div>${hasEstimate(ref)?`<div class="reference"><div><span class="small-label">MODELED PRICE RANGE</span><strong>${money(+ref.fair_price_low_usd)} to ${money(+ref.fair_price_high_usd)}</strong></div><p>${esc(ref.price_unit)} · ${esc(ref.price_scope)}<br><small>${esc(ref.default_setting)} · Scope ambiguity: ${esc(ref.scope_ambiguity)}</small></p><button class="text-link" data-detail="${esc(ref.procedure_code)}">Details ${icon('arrow-up-right')}</button></div>`:`<p class="muted">${location()?'No estimate for this procedure code.':'No estimates available for this ZIP code.'}</p>`}<div class="line-explanation">${explainLine(r,ref).map(p=>`<p>${esc(p)}</p>`).join('')}</div>${r.source?`<details class="source-line"><summary>Original text · Page ${r.page||1}</summary><p>${esc(r.source)}</p><p>${esc(r.extractionNote)}</p>${r.ambiguous?`<strong>Amounts found: ${r.amountCandidates.map(money).join(', ')}. Verify the charge field above.</strong>`:''}</details>`:''}<div class="line-checks"><label><input type="checkbox" ${busy?'disabled':''} data-field="confirmed" ${r.confirmed?'checked':''}> I checked this line against the bill</label>${hasEstimate(ref)?`<label><input type="checkbox" ${busy?'disabled':''} data-field="comparable" ${r.comparable?'checked':''}> Scope, setting and units match this estimate</label>`:''}</div></article>`;
}
function procedures() {
 const list = local().filter(r=>(view!=='saved'||saved.includes(r.procedure_code))&&(category==='All procedures'||r.category===category)&&`${r.procedure_code} ${r.consumer_label} ${r.category}`.toLowerCase().includes(query.toLowerCase()));
 return `<section class="panel catalog"><div class="catalog-top"><div><h2>${view==='saved'?'My procedure list':'Find a procedure'}</h2><p>${view==='saved'?'Your saved codes follow you as you compare ZIP codes.':'Search medical and dental procedures by name or code.'}</p></div>${badge(`${list.length} procedures`)}</div><div class="filters"><label class="search-field">${icon('search')}<input id="search" placeholder="Try office visit, MRI, or 99213" value="${esc(query)}" aria-label="Search procedures"></label><select id="category" aria-label="Procedure category">${['All procedures',...new Set([...data,...additionalProcedures].map(r=>r.category))].map(c=>`<option ${c===category?'selected':''}>${esc(c)}</option>`).join('')}</select></div>${!list.length?`<div class="empty-small"><h3>${view==='saved'?'Your shortlist starts here.':'No matching procedures.'}</h3><p>${view==='saved'?'Save procedures from Explore prices to compare them here.':'Try a different name, code or category.'}</p><button class="button secondary" data-view="procedures">Explore prices</button></div>`:`<div class="catalog-labels"><span>PROCEDURE</span><span>MODELED RANGE</span><span></span></div><div class="procedure-list">${list.map(r=>`<article class="procedure"><span class="procedure-icon">${icon(r.code_system==='CDT'?'smile':'activity')}</span><div class="procedure-title"><span class="code">${esc(r.code_system)} ${esc(r.procedure_code)}</span><button data-detail="${r.procedure_code}">${esc(r.consumer_label)}</button><small>${esc(r.category)} · ${esc(r.price_unit)}</small></div><div class="price-range"><strong>${hasEstimate(r)?`${money(+r.fair_price_low_usd)} <span>to</span> ${money(+r.fair_price_high_usd)}`:'Price unavailable'}</strong>${hasEstimate(r)?`<div class="range-track"><span></span><b></b></div><small>Midpoint ${money(+r.fair_price_mid_usd)} · Synthetic sample</small>`:'<small>Ask your provider for a quote</small>'}</div><button data-save="${r.procedure_code}" class="save-button ${saved.includes(r.procedure_code)?'saved':''}" aria-label="${saved.includes(r.procedure_code)?'Remove':'Save'} ${esc(r.consumer_label)}">${icon(saved.includes(r.procedure_code)?'bookmark-check':'bookmark')}</button></article>`).join('')}</div>`}</section>`;
}
function composer() {
 if (!scriptText) scriptText = channel==='email'&&aiResult ? personalizedEmail(aiResult,profile) : makeScript({channel,...profile,zip,issues:issues(),rows});
 return `${aiPanel(true)}<div class="script-layout"><section class="panel script-settings"><span class="step">YOUR CONVERSATION PLAN</span><h2>Clear. Calm. Prepared.</h2><p>${channel==='email'&&aiResult?'AI drafted this email from your bill fairness review. Edit it to sound like you.':'This is a local template. Generate an AI review above for a personalized email based on your bill.'}</p><div class="segmented" role="group" aria-label="Script format"><button data-channel="email" class="${channel==='email'?'selected':''}">${icon('mail')} Email</button><button data-channel="call" class="${channel==='call'?'selected':''}">${icon('phone')} Phone</button></div>${[['name','Your name'],['hospital','Hospital or billing team'],['account','Account number']].map(([k,l])=>`<label>${l}<input id="profile-${k}" value="${esc(profile[k])}" placeholder="${k==='account'?'Optional':l}"></label>`).join('')}<button id="regenerate" class="button primary">${icon('refresh-cw')} Update script</button><p class="small-note">Updating replaces edits in the draft. Nothing is sent automatically.</p><div class="script-tip">${icon('notebook-pen')}<div><strong>During your call</strong><p>Write down the representative's name, reference number and follow-up date.</p></div></div></section><section class="panel script-document"><div class="section-heading"><div>${icon(channel==='email'?'mail':'phone')}<h2>${channel==='email'?'Your email draft':'Your call script'}</h2></div>${badge(channel==='email'&&aiResult?'AI-generated · Editable':'Local template · Editable','green')}</div><textarea id="script-text" aria-label="Negotiation script">${esc(scriptText)}</textarea><div class="script-actions"><button class="button secondary" id="download">${icon('download')} Download</button><button class="button primary" id="copy">${icon('copy')} Copy script</button></div></section></div>`;
}
function modal(html) { $('#modal-body').innerHTML=html; $('#modal').showModal(); createIcons({icons}); }
function methodology() { modal(`<span class="eyebrow">PRICING METHODOLOGY</span><h2>How your estimate is calculated</h2><p>Existing ZIP estimates keep their original values. For other ZIP codes, we use up to three nearby reference ZIPs, weighted by geographic distance. Alaska, Hawaii and territories use reference ZIPs within their own state or territory.</p><p>When geography or regional references are unavailable, we use the national anchor and typical price-range ratios in the supplied data. Entering five digits does not confirm that a ZIP is assigned.</p><p>These are modeled estimates before insurance. Procedure details show the calculation basis, scope and units. The original source data and its provenance are available below.</p><p>Bill checks identify review questions, not proven coding errors or fraud.</p><a href="/data/prices.csv" download class="button secondary">Download source CSV</a>`); }
function bind() {
 document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;query='';category='All procedures';if(view==='bills'){refreshLibrary();}else render();window.scrollTo(0,0)});
 $('.brand').onclick=e=>{e.preventDefault();view='review';render()};
 if($('#zip'))$('#zip').onchange=e=>{if(!/^\d{5}$/.test(e.target.value)){notify('Enter a five-digit ZIP code.');e.target.value=zip;return;}zip=e.target.value;rows.forEach(r=>r.comparable=false);scriptText='';render()};
 $('#method-footer').onclick=methodology;
 $('#privacy').onclick=()=>modal('<h2>You control AI review</h2><p>Images, PDFs and raw text are read on this device. If you enable AI and press Generate, the app sends structured codes, amounts, units, ZIP and review status to its server and OpenAI. Service dates and provider names are replaced with anonymous matching labels before transmission. Names, account numbers, descriptions and files are not sent.</p><p>The app does not save bill requests or AI drafts on its server. OpenAI API processing may retain data under its data policies; this is not on-device AI. My bills automatically saves original uploads, bill details, reviews and drafts in this browser on this device. Anyone using this browser profile can open them. Closing a bill does not delete it; use Delete in My bills to remove it. Clearing site data or private browsing can remove saved bills. Bills do not sync to other devices or accounts. Saved procedure codes also persist in this browser. Personal email fields are added locally. Nothing is sent to a billing team automatically.</p>');
 $('#close-modal').onclick=()=>$('#modal').close();
 document.querySelectorAll('[data-new-bill]').forEach(b=>b.onclick=newBill);
 document.querySelectorAll('[data-open-bill]').forEach(b=>b.onclick=()=>openBill(b.dataset.openBill));
 document.querySelectorAll('[data-delete-bill]').forEach(b=>b.onclick=()=>askDeleteBill(b.dataset.deleteBill));
 document.querySelectorAll('[data-download-bill]').forEach(b=>b.onclick=async()=>{try{const record=await getBill(b.dataset.downloadBill);if(record?.file)downloadFile(record.file);else notify('Original file is unavailable.');}catch{notify('Could not open the saved file.');}});
 document.querySelectorAll('[data-retry-save]').forEach(b=>b.onclick=()=>persistCurrent(true));
 if($('#retry-library'))$('#retry-library').onclick=refreshLibrary;
 if($('#bill-name'))$('#bill-name').oninput=e=>{billName=e.target.value.trim().slice(0,120)||'Untitled bill';persistCurrent();};
 if($('#ai-consent'))$('#ai-consent').onchange=e=>{aiConsent=e.target.checked;render()};
 if($('#generate-ai'))$('#generate-ai').onclick=runAI;
 if($('#cancel-ai'))$('#cancel-ai').onclick=()=>{aiRevision++;aiController?.abort();aiBusy=false;render()};
 document.querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>{const r=local().find(r=>r.procedure_code===b.dataset.detail);modal(`<span class="code">${esc(r.code_system)} ${r.procedure_code}</span><h2>${esc(r.consumer_label)}</h2><h3>${hasEstimate(r)?`${money(+r.fair_price_low_usd)} to ${money(+r.fair_price_high_usd)}`:'Price unavailable'}</h3><p>${hasEstimate(r)?`Synthetic sample midpoint: ${money(+r.fair_price_mid_usd)}`:'This procedure has no price benchmark. Request a quote from your provider.'}</p>${r.source_url?`<p><a href="${esc(r.source_url)}" target="_blank" rel="noopener noreferrer">CMS historical code reference</a> · Not a current coding or price authority.</p>`:''}<dl>${[['Price unit',r.price_unit],['Scope',r.price_scope],['Setting',r.default_setting],['Scope ambiguity',r.scope_ambiguity],['Geography',r.geo_id_type],['Pricing ZIP',r.pricing_zip5||'No pricing ZIP'],['Pricing status',r.pricing_status],['Applicability',r.applicability_tier],['Estimate method',r.model_method],['Calculation basis',r.model_basis],['Reference ZIPs',r.model_sources||'National anchor']].map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`)});
 document.querySelectorAll('[data-save]').forEach(b=>b.onclick=()=>{const c=b.dataset.save;saved=saved.includes(c)?saved.filter(x=>x!==c):[...saved,c];try{localStorage.setItem('empealth-procedures',JSON.stringify(saved))}catch{notify('Browser storage unavailable. This list will last for this session.')}render()});
 if($('#search')) $('#search').oninput=e=>{const pos=e.target.selectionStart;query=e.target.value;render();$('#search').focus();$('#search').setSelectionRange(pos,pos)};
 if($('#category')) $('#category').onchange=e=>{category=e.target.value;render()};
 if(view==='review') {
  $('#choose-file').onclick=()=>$('#file').click(); $('#choose-camera').onclick=()=>$('#camera').click(); $('#file').onchange=e=>scan(e.target.files[0]); $('#camera').onchange=e=>scan(e.target.files[0]);
  $('#dropzone').ondragover=e=>{e.preventDefault();e.currentTarget.classList.add('dragging')};$('#dropzone').ondragleave=e=>e.currentTarget.classList.remove('dragging');$('#dropzone').ondrop=e=>{e.preventDefault();if(!busy)scan(e.dataTransfer.files[0])};
  if($('#cancel'))$('#cancel').onclick=()=>controller.abort();
  if($('#retry-ocr'))$('#retry-ocr').onclick=()=>scan(lastFile,true);
  if($('#review-text'))$('#review-text').onclick=()=>{document.querySelector('.raw-details').open=true;$('#raw').scrollIntoView({behavior:'smooth'});$('#raw').focus()};
  $('#demo').onclick=async()=>{if(busy||!await persistCurrent())return;resetCurrent();scanReport=null;extraction={summaries:[],unmatched:[]};sample=true;raw='09/01/2026 99213 Office visit $285.00\n09/01/2026 99213 Office visit $285.00\n09/01/2026 80053 Metabolic panel $145.00';rows=parseBill(raw).map(r=>({...r,provider:'Sample Medical Group'}));total='715';scriptText='';render();$('.bill-panel').scrollIntoView({behavior:'smooth',block:'start'})};
  $('#add-line').onclick=()=>{rows.push({id:crypto.randomUUID(),code:'',date:'',description:'',provider:'',modifier:'',units:1,amount:0,confirmed:false,comparable:false});render()};
  $('#raw').oninput=e=>{raw=e.target.value;persistCurrent();};
  $('#parse').onclick=()=>{const result=extractBill(raw);rows=result.rows;extraction=result;sample=false;total='';scriptText='';scanReport={name:'Pasted text',pages:[],warnings:[],message:`${rows.length} draft lines found. Review statement amounts and unmatched text below.`};render()};
  if($('#total'))$('#total').onchange=e=>{total=e.target.value;scriptText='';render()};
  if($('#clear-bill'))$('#clear-bill').onclick=async()=>{if(busy||!await persistCurrent())return;resetCurrent();view='bills';render();notify('Bill closed. Reopen it from My bills.');};
  document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{rows=rows.filter(r=>r.id!==b.dataset.remove);scriptText='';render()});
  document.querySelectorAll('[data-field]').forEach(input=>input.onchange=()=>{const r=rows.find(r=>r.id===input.closest('[data-id]').dataset.id),key=input.dataset.field;r[key]=input.type==='checkbox'?input.checked:input.type==='number'?(input.value===''?NaN:Number(input.value)):input.value.trim();if(key==='code')r.code=r.code.toUpperCase();if(!['confirmed','comparable'].includes(key)){r.confirmed=false;r.comparable=false;}scriptText='';render()});
 }
 if(view==='script') {
  document.querySelectorAll('[data-channel]').forEach(b=>b.onclick=()=>{channel=b.dataset.channel;scriptText='';render()});
  Object.keys(profile).forEach(k=>$('#profile-'+k).oninput=e=>{profile[k]=e.target.value;persistCurrent();});
  $('#script-text').oninput=e=>{scriptText=e.target.value;persistCurrent();};
  $('#regenerate').onclick=()=>{scriptText='';render()};
  $('#copy').onclick=async()=>{try{await navigator.clipboard.writeText(scriptText);notify('Script copied.')}catch{notify('Copy unavailable. Select and copy the draft text.')}};
  $('#download').onclick=()=>{const a=document.createElement('a'),url=URL.createObjectURL(new Blob([scriptText],{type:'text/plain'}));a.href=url;a.download=`empealth-${channel}-script.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
 }
}
async function scan(file,forceOCR=false) {
 if(!file||busy)return;
 if(file.size>25*1024*1024)return notify('Choose a file smaller than 25 MB.');
 if(!/\.(pdf|png|jpe?g|webp|bmp)$/i.test(file.name)&&!/^application\/pdf$|^image\/(png|jpeg|webp|bmp)$/.test(file.type))return notify('Choose a PDF, JPG, PNG, WebP or BMP file.');
 busy=true;
 if(!await persistCurrent()){busy=false;return notify('Save your current bill before uploading another.');}
 if(!forceOCR)resetCurrent();
 lastFile=file;billName=billName||file.name;if(!forceOCR)scanReport={name:file.name,pages:[],warnings:[],message:'Reading this bill. If scanning is interrupted, reopen it and retry OCR.'};busy=true;controller=new AbortController();scanMessage='Preparing local scanner...';render();
 // Commit the original file before scanning so failed or canceled OCR can be retried later.
 await persistCurrent();
 try {
  const {readBill}=await import('./ocr.js');
  const result=await readBill(file,message=>{scanMessage=message;if($('#scan-progress'))$('#scan-progress').textContent=message},controller.signal,{forceOCR});
  if(controller.signal.aborted)throw new Error('Scan canceled.');
  const parsed=extractBill(result.text);raw=result.text;rows=parsed.rows;extraction=parsed;total='';sample=false;scriptText='';
  scanReport={...result,name:file.name,message:rows.length?`${rows.length} draft charge lines found. Verify the amounts and codes against your bill.`:parsed.summaries.length?'Statement amounts found, but no itemized services were detected. Request an itemized bill, or review the extracted text below.':'No charge lines could be identified. Try enhanced OCR, a clearer image, or paste the bill text below.'};
 }catch(e){scanReport={name:file.name,pages:[],warnings:[],error:true,message:e.message||'This file could not be read. Try a clearer PDF or JPG, or paste its text below.'};}
 finally{busy=false;render();if(view==='review')document.querySelector('.scan-result')?.scrollIntoView({behavior:'smooth',block:'start'});}
}
async function start() { try { const response=await fetch('/data/prices.csv');if(!response.ok)throw new Error('Price data unavailable');data=parseCSV(await response.text());let geography={};try{const geo=await fetch('/data/zip-geography.json');if(geo.ok)geography=await geo.json();}catch{}pricing=createPricingModel(data,geography);await refreshLibrary(); }catch(e){$('#app').innerHTML='<main><h1>We could not load the price data.</h1><p>Check your connection and reload the page.</p><button onclick="location.reload()">Try again</button></main>';} }
start();
