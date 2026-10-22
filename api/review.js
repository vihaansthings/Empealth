import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {parseCSV} from '../src/engine.js';
import {createPricingModel} from '../src/pricing.js';
import {catalogForZip} from '../src/catalog.js';
import {createHandler} from '../server/app.js';

let handler;
export default async function review(req,res) {
  if(!handler){
    const data=parseCSV(gunzipSync(readFileSync(new URL('../public/data/prices.csv.gz',import.meta.url))).toString('utf8'));
    const geography=JSON.parse(readFileSync(new URL('../public/data/zip-geography.json',import.meta.url),'utf8'));
    const prices=createPricingModel(data,geography);
    const origins=[process.env.APP_ORIGIN,...['VERCEL_URL','VERCEL_PROJECT_PRODUCTION_URL','VERCEL_BRANCH_URL'].map(key=>process.env[key]?`https://${process.env[key]}`:null)].filter(Boolean);
    // Fail closed if no trusted deployment origin is configured.
    handler=createHandler({pricing:zip=>catalogForZip(prices(zip),zip),apiKey:process.env.OPENAI_API_KEY,
      model:process.env.OPENAI_MODEL||'gpt-4o-mini',origin:origins.length?origins:['https://unconfigured.invalid'],
      maxDailyRequests:Number(process.env.AI_DAILY_REQUEST_LIMIT)||200});
  }
  return handler(req,res);
}
