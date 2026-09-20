import {readFile, writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
await writeFile('public/data/prices.csv', gunzipSync(await readFile('public/data/prices.csv.gz')));
