import { createWorker } from 'tesseract.js';
import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {extractBill,pdfTextLines} from './extraction.js';
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
export async function readBill(file, progress, signal, options={}) {
  if(file.size>25*1024*1024)throw new Error('Choose a file smaller than 25 MB.');
  const isPdf=file.type==='application/pdf'||/\.pdf$/i.test(file.name);
  if(!isPdf&&!/^image\/(png|jpeg|webp|bmp)$/.test(file.type)&&! /\.(png|jpe?g|webp|bmp)$/i.test(file.name))throw new Error('Use a PDF, JPG, PNG, WebP or BMP. For an iPhone HEIC photo, export it as JPG first.');
  let worker,pdf,loading,renderTask,stopped=false;
  const warnings=[],pages=[];
  const stop=()=>{stopped=true;worker?.terminate().catch(()=>{});renderTask?.cancel();loading?.destroy().catch(()=>{});};
  const check=()=>{if(signal?.aborted||stopped)throw new Error('Scan canceled.');};
  signal?.addEventListener('abort',stop);
  // Explicit timeouts and cancellation prevent a missing worker/language asset from hanging forever.
  const bounded=(promise,label,ms=120000)=>new Promise((resolve,reject)=>{
    const done=(fn,value)=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);fn(value);};
    const cancel=()=>done(reject,new Error('Scan canceled.'));
    const timer=setTimeout(()=>{stop();done(reject,new Error(`${label} took too long. Try a smaller, clearer file or paste the text below.`));},ms);
    signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
    Promise.resolve(promise).then(v=>done(resolve,v),e=>done(reject,e));
  });
  async function recognize(image,pageNumber){
    check();progress(`Page ${pageNumber}: loading local OCR`);
    if(!worker)worker=await bounded(createWorker('eng',1,{workerPath:'/ocr/worker.min.js',corePath:'/ocr',langPath:'/ocr',logger:m=>progress(`Page ${pageNumber}: ${m.status}${m.progress?` ${Math.round(m.progress*100)}%`:''}`)}).then(w=>{if(stopped){w.terminate();throw new Error('Scan canceled.')}return w;}),'OCR startup');
    check();await worker.setParameters({preserve_interword_spaces:'1'});
    const result=await bounded(worker.recognize(image, {rotateAuto:true}),'OCR recognition');
    return {text:result.data.text,confidence:Math.round(result.data.confidence),method:'On-device OCR'};
  }
  try {
    check();
    if(!isPdf){
      const bitmap=await bounded(createImageBitmap(file),'Image decoding',30000);
      const scale=Math.min(2,2400/Math.max(bitmap.width,bitmap.height));
      const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
      const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
      try{pages.push({page:1,...await recognize(canvas,1)})}finally{canvas.width=canvas.height=0;}
    }else{
      progress('Opening PDF on this device');
      loading=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false});
      pdf=await bounded(loading.promise,'PDF loading',30000);
      if(pdf.numPages>20)throw new Error('This PDF has more than 20 pages. Split it into files of 20 pages or fewer.');
      for(let n=1;n<=pdf.numPages;n++){
        check();progress(`Reading page ${n} of ${pdf.numPages}`);
        const page=await pdf.getPage(n);let direct='';
        try{direct=pdfTextLines((await page.getTextContent()).items)}catch{warnings.push(`Page ${n}: text layer could not be read.`)}
        let selected={text:direct,method:'PDF text',confidence:null};
        const directRows=extractBill(direct).rows;
        // A readable header is not evidence that an embedded charge table is readable.
        if(options.forceOCR||!directRows.length){
          try{
            const base=page.getViewport({scale:1});const scale=Math.min(2.5,3000/Math.max(base.width,base.height));const viewport=page.getViewport({scale});
            const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
            try{renderTask=page.render({canvasContext:canvas.getContext('2d'),canvas,viewport});await bounded(renderTask.promise,'PDF page rendering',30000);const ocr=await recognize(canvas,n);if(options.forceOCR||extractBill(ocr.text).rows.length>directRows.length||ocr.text.length>direct.length&& !directRows.length)selected=ocr;}finally{renderTask=null;canvas.width=canvas.height=0;}
          }catch(e){if(signal?.aborted||stopped)throw e;warnings.push(`Page ${n}: ${e.message}. Kept any readable PDF text.`)}
        }
        pages.push({page:n,...selected});page.cleanup();
      }
    }
    check();return {text:pages.map(p=>`[Page ${p.page}]\n${p.text}`).join('\n\n'),pages:pages.map(({text,...p})=>({...p,characters:text.trim().length,lines:extractBill(text).rows.length})),warnings};
  }catch(e){if(signal?.aborted)throw new Error('Scan canceled. Your previous breakdown is unchanged.');if(e.name==='PasswordException')throw new Error('This PDF is password protected. Export an unlocked copy and try again.');throw e;}
  finally{signal?.removeEventListener('abort',stop);await worker?.terminate().catch(()=>{});await pdf?.destroy().catch(()=>{});}
}
