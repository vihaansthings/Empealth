import {readFile, writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
await writeFile('public/data/prices.csv', gunzipSync(await readFile('public/data/prices.csv.gz')));
// Bundle ZIP centroids locally so ZIP input never goes to a geocoding service.
const { default: zipcodes } = await import('zipcodes');
const geography = Object.fromEntries(Object.entries(zipcodes.codes).filter(([zip,r])=>/^\d{5}$/.test(zip)&&Number.isFinite(r.latitude)&&Number.isFinite(r.longitude)).map(([zip,r])=>[zip,[r.city,r.state,r.latitude,r.longitude]]));
await writeFile('public/data/zip-geography.json', JSON.stringify(geography));
await writeFile('public/data/zip-geography-LICENSE.txt', await readFile('node_modules/zipcodes/LICENSE'));
