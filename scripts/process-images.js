#!/usr/bin/env node
/**
 * Bulk product image processor
 * Normalizes all images in img/ to 1000x1000 WebP, white background, 72dpi equivalent
 *
 * Usage:
 *   npm install sharp
 *   node scripts/process-images.js
 *   node scripts/process-images.js --dry-run   (preview only, no writes)
 *   node scripts/process-images.js --out=dist/img  (different output dir)
 */

const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const outArg = args.find(a => a.startsWith("--out="));
const INPUT_DIR = path.resolve(__dirname, "../img");
const OUTPUT_DIR = outArg ? path.resolve(outArg.split("=")[1]) : INPUT_DIR;

const SIZE = 1000;
const QUALITY = 88;           // WebP quality (0-100)
const PADDING = 80;           // px of white margin around product
const INNER = SIZE - PADDING * 2;

const EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff"]);

async function processImage(inputPath, outputPath) {
  // Load original
  const img = sharp(inputPath).rotate(); // auto-rotate from EXIF

  const meta = await img.metadata();

  // Flatten transparency onto white, then resize to fit within INNER×INNER
  const flattened = sharp(await img
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .toBuffer()
  ).resize(INNER, INNER, {
    fit: "inside",
    withoutEnlargement: false,
    background: { r: 255, g: 255, b: 255 },
  });

  // Composite centered on 1000×1000 white canvas
  const canvas = sharp({
    create: {
      width: SIZE,
      height: SIZE,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  });

  const resizedBuf = await flattened.toBuffer({ resolveWithObject: true });
  const { width: rw, height: rh } = resizedBuf.info;

  const left = Math.round((SIZE - rw) / 2);
  const top = Math.round((SIZE - rh) / 2);

  const outWebP = outputPath.replace(/\.[^.]+$/, ".webp");

  if (DRY_RUN) {
    console.log(`[DRY] ${path.basename(inputPath)} → ${path.basename(outWebP)} (${rw}×${rh} centered)`);
    return;
  }

  await canvas
    .composite([{ input: resizedBuf.data, left, top, raw: { width: rw, height: rh, channels: 3 } }])
    .webp({ quality: QUALITY, effort: 4 })
    .toFile(outWebP);

  // Remove original if it had a different extension and we wrote a new .webp
  if (inputPath !== outWebP && fs.existsSync(inputPath)) {
    fs.unlinkSync(inputPath);
  }

  const { size } = fs.statSync(outWebP);
  console.log(`✓ ${path.basename(outWebP)} — ${(size / 1024).toFixed(0)} KB`);
}

async function main() {
  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`img/ directory not found at ${INPUT_DIR}`);
    process.exit(1);
  }
  if (!DRY_RUN && !fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const files = fs.readdirSync(INPUT_DIR).filter(f => EXTS.has(path.extname(f).toLowerCase()));

  if (!files.length) {
    console.log("No images found in", INPUT_DIR);
    return;
  }

  console.log(`Processing ${files.length} images → ${OUTPUT_DIR}${DRY_RUN ? " (DRY RUN)" : ""}\n`);

  let ok = 0, fail = 0;
  for (const file of files) {
    const inputPath = path.join(INPUT_DIR, file);
    const outputPath = path.join(OUTPUT_DIR, file);
    try {
      await processImage(inputPath, outputPath);
      ok++;
    } catch (err) {
      console.error(`✗ ${file}: ${err.message}`);
      fail++;
    }
  }

  console.log(`\nDone — ${ok} converted, ${fail} failed.`);
  if (ok > 0 && !DRY_RUN) {
    console.log("\nNext: update index.html img src refs from .jpg/.png → .webp");
    console.log('Run: grep -rl \'"img/\' index.html | xargs sed -i \'\' \'s/\\.jpg"/.webp"/g; s/\\.png"/.webp"/g\'');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
