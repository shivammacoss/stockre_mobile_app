// Builds a proper square app-icon.png from the wide stocktre-logo.png.
// The source is 2024x501 with the S mark in the left ~22%, so we crop
// that region, trim whitespace, and fit it centered into a 1024x1024
// canvas on white for maximum contrast on any home screen wallpaper.

const sharp = require('sharp');
const path = require('path');

const SRC = path.join(__dirname, '..', 'assets', 'stocktre-logo.png');
const OUT_ICON = path.join(__dirname, '..', 'assets', 'app-icon.png');
const OUT_ADAPTIVE = path.join(__dirname, '..', 'assets', 'adaptive-icon.png');

async function main() {
  const src = sharp(SRC);
  const meta = await src.metadata();
  console.log('source:', meta.width, 'x', meta.height);

  // Crop left portion containing only the S mark.
  const cropW = Math.round(meta.width * 0.22);
  const cropped = await sharp(SRC)
    .extract({ left: 0, top: 0, width: cropW, height: meta.height })
    .toBuffer();
  const sMark = await sharp(cropped).trim({ threshold: 10 }).toBuffer();

  const trimmed = await sharp(sMark).metadata();
  console.log('trimmed S mark:', trimmed.width, 'x', trimmed.height);

  // --- Full icon (iOS + Android legacy): S on white, 70% of canvas.
  const iconSize = 1024;
  const targetInner = Math.round(iconSize * 0.7);
  const resizedS = await sharp(sMark)
    .resize({ width: targetInner, height: targetInner, fit: 'inside' })
    .toBuffer();

  await sharp({
    create: {
      width: iconSize,
      height: iconSize,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([{ input: resizedS, gravity: 'center' }])
    .png()
    .toFile(OUT_ICON);
  console.log('wrote', OUT_ICON);

  // --- Android adaptive foreground: the OS masks it with a circle/squircle
  // and the safe zone is the inner 66%. So the S must be at ~55% of canvas
  // so it never gets clipped. Transparent background, OS fills with the
  // adaptiveIcon.backgroundColor from app.config.js.
  const adaptiveInner = Math.round(iconSize * 0.55);
  const resizedSAdaptive = await sharp(sMark)
    .resize({ width: adaptiveInner, height: adaptiveInner, fit: 'inside' })
    .toBuffer();

  await sharp({
    create: {
      width: iconSize,
      height: iconSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: resizedSAdaptive, gravity: 'center' }])
    .png()
    .toFile(OUT_ADAPTIVE);
  console.log('wrote', OUT_ADAPTIVE);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
