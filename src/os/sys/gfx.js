// 8x8 Bitmap Font (ASCII 32..126) — each char is 8 rows of 8-bit hex
const RAW_FONT = {
    ' ': '0000000000000000',
    '!': '183C3C1818001800',
    '"': '3636000000000000',
    '#': '36367F367F363600',
    $: '0C3E031E301F0C00',
    '%': '006333180C666300',
    '&': '1C361C6E3B336E00',
    "'": '0606030000000000',
    '(': '180C0606060C1800',
    ')': '060C1818180C0600',
    '*': '00663CFF3C660000',
    '+': '000C0C3F0C0C0000',
    ',': '00000000000C0C06',
    '-': '0000003F00000000',
    '.': '00000000000C0C00',
    '/': '6030180C06030100',
    0: '3E63737B6F673E00',
    1: '0C0E0C0C0C0C3F00',
    2: '1E33301C06333F00',
    3: '1E33301C30331E00',
    4: '383C36337F307800',
    5: '3F031F3030331E00',
    6: '1C06031F33331E00',
    7: '3F3330180C0C0C00',
    8: '1E33331E33331E00',
    9: '1E33333E30180E00',
    ':': '000C0C00000C0C00',
    ';': '000C0C00000C0C06',
    '<': '180C0603060C1800',
    '=': '00003F00003F0000',
    '>': '060C1830180C0600',
    '?': '1E3330180C000C00',
    '@': '3E637B7B7B031E00',
    A: '0C1E33333F333300',
    B: '3F66663E66663F00',
    C: '3C66030303663C00',
    D: '1F36666666361F00',
    E: '7F46161E16467F00',
    F: '7F46161E16060F00',
    G: '3C66030373667C00',
    H: '3333333F33333300',
    I: '1E0C0C0C0C0C1E00',
    J: '7830303033331E00',
    K: '6766361E36666700',
    L: '0F06060646667F00',
    M: '63777F7F6B636300',
    N: '63676F7B73636300',
    O: '1C36636363361C00',
    P: '3F66663E06060F00',
    Q: '1E3333333B1E3800',
    R: '3F66663E36666700',
    S: '1E33070E38331E00',
    T: '3F2D0C0C0C0C1E00',
    U: '3333333333333F00',
    V: '33333333331E0C00',
    W: '6363636B7F776300',
    X: '6363361C1C366300',
    Y: '3333331E0C0C1E00',
    Z: '7F6331184C667F00',
    '[': '1E06060606061E00',
    '\\': '03060C1830604000',
    ']': '1E18181818181E00',
    '^': '081C366300000000',
    _: '00000000000000FF',
    '`': '0C0C180000000000',
    a: '00001E303E336E00',
    b: '0706063E66663B00',
    c: '00001E3303331E00',
    d: '3830303E33336E00',
    e: '00001E333F031E00',
    f: '1C36060F06060F00',
    g: '00006E33333E301F',
    h: '0706366E66666700',
    i: '0C000E0C0C0C1E00',
    j: '300030303033331E',
    k: '070666361E366700',
    l: '0E0C0C0C0C0C1E00',
    m: '0000337F7F6B6300',
    n: '00001F3333333300',
    o: '00001E3333331E00',
    p: '00003B66663E060F',
    q: '00006E33333E3078',
    r: '00003B6E66060F00',
    s: '00003E031E301F00',
    t: '080C3E0C0C2C1800',
    u: '0000333333336E00',
    v: '00003333331E0C00',
    w: '0000636B7F7F3600',
    x: '000063361C366300',
    y: '00003333333E301F',
    z: '00003F190C263F00',
    '{': '380C0C070C0C3800',
    '|': '1818180018181800',
    '}': '070C0C380C0C0700',
    '~': '6E3B000000000000',
};

// Pre-decode hex glyphs into Uint8Array(8) once at boot
const FONT = {};
for (const [ch, hex] of Object.entries(RAW_FONT)) {
    const rows = new Uint8Array(8);
    for (let r = 0; r < 8; r++) {
        rows[r] = parseInt(hex.slice(r * 2, r * 2 + 2), 16);
    }
    FONT[ch] = rows;
}

const CONF_PATH = '/etc/gfx.json';
const LEGACY_CONF_PATH = '/etc/gfx.conf';
const PHYS_W = OS.width;
const PHYS_H = OS.height;
const vram = OS.vram;

let scale = 1;
let W = PHYS_W;
let H = PHYS_H;

// Active draw target: null = scaled VRAM (default), or { width, height, scale, data }
let activeTarget = null;

function getTargetDims() {
    if (activeTarget) {
        const tScale = Math.max(1, Math.floor(activeTarget.scale || 1));
        const tw = Math.max(1, Math.floor(activeTarget.width / tScale));
        const th = Math.max(1, Math.floor(activeTarget.height / tScale));
        return {
            buf: activeTarget.data,
            physW: activeTarget.width,
            physH: activeTarget.height,
            w: tw,
            h: th,
            scale: tScale,
        };
    }
    return {
        buf: vram,
        physW: PHYS_W,
        physH: PHYS_H,
        w: W,
        h: H,
        scale,
    };
}

function applyScale(nextScale) {
    scale = Math.max(1, Math.min(4, Math.floor(nextScale) || 1));
    W = Math.floor(PHYS_W / scale);
    H = Math.floor(PHYS_H / scale);
    OS.width = W;
    OS.height = H;
}

function parseJsonConfig(text) {
    if (!text) return {};
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
}

function parseLegacyConf(text) {
    const cfg = {};
    if (!text) return cfg;

    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        const val = line.slice(eq + 1).trim();
        cfg[key] = val;
    }

    return cfg;
}

function loadConfig(path = CONF_PATH) {
    try {
        if (!OS.fs) {
            applyScale(1);
            return;
        }
        if (OS.fs.exists(path)) {
            const cfg = parseJsonConfig(OS.fs.read(path));
            applyScale(cfg.scale !== undefined ? Number(cfg.scale) : 1);
            return;
        }
        if (path === CONF_PATH && OS.fs.exists(LEGACY_CONF_PATH)) {
            const cfg = parseLegacyConf(OS.fs.read(LEGACY_CONF_PATH));
            applyScale(cfg.scale ? Number(cfg.scale) : 1);
            return;
        }
        applyScale(1);
    } catch {
        applyScale(1);
    }
}

function saveConfig(path = CONF_PATH) {
    if (!OS.fs) return false;
    const dir = path.slice(0, path.lastIndexOf('/'));
    if (dir && !OS.fs.exists(dir) && OS.fs.mkdir) {
        OS.fs.mkdir(dir);
    }
    const payload = JSON.stringify({ scale }, null, 2) + '\n';
    OS.fs.write(path, payload);
    return true;
}

function putPixelOn(t, lx, ly, color) {
    if (lx < 0 || ly < 0 || lx >= t.w || ly >= t.h) return;

    const px0 = lx * t.scale;
    const py0 = ly * t.scale;

    for (let dy = 0; dy < t.scale; dy++) {
        const rowStart = (py0 + dy) * t.physW + px0;
        t.buf.fill(color, rowStart, rowStart + t.scale);
    }
}

function hlineOn(t, x0, x1, y, color) {
    if (y < 0 || y >= t.h) return;
    const start = Math.max(0, x0 | 0);
    const end = Math.min(t.w - 1, x1 | 0);
    for (let x = start; x <= end; x++) {
        putPixelOn(t, x, y, color);
    }
}

function lineOn(t, x0, y0, x1, y1, color) {
    x0 = x0 | 0;
    y0 = y0 | 0;
    x1 = x1 | 0;
    y1 = y1 | 0;

    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    while (true) {
        putPixelOn(t, x0, y0, color);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) {
            err -= dy;
            x0 += sx;
        }
        if (e2 < dx) {
            err += dx;
            y0 += sy;
        }
    }
}

function rectOn(t, x, y, rw, rh, color, fill = true) {
    x = x | 0;
    y = y | 0;
    rw = rw | 0;
    rh = rh | 0;
    if (rw <= 0 || rh <= 0) return;

    if (fill) {
        const x0 = Math.max(0, x);
        const y0 = Math.max(0, y);
        const x1 = Math.min(t.w, x + rw);
        const y1 = Math.min(t.h, y + rh);
        for (let row = y0; row < y1; row++) {
            for (let col = x0; col < x1; col++) {
                putPixelOn(t, col, row, color);
            }
        }
    } else {
        hlineOn(t, x, x + rw - 1, y, color);
        hlineOn(t, x, x + rw - 1, y + rh - 1, color);
        lineOn(t, x, y, x, y + rh - 1, color);
        lineOn(t, x + rw - 1, y, x + rw - 1, y + rh - 1, color);
    }
}

function circleOn(t, cx, cy, r, color, fill = false) {
    cx = cx | 0;
    cy = cy | 0;
    r = r | 0;
    let x = r;
    let y = 0;
    let err = 1 - x;

    while (x >= y) {
        if (fill) {
            hlineOn(t, cx - x, cx + x, cy + y, color);
            hlineOn(t, cx - x, cx + x, cy - y, color);
            hlineOn(t, cx - y, cx + y, cy + x, color);
            hlineOn(t, cx - y, cx + y, cy - x, color);
        } else {
            putPixelOn(t, cx + x, cy + y, color);
            putPixelOn(t, cx + y, cy + x, color);
            putPixelOn(t, cx - y, cy + x, color);
            putPixelOn(t, cx - x, cy + y, color);
            putPixelOn(t, cx - x, cy - y, color);
            putPixelOn(t, cx - y, cy - x, color);
            putPixelOn(t, cx + y, cy - x, color);
            putPixelOn(t, cx + x, cy - y, color);
        }
        y++;
        if (err < 0) {
            err += 2 * y + 1;
        } else {
            x--;
            err += 2 * (y - x + 1);
        }
    }
}

function drawCharOn(t, ch, x, y, fg = 15, bg = -1) {
    const glyph = FONT[ch] || FONT['?'];
    for (let row = 0; row < 8; row++) {
        const py = y + row;
        if (py < 0 || py >= t.h) continue;
        const bits = glyph[row];

        for (let col = 0; col < 8; col++) {
            const px = x + col;
            if (px < 0 || px >= t.w) continue;
            if ((bits >> col) & 1) {
                putPixelOn(t, px, py, fg);
            } else if (bg >= 0) {
                putPixelOn(t, px, py, bg);
            }
        }
    }
}

function drawTextOn(t, text, x, y, fg = 15, bg = -1) {
    let cx = x;
    for (let i = 0; i < text.length; i++) {
        drawCharOn(t, text[i], cx, y, fg, bg);
        cx += 8;
    }
}

const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];
const toCube = (v) => (v < 48 ? 0 : v < 115 ? 1 : Math.min(5, ((v - 35) / 40) | 0));

OS.gfx = {
    confPath: CONF_PATH,

    get width() {
        return activeTarget
            ? Math.max(1, Math.floor(activeTarget.width / Math.max(1, activeTarget.scale || 1)))
            : W;
    },
    get height() {
        return activeTarget
            ? Math.max(1, Math.floor(activeTarget.height / Math.max(1, activeTarget.scale || 1)))
            : H;
    },
    get scale() {
        return activeTarget ? Math.max(1, activeTarget.scale || 1) : scale;
    },
    setScale(nextScale, persist = false) {
        applyScale(nextScale);
        if (persist) saveConfig();
    },
    reloadConfig(path = CONF_PATH) {
        loadConfig(path);
        return scale;
    },
    saveConfig(path = CONF_PATH) {
        return saveConfig(path);
    },

    createBuffer(width, height, bufScale = 1) {
        const bw = Math.max(1, Math.floor(width));
        const bh = Math.max(1, Math.floor(height));
        const s = Math.max(1, Math.floor(bufScale || 1));
        return {
            width: bw,
            height: bh,
            scale: s,
            data: new Uint8Array(bw * bh),
        };
    },

    clearBuffer(buf, color = 0) {
        if (buf && buf.data) {
            buf.data.fill(color);
        }
    },

    withTarget(buf, fn) {
        const prev = activeTarget;
        activeTarget = buf || null;
        try {
            return fn();
        } finally {
            activeTarget = prev;
        }
    },

    blit(
        srcBuf,
        dstX = 0,
        dstY = 0,
        dstBuf = vram,
        dstW = PHYS_W,
        dstH = PHYS_H,
        transparentColor = -1,
    ) {
        if (!srcBuf || !srcBuf.data || !dstBuf) return;
        const sw = srcBuf.width;
        const sh = srcBuf.height;
        const src = srcBuf.data;
        const dx0 = dstX | 0;
        const dy0 = dstY | 0;

        for (let sy = 0; sy < sh; sy++) {
            const dy = dy0 + sy;
            if (dy < 0 || dy >= dstH) continue;
            const srcRow = sy * sw;
            const dstRow = dy * dstW;

            for (let sx = 0; sx < sw; sx++) {
                const dx = dx0 + sx;
                if (dx < 0 || dx >= dstW) continue;
                const c = src[srcRow + sx];
                if (transparentColor >= 0 && c === transparentColor) continue;
                dstBuf[dstRow + dx] = c;
            }
        }
    },

    clear(color = 0) {
        const t = getTargetDims();
        t.buf.fill(color);
    },

    pixel(x, y, color) {
        putPixelOn(getTargetDims(), x | 0, y | 0, color);
    },

    rect(x, y, w, h, color, fill = true) {
        rectOn(getTargetDims(), x, y, w, h, color, fill);
    },

    // Bresenham's integer line algorithm
    line(x0, y0, x1, y1, color) {
        lineOn(getTargetDims(), x0, y0, x1, y1, color);
    },

    // Midpoint circle algorithm (wireframe or filled)
    circle(cx, cy, r, color, fill = false) {
        circleOn(getTargetDims(), cx, cy, r, color, fill);
    },

    drawChar(ch, x, y, fg = 15, bg = -1) {
        drawCharOn(getTargetDims(), ch, x, y, fg, bg);
    },

    drawText(text, x, y, fg = 15, bg = -1) {
        drawTextOn(getTargetDims(), String(text), x, y, fg, bg);
    },

    // Maps any (0..255) RGB triplet to the nearest xterm-256 index
    rgb(r, g, b) {
        const cr = toCube(r);
        const cg = toCube(g);
        const cb = toCube(b);
        const cubeIdx = 16 + 36 * cr + 6 * cg + cb;

        const dr = r - CUBE_LEVELS[cr];
        const dg = g - CUBE_LEVELS[cg];
        const db = b - CUBE_LEVELS[cb];
        const cubeDist = dr * dr + dg * dg + db * db;

        const avg = (r + g + b) / 3;
        const gi = Math.max(0, Math.min(23, Math.round((avg - 8) / 10)));
        const gv = 8 + gi * 10;
        const grayDist = (r - gv) ** 2 + (g - gv) ** 2 + (b - gv) ** 2;

        return grayDist < cubeDist ? 232 + gi : cubeIdx;
    },
};

loadConfig();
