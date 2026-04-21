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

// Convert trimmed RGBA pixels into a transparent-bg variant with a given
// foreground color for the white "stock" letters. Brand green stays as-is
// in both variants. Near-black pixels become fully transparent so the logo
// sits cleanly on any surface color (dark header, light header, splash).
function renderVariant(raw, info, fgColor) {
  const out = Buffer.from(raw);
  const count = info.width * info.height;
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const r = out[o], g = out[o + 1], b = out[o + 2];

    if (isGreen(r, g, b)) {
      // Keep brand green opaque.
      out[o + 3] = 255;
      continue;
    }

    if (isBlack(r, g, b)) {
      // Background -> fully transparent.
      out[o + 3] = 0;
      continue;
    }

    if (isWhite(r, g, b)) {
      out[o] = fgColor.r; out[o + 1] = fgColor.g; out[o + 2] = fgColor.b;
      out[o + 3] = 255;
      continue;
    }

    // Anti-aliased edges — preserve the glyph silhouette but recolor.
    // Luminance picks whether this pixel is "more text" or "more bg"; we
    // use it to interpolate both color and alpha toward the target.
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum < 128) {
      // Mostly-background edge -> mostly transparent.
      out[o + 3] = Math.round((lum / 128) * 255);
      out[o] = fgColor.r; out[o + 1] = fgColor.g; out[o + 2] = fgColor.b;
    } else {
      // Mostly-text edge -> opaque, color toward foreground.
      out[o] = fgColor.r; out[o + 1] = fgColor.g; out[o + 2] = fgColor.b;
      out[o + 3] = 255;
    }
  }
  return out;
}

async function main() {
  // 1. Trim outer black padding so both variants have tight crops.
  const trimmed = await sharp(SRC)
    .trim({ threshold: 20 })
    .toBuffer();
  const meta = await sharp(trimmed).metadata();
  console.log('trimmed:', meta.width, 'x', meta.height);

  // 2. Raw RGBA buffer — shared between both variants.
  const { data, info } = await sharp(trimmed)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // 3. Dark variant — transparent bg + white "stock" text + green kept.
  const dark = renderVariant(data, info, { r: 255, g: 255, b: 255 });
  await sharp(dark, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toFile(OUT_DARK);
  console.log('wrote', OUT_DARK);

  // 4. Light variant — transparent bg + navy "stock" text + green kept.
  const light = renderVariant(data, info, { r: 13, g: 21, b: 38 });
  await sharp(light, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toFile(OUT_LIGHT);
  console.log('wrote', OUT_LIGHT);
}

main().catch((e) => { console.error(e); process.exit(1); });
