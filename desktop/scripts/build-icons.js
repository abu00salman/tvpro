'use strict';
// Builds build/icon.icns (macOS) and build/icon.ico (Windows) from the website's existing 512px TV Pro logo.
// No native macOS tools (iconutil/sips) needed — png2icons does this in pure JS.
const fs = require('node:fs');
const path = require('node:path');
const png2icons = require('png2icons');

const SRC = path.join(__dirname, '..', '..', 'icons', 'icon-512.png');
const OUT_DIR = path.join(__dirname, '..', 'build');

function main() {
  if (!fs.existsSync(SRC)) throw new Error('missing source icon: ' + SRC);
  const input = fs.readFileSync(SRC);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const icns = png2icons.createICNS(input, png2icons.BILINEAR, 0);
  if (!icns) throw new Error('png2icons failed to produce an .icns');
  fs.writeFileSync(path.join(OUT_DIR, 'icon.icns'), icns);

  const ico = png2icons.createICO(input, png2icons.BILINEAR, 0, false, true);
  if (!ico) throw new Error('png2icons failed to produce an .ico');
  fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), ico);

  console.log('wrote build/icon.icns and build/icon.ico from', path.relative(process.cwd(), SRC));
}

main();
