import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {ReviewError, buildContext, generateReview} from './review.js';
const mime = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.csv':'text/csv', '.gz':'application/gzip', '.wasm':'application/wasm', '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon'};
function json(res, status, body) {
  res.writeHead(status, {'Content-Type':'application/json', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(body));
}
async function readJSON(req) {
  let size = 0, parts = [];
  for await (const part of req) { size += part.length; if (size > 65536) throw new ReviewError('Bill request is too large.', 413); parts.push(part); }
  try { return JSON.parse(Buffer.concat(parts).toString()); } catch { throw new ReviewError('Send a valid bill review request.'); }
}
export function createApp({pricing, apiKey, model, origin, dist = resolve('dist'), generate = generateReview, rateLimit = 10, maxDailyRequests = 200, now = Date.now}) {
  const clients = new Map(); let active = 0, daily = 0, dayStart = now();
  return createServer(async (req,res) => {
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (path.startsWith('/api/')) {
        if (path !== '/api/review') return json(res,404,{error:'Not found.'});
        if (req.method !== 'POST') return json(res,405,{error:'Use POST for bill reviews.'});
        // Exact configured origin in production. No permissive CORS or forwarded-host trust.
        const allowed = origin || `http://${req.headers.host}`;
        if (req.headers.origin !== allowed || (req.headers['sec-fetch-site'] && !['same-origin','none'].includes(req.headers['sec-fetch-site']))) return json(res,403,{error:'Open AI review from the app.'});
        if (!req.headers['content-type']?.startsWith('application/json')) return json(res,415,{error:'Use a JSON bill request.'});
        if (!apiKey) return json(res,503,{error:'AI review is not configured on this server yet. Local checks remain available.'});
        const time=now();
        for(const [ip,c] of clients) if(time-c.start>=60000) clients.delete(ip);
        const ip=req.socket.remoteAddress, c=clients.get(ip)||{start:time,count:0};
        if(time-dayStart>=86400000){daily=0;dayStart=time;}
        if(c.count>=rateLimit||daily>=maxDailyRequests||active>=4) return json(res,429,{error:'AI request limit reached. Please try later.'});
        c.count++; clients.set(ip,c);
        const input = await readJSON(req);
        const context = buildContext(input, pricing(input?.zip));
        daily++; active++;
        try { return json(res,200,await generate(context,{apiKey,model})); } finally { active--; }
      }
      if (!['GET','HEAD'].includes(req.method)) return json(res,405,{error:'Method not allowed.'});
      let decoded;try{decoded=decodeURIComponent(path);}catch{return json(res,400,{error:'Invalid path.'});}
      if(decoded.split('/').some(p=>p.startsWith('.')))return json(res,404,{error:'Not found.'});
      let file=resolve(dist, `.${decoded === '/' ? '/index.html' : decoded}`);
      if(!file.startsWith(dist+sep))return json(res,404,{error:'Not found.'});
      try { if(!(await stat(file)).isFile())throw new Error(); } catch { return json(res,404,{error:'Not found.'}); }
      const body=await readFile(file);
      res.writeHead(200, {'Content-Type':mime[extname(file)]||'application/octet-stream', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'same-origin'});
      res.end(req.method==='HEAD'?undefined:body);
    } catch(e) { if(!res.headersSent)json(res,e instanceof ReviewError?e.status:500,{error:e instanceof ReviewError?e.message:'The review could not be completed. Please try again.'}); }
  });
}
