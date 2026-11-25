const { COLOR, parseArgs, error, usage } = OS.require('/lib/cli.js');

const io = (typeof tty !== 'undefined' && tty) || OS.tty;
const IGNORED_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph']);

function formatErr(err) {
    if (!err) return 'Unknown error';
    if (typeof err === 'string') return err;
    return err.message || String(err);
}

// --- 1. VALIDATION ---

const { positional } = parseArgs(args);

if (positional.length === 0) {
    return usage('view <image>');
}

const path = OS.resolvePath(positional[0]);

if (!OS.fs || typeof OS.fs.exists !== 'function' || !OS.fs.exists(path)) {
    return error('view', `${path}: No such file or directory`);
}

if (typeof OS.fs.isDir === 'function' && OS.fs.isDir(path)) {
    return error('view', `${path}: Is a directory`);
}

let bytes;
try {
    bytes = typeof OS.fs.readBytes === 'function' ? OS.fs.readBytes(path) : null;
} catch (err) {
    return error('view', `${path}: ${formatErr(err)}`);
}

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

function fallbackRgb(r, g, b) {
    if (OS.gfx && typeof OS.gfx.rgb === 'function') {
        return OS.gfx.rgb(r, g, b);
    }
    const cr = Math.max(0, Math.min(5, Math.round((r / 255) * 5)));
    const cg = Math.max(0, Math.min(5, Math.round((g / 255) * 5)));
    const cb = Math.max(0, Math.min(5, Math.round((b / 255) * 5)));
    return 16 + 36 * cr + 6 * cg + cb;
}

async function decodeImage(rawBytes, maxW, maxH) {
    const bmp = await createImageBitmap(new Blob([rawBytes]));
    try {
        const scale = Math.min(1, maxW / bmp.width, maxH / bmp.height);
        const width = Math.max(1, Math.round(bmp.width * scale));
        const height = Math.max(1, Math.round(bmp.height * scale));

        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bmp, 0, 0, width, height);

        const rgba = new Float32Array(ctx.getImageData(0, 0, width, height).data);
        return { rgba, width, height };
    } finally {
        if (typeof bmp.close === 'function') {
            bmp.close();
        }
    }
}

// --- 3. BUFFERED FLOYD-STEINBERG RENDERER ---

function createViewBuffer(w, h, scale) {
    if (OS.gfx && typeof OS.gfx.createBuffer === 'function') {
        return OS.gfx.createBuffer(w * scale, h * scale, scale);
    }
    return new Uint8Array(w * h * scale * scale);
}

function getBufferPixels(buf) {
    if (buf instanceof Uint8Array) return buf;
    if (buf && buf.data instanceof Uint8Array) return buf.data;
    if (buf && buf.vram instanceof Uint8Array) return buf.vram;
    return null;
}

function ditherToBuffer(rgba, imgW, imgH, buf, bufW, bufH, offX, offY, pal) {
    const pixels = getBufferPixels(buf);
    const spread = (nx, ny, er, eg, eb, factor) => {
        if (nx < 0 || nx >= imgW || ny < 0 || ny >= imgH) return;
        const nIdx = (ny * imgW + nx) * 4;
        rgba[nIdx] += er * factor;
        rgba[nIdx + 1] += eg * factor;
        rgba[nIdx + 2] += eb * factor;
    };

    for (let y = 0; y < imgH; y++) {
        const dy = offY + y;
        if (dy < 0 || dy >= bufH) continue;
        for (let x = 0; x < imgW; x++) {
            const dx = offX + x;
            if (dx < 0 || dx >= bufW) continue;

            const idx = (y * imgW + x) * 4;
            const r = Math.max(0, Math.min(255, rgba[idx]));
            const g = Math.max(0, Math.min(255, rgba[idx + 1]));
            const b = Math.max(0, Math.min(255, rgba[idx + 2]));

            const c = fallbackRgb(r, g, b);
            if (pixels) {
                pixels[dy * bufW + dx] = c;
            } else if (OS.gfx && typeof OS.gfx.pixel === 'function') {
                OS.gfx.pixel(dx, dy, c);
            }

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

function blitViewBuffer(buf, viewW, viewH, physW, physH, scale) {
    const vram = OS.vram;
    if (OS.gfx && typeof OS.gfx.blit === 'function' && vram) {
        OS.gfx.blit(buf, 0, 0, vram, physW, physH);
        return;
    }

    const pixels = getBufferPixels(buf);
    if (!pixels || !vram) return;

    const copyW = Math.min(viewW, physW);
    const copyH = Math.min(viewH, physH);
    for (let y = 0; y < copyH; y++) {
        const srcRow = y * viewW;
        const dstRow = y * physW;
        for (let x = 0; x < copyW; x++) {
            vram[dstRow + x] = pixels[srcRow + x];
        }
    }
}

// --- 4. MAIN ---

const viewW = (OS.gfx && OS.gfx.width) || OS.width || 320;
const viewH = (OS.gfx && OS.gfx.height) || OS.height || 240;
const physW = OS.width || viewW;
const physH = OS.height || viewH;
const scale = (OS.gfx && OS.gfx.scale) || 1;
const STATUS_H = 12;

let img;
try {
    img = await decodeImage(bytes, viewW, Math.max(1, viewH - STATUS_H));
} catch (err) {
    if (typeof OS.log === 'function') {
        OS.log(`view decode error: ${formatErr(err)}`);
    }
    return error('view', `${path}: Failed to decode image`);
}

const offX = ((viewW - img.width) / 2) | 0;
const offY = ((viewH - STATUS_H - img.height) / 2) | 0;
const viewBuf = createViewBuffer(viewW, viewH, scale);

try {
    const drawScene = () => {
        if (OS.gfx && typeof OS.gfx.clear === 'function') {
            OS.gfx.clear(0);
        }
        ditherToBuffer(
            img.rgba,
            img.width,
            img.height,
            viewBuf,
            viewW,
            viewH,
            offX,
            offY,
            buildPaletteLUT(),
        );
        if (OS.gfx && typeof OS.gfx.drawText === 'function') {
            OS.gfx.drawText(
                `${path} (${img.width}x${img.height}) - ESC / Q TO EXIT`,
                4,
                viewH - 10,
                COLOR.text,
                0,
            );
        }
    };

    if (OS.gfx && typeof OS.gfx.withTarget === 'function' && !(viewBuf instanceof Uint8Array)) {
        OS.gfx.withTarget(viewBuf, drawScene);
    } else {
        drawScene();
    }
} catch (err) {
    if (typeof OS.log === 'function') {
        OS.log(`view render error: ${formatErr(err)}`);
    }
    if (io && typeof io.invalidate === 'function') {
        io.invalidate();
    }
    return error('view', `${path}: Failed to render image`);
}

function isExitKey(raw) {
    const k = raw && typeof raw === 'object' ? raw.key : raw;
    return k === 'Escape' || k === 'q' || k === 'Q';
}

let shouldExit = false;
let armed = false;
const hasInputService = Boolean(OS.input && typeof OS.input.pushHandler === 'function');
const releaseInput = hasInputService
    ? OS.input.pushHandler((key) => {
          if (!armed || IGNORED_KEYS.has(key)) return;
          if (isExitKey(key)) {
              if (typeof OS.log === 'function') {
                  OS.log(`view exit key: ${JSON.stringify(key)}`);
              }
              shouldExit = true;
          }
      })
    : null;

try {
    await OS.nextFrame();
    await OS.nextFrame();
    if (!hasInputService && typeof OS.pollKey === 'function') {
        while (OS.pollKey() !== null) {}
    }
    armed = true;

    while (!shouldExit) {
        if (!hasInputService && typeof OS.pollKey === 'function') {
            const raw = OS.pollKey();
            if (isExitKey(raw)) {
                shouldExit = true;
                break;
            }
        }
        blitViewBuffer(viewBuf, viewW, viewH, physW, physH, scale);
        await OS.nextFrame();
    }
} finally {
    armed = false;
    if (typeof releaseInput === 'function') {
        releaseInput();
    }
    if (OS.gfx && typeof OS.gfx.clear === 'function') {
        OS.gfx.clear(0);
    }
    if (OS.input && typeof OS.input.focus === 'function' && io) {
        OS.input.focus(io);
    }
    if (io && typeof io.invalidate === 'function') {
        io.invalidate();
    }
    await OS.nextFrame();
}

return 0;
