const gfx = OS.gfx;
const vram = OS.vram;
const physW = OS.width;
const physH = OS.height;
const savedVram = new Uint8Array(vram);

const TITLE_H = 12;
const BORDER = 1;

// Z-order list: index 0 = back, length - 1 = front (focused)
const windows = [];
let nextWinId = 1;

function loadAppModule(appPath) {
    const resolved = OS.resolvePath(appPath);
    const code = OS.fs.read(resolved);
    if (code === null) {
        throw new Error(`DE: App not found: ${resolved}`);
    }

    const module = { exports: {} };
    const fn = new Function('OS', 'HW', 'module', 'exports', `"use strict";\n${code}`);
    fn(OS, HW, module, module.exports);

    return module.exports && module.exports.default ? module.exports.default : module.exports;
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
        x: x | 0,
        y: y | 0,
        w: w | 0,
        h: h | 0,
        args,
        buf: gfx.createBuffer(w * scale, h * scale, scale),
        dirty: true,
        app: {},
        invalidate() {
            this.dirty = true;
        },
        resize(nextW, nextH) {
            const nw = Math.max(24, nextW | 0);
            const nh = Math.max(20, nextH | 0);
            const s = gfx.scale;
            this.w = nw;
            this.h = nh;
            this.buf = gfx.createBuffer(nw * s, nh * s, s);
            this.dirty = true;
        },
        close() {
            const idx = windows.indexOf(this);
            if (idx === -1) return;
            windows.splice(idx, 1);
            if (typeof this.app.destroy === 'function') {
                this.app.destroy(this, api);
            }
        },
    };

    win.app = resolveAppInstance(appPath || app, win, api);

    if (typeof win.app.init === 'function') {
        win.app.init(win, api);
    }

    windows.push(win);
    return win;
}

function focusWindow(win) {
    const idx = windows.indexOf(win);
    if (idx !== -1 && idx !== windows.length - 1) {
        windows.splice(idx, 1);
        windows.push(win);
    }
}

function hitTest(mx, my) {
    for (let i = windows.length - 1; i >= 0; i--) {
        const win = windows[i];
        const outerW = win.w + BORDER * 2;
        const outerH = win.h + TITLE_H + BORDER * 2;

        if (mx >= win.x && mx < win.x + outerW && my >= win.y && my < win.y + outerH) {
            const closeX0 = win.x + outerW - 11;
            const closeY0 = win.y + BORDER + 1;
            const inClose = mx >= closeX0 && mx < closeX0 + 9 && my >= closeY0 && my < closeY0 + 9;

            const inTitle = my < win.y + BORDER + TITLE_H;
            return {
                win,
                inClose,
                inTitle,
                clientX: mx - (win.x + BORDER),
                clientY: my - (win.y + BORDER + TITLE_H),
            };
        }
    }
    return null;
}

function compositeWindow(win, isFocused) {
    if (win.dirty && typeof win.app.render === 'function') {
        gfx.withTarget(win.buf, () => {
            win.app.render(win, api);
        });
        win.dirty = false;
    }

    const outerW = win.w + BORDER * 2;
    const outerH = win.h + TITLE_H + BORDER * 2;

    // Outer frame & title bar drawn onto VRAM
    gfx.rect(win.x, win.y, outerW, outerH, isFocused ? 15 : 8, false);
    gfx.rect(win.x + BORDER, win.y + BORDER, win.w, TITLE_H, isFocused ? 4 : 8, true);
    gfx.line(
        win.x + BORDER,
        win.y + BORDER + TITLE_H - 1,
        win.x + win.w,
        win.y + BORDER + TITLE_H - 1,
        isFocused ? 15 : 7,
    );

    const maxChars = Math.max(0, Math.floor((win.w - 16) / 8));
    gfx.drawText(win.title.slice(0, maxChars), win.x + BORDER + 3, win.y + BORDER + 2, 15, -1);

    // Close button [x]
    const closeX = win.x + outerW - 11;
    const closeY = win.y + BORDER + 1;
    gfx.rect(closeX, closeY, 9, 9, 9, true);
    gfx.drawChar('x', closeX + 1, closeY, 15, -1);

    // Blit the window's blind client buffer into the client area
    const scale = gfx.scale;
    gfx.blit(
        win.buf,
        (win.x + BORDER) * scale,
        (win.y + BORDER + TITLE_H) * scale,
        vram,
        physW,
        physH,
    );
}

function drawCursor(cx, cy, pressed) {
    const color = pressed ? 11 : 15;
    gfx.line(cx - 4, cy, cx + 4, cy, color);
    gfx.line(cx, cy - 4, cx, cy + 4, color);
    gfx.pixel(cx, cy, 9);
}

const api = {
    spawnWindow(opts) {
        return createWindow(opts);
    },
    focusWindow,
    getWindows() {
        return windows.slice();
    },
    getFocusedWindow() {
        return windows[windows.length - 1] || null;
    },
};

// Optional startup apps passed via args, e.g.:
// exec /de.js /apps/counter.js /apps/sketch.js
const startupPaths = args.length > 0 ? args : ['/apps/counter.js', '/apps/sketch.js'];

for (let i = 0; i < startupPaths.length; i++) {
    const path = startupPaths[i];
    const name = path.split('/').pop().replace(/\.js$/, '').toUpperCase();
    try {
        createWindow({
            title: name,
            x: 16 + i * 72,
            y: 22 + i * 32,
            w: 155,
            h: 85,
            appPath: path,
        });
    } catch (err) {
        OS.log(`DE: failed to launch ${path}: ${err.message}`);
    }
}

// --- MAIN DE COMPOSITOR LOOP ---

let dragWin = null;
let dragOffX = 0;
let dragOffY = 0;
let activeMouseWin = null;
let lastTickMs = Date.now();

while (true) {
    const now = Date.now();
    const dt = Math.min(0.1, (now - lastTickMs) / 1000);
    lastTickMs = now;

    // 1. Keyboard input -> focused (top) window, with DE fallback shortcuts
    let key;
    while ((key = OS.pollKey()) !== null) {
        const focused = windows[windows.length - 1] || null;
        const handled =
            focused && typeof focused.app.onKey === 'function'
                ? focused.app.onKey(key, focused, api)
                : false;

        if (!handled) {
            if (key === 'Escape' || key === 'F10') {
                for (let i = windows.length - 1; i >= 0; i--) {
                    if (typeof windows[i].app.destroy === 'function') {
                        windows[i].app.destroy(windows[i], api);
                    }
                }
                windows.length = 0;
                vram.set(savedVram);
                return 0;
            }
            if (key === 'n' || key === 'N') {
                const offset = (windows.length * 14) % 60;
                createWindow({
                    title: `COUNTER #${nextWinId}`,
                    x: 24 + offset,
                    y: 26 + offset,
                    w: 155,
                    h: 85,
                    appPath: '/apps/counter.js',
                });
            }
        }
    }

    // 2. Pointer input -> hit test, focus, drag, or window-local client events
    let ev;
    while ((ev = OS.pollMouse()) !== null) {
        const mx = Math.floor(ev.x / gfx.scale);
        const my = Math.floor(ev.y / gfx.scale);

        if (ev.action === 'down') {
            const hit = hitTest(mx, my);
            if (hit) {
                focusWindow(hit.win);
                if (hit.inClose) {
                    hit.win.close();
                } else if (hit.inTitle) {
                    dragWin = hit.win;
                    dragOffX = mx - hit.win.x;
                    dragOffY = my - hit.win.y;
                } else {
                    activeMouseWin = hit.win;
                    if (typeof hit.win.app.onMouse === 'function') {
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
                    }
                }
            }
        } else if (ev.action === 'move') {
            if (dragWin) {
                dragWin.x = mx - dragOffX;
                dragWin.y = my - dragOffY;
            } else if (activeMouseWin && typeof activeMouseWin.app.onMouse === 'function') {
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
            }
        } else if (ev.action === 'up') {
            if (dragWin) {
                dragWin = null;
            }
            if (activeMouseWin && typeof activeMouseWin.app.onMouse === 'function') {
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
            }
            activeMouseWin = null;
        }
    }

    // 3. Per-frame app updates
    for (let i = 0; i < windows.length; i++) {
        const win = windows[i];
        if (typeof win.app.update === 'function') {
            win.app.update(dt, win, api);
        }
    }

    // 4. Composite desktop + windows (back-to-front) + top bar + cursor
    gfx.clear(6); // Teal desktop

    gfx.rect(0, 0, gfx.width, 11, 0, true);
    gfx.line(0, 11, gfx.width - 1, 11, 8);
    gfx.drawText(`RING-0 DE | WIN:${windows.length} | N:NEW ESC:EXIT`, 4, 2, 15, 0);

    for (let i = 0; i < windows.length; i++) {
        compositeWindow(windows[i], i === windows.length - 1);
    }

    if (OS.mouse) {
        drawCursor(
            Math.floor(OS.mouse.x / gfx.scale),
            Math.floor(OS.mouse.y / gfx.scale),
            OS.mouse.buttons > 0,
        );
    }

    await OS.nextFrame();
}
