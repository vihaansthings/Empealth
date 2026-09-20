import { mkdir, cp, readdir } from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname} from 'node:path';
const require = createRequire(import.meta.url);
const core = dirname(createRequire(require.resolve('tesseract.js')).resolve('tesseract.js-core/package.json'));

await mkdir('public/ocr', { recursive: true });
await cp('node_modules/tesseract.js/dist/worker.min.js', 'public/ocr/worker.min.js');
for (const name of await readdir(core)) {
  if (name.endsWith('.wasm') || name.endsWith('.wasm.js')) await cp(`${core}/${name}`, `public/ocr/${name}`);
}
await cp('node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'public/ocr/eng.traineddata.gz');
