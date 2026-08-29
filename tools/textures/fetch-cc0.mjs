#!/usr/bin/env node
// Fetch a CC0 texture from ambientCG and convert it into the repo.
//
//   node tools/textures/fetch-cc0.mjs Planks021 --as crate --size 256
//
// Why a browser: the source images are JPEG and we have no image decoder in the
// dependency set. Playwright is already here for headless verification, so we
// decode and resample through a canvas rather than adding a native dep.
//
// ambientCG assets are CC0 1.0 (public domain). Attribution is not required but
// is recorded in public/textures/cc0/CREDITS.md so provenance stays traceable.
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { readZip } from '../lib/zip.mjs';
import { encodePng } from '../lib/png.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i < 0 ? d : argv[i + 1]; };
const assetId = argv[0];
const as = flag('--as', assetId?.toLowerCase());
const size = Number(flag('--size', 256));
const outDir = flag('--out', 'public/textures/cc0');
if (!assetId) { console.error('usage: fetch-cc0.mjs <ambientCG assetId> [--as name] [--size 256]'); process.exit(1); }

const api = `https://ambientcg.com/api/v2/full_json?type=Material&include=downloadData&id=${assetId}`;
const meta = await (await fetch(api)).json();
const asset = meta.foundAssets?.find((a) => a.assetId === assetId) ?? meta.foundAssets?.[0];
if (!asset) throw new Error(`ambientCG: no asset ${assetId}`);

const dl = asset.downloadFolders?.default?.downloadFiletypeCategories?.zip?.downloads ?? [];
const pick = dl.find((d) => d.attribute === '1K-JPG') ?? dl.find((d) => d.attribute === '1K-PNG');
if (!pick) throw new Error(`ambientCG: ${assetId} has no 1K zip`);
console.log(`${assetId}: ${pick.attribute} ${(pick.size / 1024 | 0)}KB`);

const zipBuf = Buffer.from(await (await fetch(pick.downloadLink)).arrayBuffer());
const zip = readZip(zipBuf);
// the albedo is the only map we need; normal/roughness would want a PBR path
const colorEntry = zip.entries.find((e) => /_Color\.(jpg|png)$/i.test(e.name));
if (!colorEntry) throw new Error(`no _Color map in ${assetId}: ${zip.entries.map((e) => e.name).join(', ')}`);
const imgBuf = zip.read(colorEntry);
console.log(`  ${colorEntry.name} -> ${size}x${size}`);

// decode + resample in a browser canvas
const browser = await chromium.launch();
const page = await browser.newPage();
const dataUrl = `data:image/${/\.png$/i.test(colorEntry.name) ? 'png' : 'jpeg'};base64,${imgBuf.toString('base64')}`;
const rgba = await page.evaluate(async ([url, n]) => {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = n; c.height = n;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, n, n);
  return Array.from(ctx.getImageData(0, 0, n, n).data);
}, [dataUrl, size]);
await browser.close();

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `${as}.png`), encodePng(new Uint8Array(rgba), size, size));

// keep provenance next to the files
const credits = join(outDir, 'CREDITS.md');
const header = `# CC0 textures\n\nStand-ins for assets we cannot ship (see docs/ASSET-RECOVERY.md).\nAll files here are **CC0 1.0** — public domain, no attribution required. Credited\nanyway so provenance stays traceable, and so they are easy to swap for our own.\n\n| file | source | asset | licence |\n|---|---|---|---|\n`;
const row = `| ${as}.png | [ambientCG](https://ambientcg.com/view?id=${assetId}) | ${assetId} | CC0 1.0 |\n`;
let body = existsSync(credits) ? readFileSync(credits, 'utf8') : header;
if (!body.includes(`| ${as}.png |`)) body += row;
writeFileSync(credits, body);

console.log(`  wrote ${join(outDir, `${as}.png`)}`);
