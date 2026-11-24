const { COLOR, parseArgs, error, usage } = OS.require('/lib/cli.js');

// --- 1. VALIDATION ---

const { positional } = parseArgs(args);

if (positional.length === 0) {
  return usage('view <image>');
}

const path = OS.resolvePath(positional[0]);

if (!OS.fs.exists(path)) {
  return error('view', `${path}: No such file or directory`);
}

if (OS.fs.isDir(path)) {
  return error('view', `${path}: Is a directory`);
}

const bytes = OS.fs.readBytes(path);
if (!bytes) {
  return error('view', `${path}: Failed to read file`);
}

// --- 2. PALETTE LUT & IMAGE DECODER ---

function buildPaletteLUT() {
  const levels = [0, 95, 135, 175, 215, 255];
  const r = new Uint8Array(256);
  const g = new Uint8Array(256);
  const b = new Uint8Array(256);

  let idx = 16;
  for (let ri = 0; ri < 6; ri++) {
    for (let gi = 0; gi < 6; gi++) {
      for (let bi = 0; bi < 6; bi++) {
        r[idx] = levels[ri];
        g[idx] = levels[gi];
        b[idx] = levels[bi];
        idx++;
      }
    }
  }

  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10;
    r[232 + i] = v;
    g[232 + i] = v;
    b[232 + i] = v;
  }

  return { r, g, b };
}

async function decodeImage(rawBytes, maxW, maxH) {
  const bmp = await createImageBitmap(new Blob([rawBytes]));
  const scale = Math.min(1, maxW / bmp.width, maxH / bmp.height);
  const width = Math.max(1, Math.round(bmp.width * scale));
  const height = Math.max(1, Math.round(bmp.height * scale));

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, width, height);
  bmp.close();

  const rgba = new Float32Array(ctx.getImageData(0, 0, width, height).data);
  return { rgba, width, height };
}

// --- 3. FLOYD-STEINBERG DITHERER ---

function ditherToVram(rgba, imgW, imgH, offX, offY, pal) {
  const W = OS.width;
  const vram = OS.vram;

  const spread = (nx, ny, er, eg, eb, factor) => {
    if (nx < 0 || nx >= imgW || ny >= imgH) return;
    const nIdx = (ny * imgW + nx) * 4;
    rgba[nIdx] += er * factor;
    rgba[nIdx + 1] += eg * factor;
    rgba[nIdx + 2] += eb * factor;
  };

  for (let y = 0; y < imgH; y++) {
    for (let x = 0; x < imgW; x++) {
      const idx = (y * imgW + x) * 4;
      const r = Math.max(0, Math.min(255, rgba[idx]));
      const g = Math.max(0, Math.min(255, rgba[idx + 1]));
      const b = Math.max(0, Math.min(255, rgba[idx + 2]));

      const c = OS.gfx.rgb(r, g, b);
      vram[(offY + y) * W + (offX + x)] = c;

      const er = r - pal.r[c];
      const eg = g - pal.g[c];
      const eb = b - pal.b[c];

      spread(x + 1, y, er, eg, eb, 7 / 16);
      spread(x - 1, y + 1, er, eg, eb, 3 / 16);
      spread(x, y + 1, er, eg, eb, 5 / 16);
      spread(x + 1, y + 1, er, eg, eb, 1 / 16);
    }
  }
}

// --- 4. MAIN ---

const STATUS_H = 12;
let img;

try {
  img = await decodeImage(bytes, OS.width, OS.height - STATUS_H);
} catch {
  return error('view', `${path}: Failed to decode image`);
}

const offX = ((OS.width - img.width) / 2) | 0;
const offY = ((OS.height - STATUS_H - img.height) / 2) | 0;

OS.gfx.clear(0);
ditherToVram(img.rgba, img.width, img.height, offX, offY, buildPaletteLUT());
OS.gfx.drawText(`${path} (${img.width}x${img.height}) - ANY KEY TO EXIT`, 4, OS.height - 10, COLOR.text, 0);

while (OS.pollKey() === null) {
  await OS.nextFrame();
}

OS.tty.clear(0);
return 0;