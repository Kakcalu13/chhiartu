// Turns assets/icon-source.png (rounded white icon on a black background) into a
// proper macOS icon: black corners removed (transparent), clean rounded corners,
// then emits build/icon.png (1024) and build/icon.icns.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const SRC = path.join(root, 'assets', 'icon-source.png');
const BUILD = path.join(root, 'build');
const MASTER = path.join(BUILD, 'icon.png');
const ICNS = path.join(BUILD, 'icon.icns');
const ICONSET = path.join(BUILD, 'icon.iconset');

const BLACK = 20; // channel value at/below this counts as "black background"

async function main() {
  fs.mkdirSync(BUILD, { recursive: true });

  const img = sharp(SRC).ensureAlpha();
  const { width: W, height: H } = await img.metadata();
  const { data, info } = await sharp(SRC)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;

  const isContent = (x, y) => {
    const i = (y * W + x) * ch;
    return data[i] > BLACK || data[i + 1] > BLACK || data[i + 2] > BLACK;
  };

  // Bounding box of the non-black artwork.
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (isContent(x, y)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // Corner radius: on the top edge the rounded corners cut in by ~r on each side.
  let topLeft = W;
  for (let x = minX; x <= maxX; x++) {
    if (isContent(x, minY)) { topLeft = x; break; }
  }
  let radius = Math.max(0, topLeft - minX);
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  // Guard against a bad measurement — fall back to Apple's ~squircle radius.
  if (radius < bw * 0.05 || radius > bw * 0.45) radius = Math.round(bw * 0.2237);

  // Inset a hair so the outer anti-aliased black ring is never included.
  const inset = Math.round(bw * 0.006);
  const rx = Math.max(0, minX + inset);
  const ry = Math.max(0, minY + inset);
  const rw = bw - inset * 2;
  const rh = bh - inset * 2;
  const rr = Math.max(0, radius - inset);

  console.log(`source ${W}x${H}  bbox ${bw}x${bh} @(${minX},${minY})  radius≈${radius}px  inset ${inset}px`);

  const maskSvg = Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
       <rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="${rr}" ry="${rr}" fill="#fff"/>
     </svg>`
  );
  // Rasterize to exactly W×H so the composite dimensions match the source.
  const mask = await sharp(maskSvg).resize(W, H).png().toBuffer();

  // Pass 1: apply the rounded mask (dest-in => everything outside the rect becomes
  // transparent). Kept separate because sharp composites AFTER any resize.
  const masked = await sharp(SRC)
    .ensureAlpha()
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // Pass 2: crop to the artwork and produce a square 1024 master.
  const rounded = await sharp(masked)
    .extract({ left: minX, top: minY, width: bw, height: bh })
    .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp(rounded).toFile(MASTER);
  console.log('wrote', path.relative(root, MASTER));

  // Build the .iconset and convert to .icns via macOS iconutil.
  fs.rmSync(ICONSET, { recursive: true, force: true });
  fs.mkdirSync(ICONSET, { recursive: true });
  const specs = [
    [16, 'icon_16x16.png'], [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'], [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'], [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'], [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'], [1024, 'icon_512x512@2x.png'],
  ];
  for (const [size, name] of specs) {
    await sharp(rounded).resize(size, size).png().toFile(path.join(ICONSET, name));
  }
  execFileSync('iconutil', ['-c', 'icns', ICONSET, '-o', ICNS]);
  fs.rmSync(ICONSET, { recursive: true, force: true });
  console.log('wrote', path.relative(root, ICNS));
}

main().catch((e) => { console.error(e); process.exit(1); });
