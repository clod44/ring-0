// Image Viewer DE Window App (reusing palette LUT + Floyd-Steinberg dithering)

const TOOLBAR_H = 14;

function formatErr(err) {
    if (!err) return 'Unknown error';
    if (typeof err === 'string') return err;
    return err.message || String(err);
}

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

const PALETTE = buildPaletteLUT();

function quantizeRgb(r, g, b) {
    if (OS.gfx && typeof OS.gfx.rgb === 'function') {
        return OS.gfx.rgb(r, g, b);
    }
    const cr = Math.max(0, Math.min(5, Math.round((r / 255) * 5)));
    const cg = Math.max(0, Math.min(5, Math.round((g / 255) * 5)));
    const cb = Math.max(0, Math.min(5, Math.round((b / 255) * 5)));
    return 16 + 36 * cr + 6 * cg + cb;
}

async function decodeBytesToRgba(rawBytes, maxW, maxH, fitMode) {
    const bmp = await createImageBitmap(new Blob([rawBytes]));
    try {
        const safeW = Math.max(1, maxW);
        const safeH = Math.max(1, maxH);
        const scale = fitMode === '1:1' ? 1 : Math.min(safeW / bmp.width, safeH / bmp.height);
        const width = Math.max(1, Math.round(bmp.width * scale));
        const height = Math.max(1, Math.round(bmp.height * scale));

        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = scale !== 1;
        if ('imageSmoothingQuality' in ctx) {
            ctx.imageSmoothingQuality = scale > 1 ? 'high' : 'medium';
        }
        ctx.drawImage(bmp, 0, 0, width, height);

        const rgba = new Float32Array(ctx.getImageData(0, 0, width, height).data);
        return { rgba, width, height, origW: bmp.width, origH: bmp.height };
    } finally {
        if (typeof bmp.close === 'function') {
            bmp.close();
        }
    }
}

function drawFloydSteinberg(gfx, srcRgba, imgW, imgH, dstX, dstY, viewW, viewH) {
    const work = new Float32Array(srcRgba);
    const spread = (nx, ny, er, eg, eb, factor) => {
        if (nx < 0 || nx >= imgW || ny < 0 || ny >= imgH) return;
        const nIdx = (ny * imgW + nx) * 4;
        work[nIdx] += er * factor;
        work[nIdx + 1] += eg * factor;
        work[nIdx + 2] += eb * factor;
    };

    for (let y = 0; y < imgH; y++) {
        const py = dstY + y;
        for (let x = 0; x < imgW; x++) {
            const px = dstX + x;
            const idx = (y * imgW + x) * 4;
            const r = Math.max(0, Math.min(255, work[idx]));
            const g = Math.max(0, Math.min(255, work[idx + 1]));
            const b = Math.max(0, Math.min(255, work[idx + 2]));

            const c = quantizeRgb(r, g, b);
            if (px >= 0 && px < viewW && py >= 0 && py < viewH) {
                gfx.pixel(px, py, c);
            }

            const er = r - PALETTE.r[c];
            const eg = g - PALETTE.g[c];
            const eb = b - PALETTE.b[c];

            spread(x + 1, y, er, eg, eb, 7 / 16);
            spread(x - 1, y + 1, er, eg, eb, 3 / 16);
            spread(x, y + 1, er, eg, eb, 5 / 16);
            spread(x + 1, y + 1, er, eg, eb, 1 / 16);
        }
    }
}

function createApp(win) {
    const rawPath = win && Array.isArray(win.args) && win.args[0] ? String(win.args[0]) : '';
    const filePath = rawPath
        ? typeof OS.resolvePath === 'function'
            ? OS.resolvePath(rawPath)
            : rawPath
        : '';

    let rawBytes = null;
    let img = null;
    let errMsg = '';
    let fitMode = 'FIT'; // 'FIT' | '1:1'
    let decodeToken = 0;
    let buttons = [];

    async function rebuildImage(w) {
        if (!rawBytes || errMsg) return;
        const token = ++decodeToken;
        const viewW = Math.max(1, w.w | 0 || 1);
        const viewH = Math.max(1, (w.h | 0) - TOOLBAR_H || 1);
        try {
            const decoded = await decodeBytesToRgba(rawBytes, viewW, viewH, fitMode);
            if (token !== decodeToken) return;
            img = decoded;
            w.invalidate();
        } catch (err) {
            if (token !== decodeToken) return;
            errMsg = formatErr(err);
            w.invalidate();
        }
    }

    async function loadFile(w) {
        if (!filePath) {
            errMsg = 'No image path provided';
            w.invalidate();
            return;
        }
        if (!OS.fs || typeof OS.fs.exists !== 'function' || !OS.fs.exists(filePath)) {
            errMsg = 'File not found';
            w.invalidate();
            return;
        }
        if (typeof OS.fs.isDir === 'function' && OS.fs.isDir(filePath)) {
            errMsg = 'Path is a directory';
            w.invalidate();
            return;
        }
        try {
            rawBytes = typeof OS.fs.readBytes === 'function' ? OS.fs.readBytes(filePath) : null;
            if (!rawBytes) {
                errMsg = 'Failed to read bytes';
                w.invalidate();
                return;
            }
            await rebuildImage(w);
        } catch (err) {
            errMsg = formatErr(err);
            w.invalidate();
        }
    }

    function getButtons(w) {
        const label = fitMode === 'FIT' ? '1:1' : 'FIT';
        const bw = label.length * 8 + 6;
        const list = [];
        if (3 + bw <= w.w - 2) {
            list.push({ id: 'zoom', label, x: 3, y: 2, w: bw, h: 10, bg: 1 });
        }
        return list;
    }

    return {
        init(w) {
            loadFile(w);
        },

        onResize(w) {
            rebuildImage(w);
            w.invalidate();
        },

        onMouse(ev, w) {
            if (ev.action !== 'down') return false;
            for (const b of buttons) {
                if (ev.x >= b.x && ev.x < b.x + b.w && ev.y >= b.y && ev.y < b.y + b.h) {
                    if (b.id === 'zoom') {
                        fitMode = fitMode === 'FIT' ? '1:1' : 'FIT';
                        rebuildImage(w);
                        w.invalidate();
                    }
                    return true;
                }
            }
            return false;
        },

        render(w, frameApi) {
            const gfx = (frameApi && frameApi.gfx) || OS.gfx;
            if (!gfx) return;

            const viewW = Math.max(1, w.w | 0);
            const viewH = Math.max(1, w.h | 0);

            gfx.clear(0);
            gfx.rect(0, 0, viewW, viewH, 0, true);

            // Toolbar
            gfx.rect(0, 0, viewW, TOOLBAR_H, 1, true);
            gfx.line(0, TOOLBAR_H - 1, viewW - 1, TOOLBAR_H - 1, 8);

            buttons = getButtons(w);
            for (const b of buttons) {
                gfx.rect(b.x, b.y, b.w, b.h, b.bg, true);
                gfx.rect(b.x, b.y, b.w, b.h, 15, false);
                gfx.drawText(b.label, b.x + 3, b.y + 1, 15, -1);
            }

            const titleStartX = buttons.length > 0 ? buttons[0].x + buttons[0].w + 5 : 4;
            if (viewW - titleStartX >= 8) {
                const name = filePath ? filePath.split('/').pop() : 'VIEWER';
                const info = img ? `${name} ${img.width}x${img.height}` : name;
                const maxChars = Math.floor((viewW - titleStartX - 2) / 8);
                gfx.drawText(info.slice(0, maxChars), titleStartX, 3, 15, -1);
            }

            const areaTop = TOOLBAR_H;
            const areaH = Math.max(0, viewH - areaTop);

            if (errMsg) {
                gfx.drawText(
                    errMsg.slice(0, Math.max(1, Math.floor((viewW - 8) / 8))),
                    4,
                    areaTop + 6,
                    9,
                    -1,
                );
                return;
            }

            if (!img) {
                gfx.drawText('Loading...', 4, areaTop + 6, 7, -1);
                return;
            }

            const offX = Math.floor((viewW - img.width) / 2);
            const offY = areaTop + Math.floor((areaH - img.height) / 2);
            drawFloydSteinberg(gfx, img.rgba, img.width, img.height, offX, offY, viewW, viewH);
        },

        destroy() {
            decodeToken++;
            rawBytes = null;
            img = null;
            buttons = [];
        },
    };
}

module.exports = { createApp };
