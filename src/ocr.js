import { createWorker } from 'tesseract.js';
import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
export async function readBill(file, progress, signal) {
  if (file.size > 25 * 1024 * 1024) throw new Error('Choose a file smaller than 25 MB.');
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf && !/^image\/(png|jpeg|webp|bmp)$/.test(file.type)) throw new Error('Use a PDF, JPG, PNG, WebP or BMP file.');
  let worker, pdf;
  const abort = () => { worker?.terminate(); pdf?.destroy(); };
  signal?.addEventListener('abort', abort);
  const check = () => { if (signal?.aborted) throw new Error('Scan canceled.'); };
  const recognize = async image => {
    check();
    if (!worker) worker = await createWorker('eng', 1, { workerPath: '/ocr/worker.min.js', corePath: '/ocr', langPath: '/ocr', logger: m => progress(`${m.status}${m.progress ? ` ${Math.round(m.progress * 100)}%` : ''}`) });
    check();
    return (await worker.recognize(image)).data.text;
  };
  try {
    if (!isPdf) return await recognize(file);
    pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
    if (pdf.numPages > 20) throw new Error('This PDF has more than 20 pages. Split it into smaller files first.');
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      check(); progress(`Reading page ${n} of ${pdf.numPages}`);
      const page = await pdf.getPage(n); const content = await page.getTextContent();
      let text = '', lastY;
      for (const item of content.items) { if (!('str' in item)) continue; const y = item.transform[5]; if (lastY !== undefined && Math.abs(y - lastY) > 4) text += '\n'; text += item.str + (item.hasEOL ? '\n' : ' '); lastY = y; }
      if (text.trim().length < 30) {
        const viewport = page.getViewport({ scale: 1.8 });
        if (viewport.width * viewport.height > 16000000) throw new Error('This page is too large. Export it at a lower resolution.');
        const canvas = document.createElement('canvas'); canvas.width = viewport.width; canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), canvas, viewport }).promise;
        text = await recognize(canvas); canvas.width = 0; canvas.height = 0;
      }
      pages.push(text); page.cleanup();
    }
    return pages.join('\n');
  } finally { signal?.removeEventListener('abort', abort); await worker?.terminate(); await pdf?.destroy(); }
}
