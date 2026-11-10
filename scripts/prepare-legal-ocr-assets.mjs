import { mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
// Same-origin runtime assets: no OCR credentials, desktop binaries or CDN dependency.
export function prepareLegalOcrAssets() {
  const target = resolve('public/legal-ocr'); mkdirSync(target, { recursive: true });
  copyFileSync(resolve('node_modules/tesseract.js/dist/worker.min.js'), resolve(target, 'worker.min.js'));
  for (const name of readdirSync('node_modules/tesseract.js-core')) {
    if (/^tesseract-core.*\.wasm(?:\.js)?$/.test(name)) copyFileSync(resolve('node_modules/tesseract.js-core', name), resolve(target, name));
  }
  copyFileSync(resolve('node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz'), resolve(target, 'eng.traineddata.gz'));
}
