import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {parseCSV} from '../src/engine.js';
import {createPricingModel} from '../src/pricing.js';
import {catalogForZip} from '../src/catalog.js';
import {createApp} from './app.js';
const root=fileURLToPath(new URL('../',import.meta.url));
// Node's env loader does not replace environment variables set by a hosting service.
try{process.loadEnvFile(resolve(root,'.env.local'));}catch(e){if(e.code!=='ENOENT')throw e;}
const data=parseCSV(readFileSync(resolve(root,'public/data/prices.csv'),'utf8'));
const geography=JSON.parse(readFileSync(resolve(root,'public/data/zip-geography.json'),'utf8'));
const prices=createPricingModel(data,geography);
const production=process.env.NODE_ENV==='production';
if(production&&!process.env.APP_ORIGIN)throw new Error('Set APP_ORIGIN to your HTTPS app origin before starting production.');
const server=createApp({pricing:zip=>catalogForZip(prices(zip),zip),apiKey:process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL||'gpt-4o-mini',
  origin:process.env.APP_ORIGIN,dist:resolve(root,'dist'),maxDailyRequests:Number(process.env.AI_DAILY_REQUEST_LIMIT)||200});
server.requestTimeout=60000;
server.listen(Number(process.env.PORT)||3001,process.env.HOST||(production?'0.0.0.0':'127.0.0.1'),()=>console.log(`Empealth server ready on port ${server.address().port}`));
