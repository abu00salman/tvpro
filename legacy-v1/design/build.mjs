// Appends design/tvx.css to the compiled stylesheet (the app ships only as a built bundle).
// Usage: node design/build.mjs   (idempotent: replaces any earlier appended layer)
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const target = path.join(root, '_next/static/css/2a4482471ba7d4f4.css');
const MARK = '/*tvx-layer*/';
const layer = readFileSync(path.join(root, 'design/tvx.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s*\n\s*/g, '')
  .replace(/\s*([{};,])\s*/g, '$1')
  .replace(/;}/g, '}');
const base = readFileSync(target, 'utf8').split(MARK)[0];
writeFileSync(target, base + MARK + layer);
console.log(`design layer: ${layer.length} bytes appended`);
