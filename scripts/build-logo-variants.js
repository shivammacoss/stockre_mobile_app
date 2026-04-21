// Generates the dark + light theme wordmark PNGs from the single source
// JPEG the client dropped into assets/. Used by AppHeader.tsx and the
// three auth screens.
//
// Source: assets/logo.jpeg — white "stock" + green "tre" on black.
// Dark output: raw source as PNG, trimmed of outer black padding.
// Light output: per-pixel swap so the background fits a light surface.
//
// Run with: node scripts/build-logo-variants.js

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SRC = path.join(__dirname, '..', 'assets', 'logo.jpeg');
const OUT_DARK = path.join(__dirname, '..', 'assets', 'stocktre-logo-dark.png');
const OUT_LIGHT = path.join(__dirname, '..', 'assets', 'stocktre-logo-light.png');

// Per-pixel classifier:
//   - "green-ish" (brand accent) stays exactly as-is
//   - "black-ish" (background)  -> white on light
//   - "white-ish" (the "stock"  -> dark navy on light (#0d1526)
//     letters)
// Anything else is mapped by luminance: dark -> white, light -> dark.
// Tolerances picked to work with JPEG compression fuzz around edges.
const isGreen = (r, g, b) => g > 120 && r < 120 && b < 150 && g - r > 40;
const isBlack = (r, g, b) => r < 50 && g < 50 && b < 50;
const isWhite = (r, g, b) => r > 210 && g > 210 && b > 210;

async function main() {
  // 1. Trim outer black padding so both variants have tight crops.
  const trimmed = await sharp(SRC)
    .trim({ threshold: 20 })
    .toBuffer();
  const meta = await sharp(trimmed).metadata();
  console.log('trimmed:', meta.width, 'x', meta.height);

  // 2. Dark variant = trimmed JPEG re-saved as PNG.
  await sharp(trimmed).png().toFile(OUT_DARK);
  console.log('wrote', OUT_DARK);

  // 3. Light variant — raw RGBA → transform → PNG.
  const { data, info } = await sharp(trimmed)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out = Buffer.from(data);
  const count = info.width * info.height;
  const DARK_TEXT_R = 13, DARK_TEXT_G = 21, DARK_TEXT_B = 38;

  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const r = out[o], g = out[o + 1], b = out[o + 2];
    if (isGreen(r, g, b)) {
      // keep brand green
      continue;
    } else if (isBlack(r, g, b)) {
      out[o] = 255; out[o + 1] = 255; out[o + 2] = 255;
    } else if (isWhite(r, g, b)) {
      out[o] = DARK_TEXT_R; out[o + 1] = DARK_TEXT_G; out[o + 2] = DARK_TEXT_B;
    } else {
      // grey / antialiased edge — invert by luminance
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum < 128) {
        // was closer to black edge -> push toward white
        out[o] = Math.min(255, r + (255 - lum));
        out[o + 1] = Math.min(255, g + (255 - lum));
        out[o + 2] = Math.min(255, b + (255 - lum));
      } else {
        // was closer to white edge -> push toward dark
        out[o] = Math.max(0, r - lum + DARK_TEXT_R);
        out[o + 1] = Math.max(0, g - lum + DARK_TEXT_G);
        out[o + 2] = Math.max(0, b - lum + DARK_TEXT_B);
      }
    }
  }

  await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toFile(OUT_LIGHT);
  console.log('wrote', OUT_LIGHT);
}

main().catch((e) => { console.error(e); process.exit(1); });
