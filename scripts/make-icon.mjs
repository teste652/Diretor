// Gera build/icon.ico (Windows) e build/icon.png a partir de build/icon.svg.
// Só é preciso rodar de novo quando o desenho mudar: node scripts/make-icon.mjs
// Usa o Chromium do Playwright para desenhar cada tamanho nítido (inclusive os pequenos).
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const svg = readFileSync('build/icon.svg', 'utf8');
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const browser = await chromium.launch();
const page = await browser.newPage();
const render = async (size) => {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg style="display:block;width:${size}px;height:${size}px" `)}</body></html>`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
};
const pngs = [];
for (const s of sizes) pngs.push(await render(s));
writeFileSync('build/icon.png', await render(512));
await browser.close();

// ICO com as imagens em PNG (aceito pelo Windows desde o Vista).
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(s >= 256 ? 0 : s, 0);
  e.writeUInt8(s >= 256 ? 0 : s, 1);
  e.writeUInt8(0, 2);
  e.writeUInt8(0, 3);
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(pngs[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  return e;
});
writeFileSync('build/icon.ico', Buffer.concat([header, ...entries, ...pngs]));
console.log(`build/icon.ico (${sizes.join(', ')} px) e build/icon.png (512 px) gerados.`);
