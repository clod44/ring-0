const gfx = OS.gfx;
const vram = OS.vram;
const physW = OS.width;
const physH = OS.height;
const savedVram = new Uint8Array(vram);

const DEFAULT_CFG = {
    desktopBg: 6,
    topBarHeight: 11,
    topBarBg: 0,
    topBarBorder: 8,
    topBarFg: 15,
    titleHeight: 12,
    borderWidth: 1,
    debugHud: false,
    icon: {
        boxW: 24,
        boxH: 20,
        cellW: 56,
        cellH: 38,
        topY: 16,
        maxLabelChars: 8,
        boxBg: 1,
        boxBorder: 15,
        glyphFg: 11,
        labelFg: 15,
    },
};

function formatErr(err) {
    if (!err) return 'Unknown error';
    if (typeof err === 'string') return err;
    return err.message || String(err);
}

function formatErrDetail(err) {
    if (!err) return 'Unknown error';
    if (typeof err === 'string') return err;
    const msg = err.message || String(err);
    const firstStack = err.stack
        ? String(err.stack)
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean)[1] || ''
        : '';
    return firstStack ? `${msg} (${firstStack})` : msg;
}

function readJsonSafe(path) {
    if (!OS.fs || typeof OS.fs.read !== 'function') return null;
    try {
        const raw = OS.fs.read(path);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (err) {
        OS.log(`DE: failed to parse ${path}: ${formatErrDetail(err)}`);
        return null;
    }
}

function loadDeConfig() {
    const rawCfg = readJsonSafe('/etc/de.json') || {};
    const rawIcon = rawCfg.icon && typeof rawCfg.icon === 'object' ? rawCfg.icon : {};

    const num = (val, fallback, min = 0) => {
        const n = Number(val);
        return Number.isFinite(n) && n >= min ? n : fallback;
    };

    return {
        desktopBg: num(rawCfg.desktopBg, DEFAULT_CFG.desktopBg),
        topBarHeight: num(rawCfg.topBarHeight, DEFAULT_CFG.topBarHeight, 8),
        topBarBg: num(rawCfg.topBarBg, DEFAULT_CFG.topBarBg),
        topBarBorder: num(rawCfg.topBarBorder, DEFAULT_CFG.topBarBorder),
        topBarFg: num(rawCfg.topBarFg, DEFAULT_CFG.topBarFg),
        titleHeight: num(rawCfg.titleHeight, DEFAULT_CFG.titleHeight, 10),
        borderWidth: num(rawCfg.borderWidth, DEFAULT_CFG.borderWidth, 0),
        debugHud: Boolean(rawCfg.debugHud ?? DEFAULT_CFG.debugHud),
        icon: {
            boxW: num(rawIcon.boxW, DEFAULT_CFG.icon.boxW, 8),
            boxH: num(rawIcon.boxH, DEFAULT_CFG.icon.boxH, 8),
            cellW: num(rawIcon.cellW, DEFAULT_CFG.icon.cellW, 16),
            cellH: num(rawIcon.cellH, DEFAULT_CFG.icon.cellH, 16),
            topY: num(rawIcon.topY, DEFAULT_CFG.icon.topY, 0),
            maxLabelChars: num(rawIcon.maxLabelChars, DEFAULT_CFG.icon.maxLabelChars, 1),
            boxBg: num(rawIcon.boxBg, DEFAULT_CFG.icon.boxBg),
            boxBorder: num(rawIcon.boxBorder, DEFAULT_CFG.icon.boxBorder),
            glyphFg: num(rawIcon.glyphFg, DEFAULT_CFG.icon.glyphFg),
            labelFg: num(rawIcon.labelFg, DEFAULT_CFG.icon.labelFg),
        },
    };
}

const CFG = loadDeConfig();
const TITLE_H = CFG.titleHeight;
const BORDER = Math.max(1, CFG.borderWidth);
let debugHudEnabled = CFG.debugHud;

// Z-order list: index 0 = back, length - 1 = front (focused)
const windows = [];
let nextWinId = 1;

let dragWin = null;
let dragOffX = 0;
let dragOffY = 0;
let resizeWin = null;
let resizeStartX = 0;
let resizeStartY = 0;
let resizeOrigW = 0;
let resizeOrigH = 0;
let activeMouseWin = null;
let minBarItems = [];

function clearPointerCaptureFor(win) {
    if (dragWin === win) dragWin = null;
    if (resizeWin === win) resizeWin = null;
    if (activeMouseWin === win) activeMouseWin = null;
}

function wrapLines(text, maxChars) {
    const clean = String(text || 'Error')
        .replace(/\r\n/g, '\n')
        .replace(/\t/g, '  ');
    const cols = Math.max(8, maxChars | 0);
    const lines = [];

    for (const para of clean.split('\n')) {
        if (!para.length) {
            lines.push('');
            continue;
        }
        for (let i = 0; i < para.length; i += cols) {
            lines.push(para.slice(i, i + cols));
        }
    }
    return lines.length > 0 ? lines : ['Error'];
}

function showErrorPopup(title, message) {
    const detail = formatErrDetail(message);
    OS.log(`DE POPUP [${title}]: ${detail}`);

    const pw = Math.min(240, Math.max(140, gfx.width - 16));
    const ph = 92;
    const px = Math.max(4, Math.floor((gfx.width - pw) / 2));
    const py = Math.max(CFG.topBarHeight + 6, Math.floor((gfx.height - ph) / 2));

    const maxChars = Math.max(8, Math.floor((pw - 12) / 8));
    const lines = wrapLines(detail, maxChars).slice(0, 5);

    const btnW = 34;
    const btnH = 12;
    const btnX = Math.floor((pw - btnW) / 2);
    const btnY = ph - btnH - 5;

    const popupApp = {
        render(win) {
            gfx.clear(1);
            gfx.rect(0, 0, win.w, win.h, 9, false);
            for (let i = 0; i < lines.length; i++) {
                gfx.drawText(lines[i], 6, 5 + i * 9, 15, -1);
            }
            gfx.rect(btnX, btnY, btnW, btnH, 4, true);
            gfx.rect(btnX, btnY, btnW, btnH, 15, false);
            gfx.drawText('OK', btnX + 9, btnY + 2, 15, -1);
        },
        onMouse(ev, win) {
            if (
                ev.action === 'down' &&
                ev.x >= btnX &&
                ev.x < btnX + btnW &&
                ev.y >= btnY &&
                ev.y < btnY + btnH
            ) {
                win.close();
                return true;
            }
            return false;
        },
        onKey(key, win) {
            if (key === 'Enter' || key === ' ' || key === 'Escape') {
                win.close();
                return true;
            }
            return false;
        },
    };

    const popup = createWindow({
        title: String(title || 'ERROR').toUpperCase(),
        x: px,
        y: py,
        w: pw,
        h: ph,
        app: popupApp,
    });
    focusWindow(popup);
    return popup;
}

function dumpDebugState(reason = 'manual') {
    const top = windows[windows.length - 1] || null;
    const summary = windows
        .map(
            (w) =>
                `#${w.id}:${w.title}(${w.x},${w.y},${w.w}x${w.h},min=${w.minimized},max=${w.maximized},dirty=${w.dirty},path=${w.appPath || 'inline'})`,
        )
        .join(' | ');
    OS.log(
        `DE DBG [${reason}]: wins=${windows.length} top=${top ? `#${top.id}:${top.title}` : 'none'} drag=${dragWin ? `#${dragWin.id}` : 'none'} resize=${resizeWin ? `#${resizeWin.id}` : 'none'} mouseWin=${activeMouseWin ? `#${activeMouseWin.id}` : 'none'} [${summary}]`,
    );
}

function loadAppModule(appPath) {
    if (!appPath || typeof appPath !== 'string') {
        throw new Error('Invalid appPath');
    }
    const resolved = typeof OS.resolvePath === 'function' ? OS.resolvePath(appPath) : appPath;
    if (!OS.fs || typeof OS.fs.read !== 'function') {
        throw new Error('OS.fs.read unavailable');
    }
    const code = OS.fs.read(resolved);
    if (code === null || code === undefined) {
        throw new Error(`App not found: ${resolved}`);
    }

    try {
        const module = { exports: {} };
        const fn = new Function('OS', 'HW', 'module', 'exports', `"use strict";\n${code}`);
        fn(OS, HW, module, module.exports);

        return module.exports && module.exports.default ? module.exports.default : module.exports;
    } catch (err) {
        if (typeof OS.log === 'function') {
            OS.log(
                `DE loadAppModule [${resolved}] err=${err && err.name}: ${err && err.message}\nstack=${err && err.stack ? err.stack : ''}`,
            );
        }
        throw new Error(`[${resolved}] ${err && err.message ? err.message : String(err)}`);
    }
}

function resolveAppInstance(appOrPath, win, api) {
    let raw = appOrPath;
    if (typeof appOrPath === 'string') {
        raw = loadAppModule(appOrPath);
    }
    if (typeof raw === 'function') {
        return raw(win, api) || {};
    }
    if (raw && typeof raw.createApp === 'function') {
        return raw.createApp(win, api) || {};
    }
    return raw || {};
}

function createWindow({
    title = 'Window',
    x = 20,
    y = 20,
    w = 140,
    h = 90,
    app,
    appPath,
    args = [],
}) {
    const scale = gfx.scale;
    const win = {
        id: nextWinId++,
        title,
        appPath: appPath || null,
        x: x | 0,
        y: y | 0,
        w: w | 0,
        h: h | 0,
        args,
        minimized: false,
        maximized: false,
        restoreRect: null,
        buf: gfx.createBuffer(w * scale, h * scale, scale),
        dirty: true,
        app: {},
        invalidate() {
            this.dirty = true;
        },
        resize(nextW, nextH) {
            const maxW = Math.max(40, gfx.width - this.x - BORDER * 2);
            const maxH = Math.max(32, gfx.height - this.y - TITLE_H - BORDER * 2);
            const nw = Math.max(48, Math.min(maxW, nextW | 0));
            const nh = Math.max(32, Math.min(maxH, nextH | 0));
            if (nw === this.w && nh === this.h && this.buf) {
                this.dirty = true;
                return;
            }
            const s = gfx.scale;
            this.w = nw;
            this.h = nh;
            this.buf = gfx.createBuffer(nw * s, nh * s, s);
            this.dirty = true;
        },
        toggleMinimize() {
            this.minimized = !this.minimized;
            if (this.minimized) {
                clearPointerCaptureFor(this);
            } else {
                focusWindow(this);
                this.dirty = true;
            }
        },
        toggleMaximize() {
            this.minimized = false;
            if (!this.maximized) {
                this.restoreRect = { x: this.x, y: this.y, w: this.w, h: this.h };
                const topY = CFG.topBarHeight + 1;
                const maxW = Math.max(48, gfx.width - BORDER * 2);
                const maxH = Math.max(32, gfx.height - topY - TITLE_H - BORDER * 2);
                this.x = 0;
                this.y = topY;
                this.maximized = true;
                this.resize(maxW, maxH);
            } else if (this.restoreRect) {
                const r = this.restoreRect;
                this.x = r.x;
                this.y = r.y;
                this.restoreRect = null;
                this.maximized = false;
                this.resize(r.w, r.h);
            }
            focusWindow(this);
        },
        close() {
            const idx = windows.indexOf(this);
            if (idx === -1) return;
            clearPointerCaptureFor(this);
            windows.splice(idx, 1);
            if (typeof this.app.destroy === 'function') {
                try {
                    this.app.destroy(this, api);
                } catch (err) {
                    OS.log(
                        `DE: destroy error in #${this.id} "${this.title}": ${formatErrDetail(err)}`,
                    );
                }
            }
        },
    };

    try {
        win.app = resolveAppInstance(appPath || app, win, api);
        if (typeof win.app.init === 'function') {
            win.app.init(win, api);
        }
    } catch (err) {
        if (title !== 'ERROR') {
            showErrorPopup(`APP: ${title}`, err);
        } else {
            OS.log(`DE: popup init failed: ${formatErrDetail(err)}`);
        }
        return null;
    }

    windows.push(win);
    return win;
}

function focusWindow(win) {
    if (!win) return;
    const idx = windows.indexOf(win);
    if (idx !== -1 && idx !== windows.length - 1) {
        windows.splice(idx, 1);
        windows.push(win);
    }
}

function hitTest(mx, my) {
    for (let i = windows.length - 1; i >= 0; i--) {
        const win = windows[i];
        if (win.minimized) continue;

        const outerW = win.w + BORDER * 2;
        const outerH = win.h + TITLE_H + BORDER * 2;

        // Bottom-right corner resize grip (slightly forgiving hit box)
        const inResize =
            !win.maximized &&
            mx >= win.x + outerW - 9 &&
            mx <= win.x + outerW + 2 &&
            my >= win.y + outerH - 9 &&
            my <= win.y + outerH + 2;

        if (inResize) {
            return {
                win,
                inClose: false,
                inMax: false,
                inMin: false,
                inTitle: false,
                inResize: true,
                clientX: mx - (win.x + BORDER),
                clientY: my - (win.y + BORDER + TITLE_H),
            };
        }

        if (mx >= win.x && mx < win.x + outerW && my >= win.y && my < win.y + outerH) {
            const btnY0 = win.y + BORDER + 1;
            const closeX0 = win.x + outerW - 11;
            const maxX0 = win.x + outerW - 21;
            const minX0 = win.x + outerW - 31;

            const inClose = mx >= closeX0 && mx < closeX0 + 9 && my >= btnY0 && my < btnY0 + 9;
            const inMax = mx >= maxX0 && mx < maxX0 + 9 && my >= btnY0 && my < btnY0 + 9;
            const inMin = mx >= minX0 && mx < minX0 + 9 && my >= btnY0 && my < btnY0 + 9;
            const inTitle = my < win.y + BORDER + TITLE_H;

            return {
                win,
                inClose,
                inMax,
                inMin,
                inTitle,
                inResize: false,
                clientX: mx - (win.x + BORDER),
                clientY: my - (win.y + BORDER + TITLE_H),
            };
        }
    }
    return null;
}

function compositeWindow(win, isFocused) {
    if (win.minimized) return;

    if (win.dirty && typeof win.app.render === 'function') {
        try {
            gfx.withTarget(win.buf, () => {
                win.app.render(win, api);
            });
        } catch (err) {
            win.dirty = false;
            gfx.withTarget(win.buf, () => {
                gfx.clear(1);
                gfx.drawText('RENDER ERROR', 4, 4, 9, -1);
                gfx.drawText(formatErr(err).slice(0, 22), 4, 16, 15, -1);
            });
            if (win.title !== 'ERROR') {
                showErrorPopup(`RENDER: ${win.title}`, err);
            }
        }
        win.dirty = false;
    }

    const outerW = win.w + BORDER * 2;
    const outerH = win.h + TITLE_H + BORDER * 2;
    const btnY = win.y + BORDER + 1;
    const closeX = win.x + outerW - 11;
    const maxX = win.x + outerW - 21;
    const minX = win.x + outerW - 31;

    gfx.rect(win.x, win.y, outerW, outerH, isFocused ? 15 : 8, false);
    gfx.rect(win.x + BORDER, win.y + BORDER, win.w, TITLE_H, isFocused ? 4 : 8, true);
    gfx.line(
        win.x + BORDER,
        win.y + BORDER + TITLE_H - 1,
        win.x + win.w,
        win.y + BORDER + TITLE_H - 1,
        isFocused ? 15 : 7,
    );

    const maxChars = Math.max(0, Math.floor((win.w - 36) / 8));
    gfx.drawText(win.title.slice(0, maxChars), win.x + BORDER + 3, win.y + BORDER + 2, 15, -1);

    // Minimize button (_)
    gfx.rect(minX, btnY, 9, 9, 7, true);
    gfx.drawChar('_', minX + 1, btnY - 1, 0, -1);

    // Maximize / restore button (+)
    gfx.rect(maxX, btnY, 9, 9, 2, true);
    gfx.drawChar(win.maximized ? '-' : '+', maxX + 1, btnY, 15, -1);

    // Close button (x)
    gfx.rect(closeX, btnY, 9, 9, 9, true);
    gfx.drawChar('x', closeX + 1, btnY, 15, -1);

    const scale = gfx.scale;
    gfx.blit(
        win.buf,
        (win.x + BORDER) * scale,
        (win.y + BORDER + TITLE_H) * scale,
        vram,
        physW,
        physH,
    );

    // Bottom-right corner resize grip
    if (!win.maximized) {
        const gx = win.x + outerW - 1;
        const gy = win.y + outerH - 1;
        gfx.line(gx - 6, gy, gx, gy - 6, isFocused ? 11 : 7);
        gfx.line(gx - 3, gy, gx, gy - 3, isFocused ? 15 : 8);
    }
}

function drawTopBar() {
    gfx.rect(0, 0, gfx.width, CFG.topBarHeight, CFG.topBarBg, true);
    gfx.line(0, CFG.topBarHeight, gfx.width - 1, CFG.topBarHeight, CFG.topBarBorder);

    minBarItems = [];
    let xCursor = 4;

    const minWins = windows.filter((w) => w.minimized);
    for (const mw of minWins) {
        const label = `[${mw.title.slice(0, 6)}]`;
        const chipW = label.length * 8 + 4;
        if (xCursor + chipW >= gfx.width - 4) break;
        gfx.rect(xCursor, 1, chipW, CFG.topBarHeight - 2, 1, true);
        gfx.rect(xCursor, 1, chipW, CFG.topBarHeight - 2, 11, false);
        gfx.drawText(label, xCursor + 2, 2, 15, -1);
        minBarItems.push({
            win: mw,
            x0: xCursor,
            x1: xCursor + chipW,
            y0: 0,
            y1: CFG.topBarHeight,
        });
        xCursor += chipW + 4;
    }

    const activeCount = windows.filter((w) => !w.minimized).length;
    const barText = debugHudEnabled
        ? `DBG W:${activeCount}/${windows.length} FPS:${fps} Q:${pendingKeys.length}`
        : `RING-0 DE | WIN:${activeCount} | ESC:EXIT`;
    const availW = Math.max(0, gfx.width - xCursor - 4);
    if (availW >= 16) {
        gfx.drawText(barText.slice(0, Math.floor(availW / 8)), xCursor, 2, CFG.topBarFg, -1);
    }
}

function topBarHitTest(mx, my) {
    if (my < 0 || my > CFG.topBarHeight) return null;
    for (const item of minBarItems) {
        if (mx >= item.x0 && mx <= item.x1 && my >= item.y0 && my <= item.y1) {
            return item.win;
        }
    }
    return null;
}

function drawCursor(cx, cy, pressed) {
    const color = pressed ? 11 : 15;
    gfx.line(cx - 4, cy, cx + 4, cy, color);
    gfx.line(cx, cy - 4, cx, cy + 4, color);
    gfx.pixel(cx, cy, 9);
}

const api = {
    config: CFG,
    spawnWindow(opts) {
        return createWindow(opts);
    },
    showError(title, err) {
        return showErrorPopup(title, err);
    },
    focusWindow,
    getWindows() {
        return windows.slice();
    },
    getFocusedWindow() {
        for (let i = windows.length - 1; i >= 0; i--) {
            if (!windows[i].minimized) return windows[i];
        }
        return null;
    },
    dumpDebug: dumpDebugState,
};

function loadDesktopApps() {
    const parsed = readJsonSafe('/etc/apps.json');
    if (!parsed) return [];

    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed.apps) ? parsed.apps : [];
    const { cellW, cellH, topY } = CFG.icon;
    const cols = Math.max(1, Math.floor((gfx.width - 16) / cellW));

    return list
        .filter((item) => item && item.exec)
        .map((item, idx) => {
            const col = idx % cols;
            const row = Math.floor(idx / cols);
            const x = typeof item.x === 'number' ? item.x : 12 + col * cellW;
            const y = typeof item.y === 'number' ? item.y : topY + row * cellH;
            const label = item.name || item.id || item.exec.split('/').pop().replace(/\.js$/, '');
            return {
                id: item.id || label,
                name: String(label),
                exec: String(item.exec),
                mode: item.mode === 'exec' ? 'exec' : 'window',
                w: Number.isFinite(Number(item.w)) ? Number(item.w) : 155,
                h: Number.isFinite(Number(item.h)) ? Number(item.h) : 85,
                x: x | 0,
                y: y | 0,
            };
        });
}

const desktopApps = loadDesktopApps();

function iconHitTest(mx, my) {
    const { boxW, boxH, maxLabelChars } = CFG.icon;
    for (let i = desktopApps.length - 1; i >= 0; i--) {
        const icon = desktopApps[i];
        const label = icon.name.slice(0, maxLabelChars);
        const hitW = Math.max(boxW, label.length * 8);
        const hitH = boxH + 10;
        if (mx >= icon.x && mx < icon.x + hitW && my >= icon.y && my < icon.y + hitH) {
            return icon;
        }
    }
    return null;
}

function launchDesktopApp(icon) {
    if (icon.mode === 'exec') {
        Promise.resolve()
            .then(() => OS.exec(icon.exec, [], OS.env))
            .then(() => {
                if (OS.tty && typeof OS.tty.invalidate === 'function') {
                    OS.tty.invalidate();
                }
            })
            .catch((err) => showErrorPopup(`EXEC: ${icon.name}`, err));
        return;
    }

    const offset = (windows.length * 14) % 56;
    createWindow({
        title: icon.name.toUpperCase(),
        x: 24 + offset,
        y: 24 + offset,
        w: icon.w,
        h: icon.h,
        appPath: icon.exec,
    });
}

function drawDesktopIcons() {
    const { boxW, boxH, maxLabelChars, boxBg, boxBorder, glyphFg, labelFg } = CFG.icon;
    for (const icon of desktopApps) {
        const boxX = icon.x + 8;
        gfx.rect(boxX, icon.y, boxW, boxH, boxBorder, false);
        gfx.rect(boxX + 1, icon.y + 1, boxW - 2, boxH - 2, boxBg, true);
        const glyph = icon.name.charAt(0).toUpperCase() || '?';
        gfx.drawChar(glyph, boxX + 8, icon.y + 6, glyphFg, -1);

        const label = icon.name.slice(0, maxLabelChars);
        gfx.drawText(label, icon.x, icon.y + boxH + 2, labelFg, -1);
    }
}

for (let i = 0; i < (args || []).length; i++) {
    const path = args[i];
    const name = String(path).split('/').pop().replace(/\.js$/, '').toUpperCase();
    createWindow({
        title: name || 'APP',
        x: 16 + i * 72,
        y: 22 + i * 32,
        w: 155,
        h: 85,
        appPath: path,
    });
}

// --- MAIN DE COMPOSITOR LOOP ---

const pendingKeys = [];
const releaseInput =
    OS.input && typeof OS.input.pushHandler === 'function'
        ? OS.input.pushHandler((key) => pendingKeys.push(key))
        : null;

let lastTickMs = Date.now();
let fps = 0;
let frameAccum = 0;
let timeAccum = 0;

try {
    while (true) {
        try {
            const now = Date.now();
            const dt = Math.min(0.1, (now - lastTickMs) / 1000);
            lastTickMs = now;
            frameAccum++;
            timeAccum += dt;
            if (timeAccum >= 0.5) {
                fps = Math.round(frameAccum / timeAccum);
                frameAccum = 0;
                timeAccum = 0;
            }

            // 1. Keyboard input -> focused (non-minimized top) window, with DE fallback shortcuts
            let shouldExit = false;
            while (pendingKeys.length > 0) {
                const key = pendingKeys.shift();
                const focused = api.getFocusedWindow();
                let handled = false;

                if (focused && typeof focused.app.onKey === 'function') {
                    try {
                        handled = Boolean(focused.app.onKey(key, focused, api));
                    } catch (err) {
                        handled = true;
                        showErrorPopup(`KEY: ${focused.title}`, err);
                    }
                }

                if (!handled && key === 'F12') {
                    debugHudEnabled = !debugHudEnabled;
                    dumpDebugState(debugHudEnabled ? 'hud-on' : 'hud-off');
                    handled = true;
                }

                if (!handled && (key === 'Escape' || key === 'F10')) {
                    for (let i = windows.length - 1; i >= 0; i--) {
                        if (typeof windows[i].app.destroy === 'function') {
                            try {
                                windows[i].app.destroy(windows[i], api);
                            } catch (err) {
                                OS.log(`DE: destroy error: ${formatErrDetail(err)}`);
                            }
                        }
                    }
                    windows.length = 0;
                    vram.set(savedVram);
                    if (OS.tty && typeof OS.tty.invalidate === 'function') {
                        OS.tty.invalidate();
                    }
                    shouldExit = true;
                    break;
                }
            }

            if (shouldExit) {
                return 0;
            }

            // 2. Pointer input -> top bar restore, hit test, focus, drag/resize, or client events
            let ev;
            while ((ev = OS.pollMouse()) !== null) {
                const mx = Math.floor(ev.x / gfx.scale);
                const my = Math.floor(ev.y / gfx.scale);

                if (ev.action === 'down') {
                    const restoredWin = topBarHitTest(mx, my);
                    if (restoredWin) {
                        restoredWin.toggleMinimize();
                        continue;
                    }

                    const hit = hitTest(mx, my);
                    if (hit) {
                        focusWindow(hit.win);
                        if (hit.inClose) {
                            hit.win.close();
                        } else if (hit.inMin) {
                            hit.win.toggleMinimize();
                        } else if (hit.inMax) {
                            hit.win.toggleMaximize();
                        } else if (hit.inResize) {
                            resizeWin = hit.win;
                            resizeStartX = mx;
                            resizeStartY = my;
                            resizeOrigW = hit.win.w;
                            resizeOrigH = hit.win.h;
                        } else if (hit.inTitle) {
                            if (hit.win.maximized) {
                                hit.win.toggleMaximize();
                            }
                            dragWin = hit.win;
                            dragOffX = mx - hit.win.x;
                            dragOffY = my - hit.win.y;
                        } else {
                            activeMouseWin = hit.win;
                            if (typeof hit.win.app.onMouse === 'function') {
                                try {
                                    hit.win.app.onMouse(
                                        {
                                            action: 'down',
                                            x: hit.clientX,
                                            y: hit.clientY,
                                            button: ev.button,
                                            buttons: ev.buttons,
                                        },
                                        hit.win,
                                        api,
                                    );
                                } catch (err) {
                                    showErrorPopup(`MOUSE: ${hit.win.title}`, err);
                                }
                            }
                        }
                    } else {
                        const icon = iconHitTest(mx, my);
                        if (icon) {
                            launchDesktopApp(icon);
                        }
                    }
                } else if (ev.action === 'move') {
                    if (resizeWin && !resizeWin.minimized) {
                        resizeWin.resize(
                            resizeOrigW + (mx - resizeStartX),
                            resizeOrigH + (my - resizeStartY),
                        );
                    } else if (dragWin && !dragWin.minimized) {
                        dragWin.x = Math.max(0, Math.min(gfx.width - 24, mx - dragOffX));
                        dragWin.y = Math.max(
                            CFG.topBarHeight + 1,
                            Math.min(gfx.height - TITLE_H, my - dragOffY),
                        );
                    } else if (
                        activeMouseWin &&
                        !activeMouseWin.minimized &&
                        typeof activeMouseWin.app.onMouse === 'function'
                    ) {
                        try {
                            activeMouseWin.app.onMouse(
                                {
                                    action: 'move',
                                    x: mx - (activeMouseWin.x + BORDER),
                                    y: my - (activeMouseWin.y + BORDER + TITLE_H),
                                    button: ev.button,
                                    buttons: ev.buttons,
                                },
                                activeMouseWin,
                                api,
                            );
                        } catch (err) {
                            showErrorPopup(`MOUSE: ${activeMouseWin.title}`, err);
                        }
                    }
                } else if (ev.action === 'up') {
                    if (dragWin) dragWin = null;
                    if (resizeWin) resizeWin = null;
                    if (activeMouseWin && typeof activeMouseWin.app.onMouse === 'function') {
                        try {
                            activeMouseWin.app.onMouse(
                                {
                                    action: 'up',
                                    x: mx - (activeMouseWin.x + BORDER),
                                    y: my - (activeMouseWin.y + BORDER + TITLE_H),
                                    button: ev.button,
                                    buttons: ev.buttons,
                                },
                                activeMouseWin,
                                api,
                            );
                        } catch (err) {
                            showErrorPopup(`MOUSE: ${activeMouseWin.title}`, err);
                        }
                    }
                    activeMouseWin = null;
                }
            }

            // 3. Per-frame app updates
            for (let i = 0; i < windows.length; i++) {
                const win = windows[i];
                if (win.minimized) continue;
                if (typeof win.app.update === 'function') {
                    try {
                        win.app.update(dt, win, api);
                    } catch (err) {
                        showErrorPopup(`UPDATE: ${win.title}`, err);
                    }
                }
            }

            // 4. Composite desktop + icons + windows (back-to-front) + top bar + cursor
            gfx.clear(CFG.desktopBg);
            drawDesktopIcons();

            for (let i = 0; i < windows.length; i++) {
                compositeWindow(windows[i], i === windows.length - 1 && !windows[i].minimized);
            }

            drawTopBar();

            if (OS.mouse) {
                drawCursor(
                    Math.floor(OS.mouse.x / gfx.scale),
                    Math.floor(OS.mouse.y / gfx.scale),
                    OS.mouse.buttons > 0,
                );
            }
        } catch (err) {
            dragWin = null;
            resizeWin = null;
            activeMouseWin = null;
            showErrorPopup('DE COMPOSITOR', err);
        }

        await OS.nextFrame();
    }
} finally {
    if (typeof releaseInput === 'function') {
        releaseInput();
    }
    if (OS.input && typeof OS.input.focus === 'function' && OS.tty) {
        OS.input.focus(OS.tty);
    }
}
