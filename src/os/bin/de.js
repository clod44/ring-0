const gfx = OS.gfx;
const vram = OS.vram;
const physW = OS.width;
const physH = OS.height;
const savedVram = new Uint8Array(vram);

const LAYERS = ['background', 'desktop', 'windows', 'panel', 'overlay'];

const DEFAULT_CFG = {
    desktopBg: 6,
    titleHeight: 12,
    borderWidth: 1,
    debugHud: false,
    pluginDir: '/etc/de/plugins',
    plugins: [],
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
    const rawCfg = readJsonSafe('/etc/de/de.json') || {};
    const num = (val, fallback, min = 0) => {
        const n = Number(val);
        return Number.isFinite(n) && n >= min ? n : fallback;
    };

    return {
        desktopBg: num(rawCfg.desktopBg, DEFAULT_CFG.desktopBg),
        titleHeight: num(rawCfg.titleHeight, DEFAULT_CFG.titleHeight, 10),
        borderWidth: num(rawCfg.borderWidth, DEFAULT_CFG.borderWidth, 0),
        debugHud: Boolean(rawCfg.debugHud ?? DEFAULT_CFG.debugHud),
        pluginDir: typeof rawCfg.pluginDir === 'string' ? rawCfg.pluginDir : DEFAULT_CFG.pluginDir,
        plugins: Array.isArray(rawCfg.plugins) ? rawCfg.plugins : DEFAULT_CFG.plugins,
    };
}

const CFG = loadDeConfig();
const TITLE_H = CFG.titleHeight;
const BORDER = Math.max(1, CFG.borderWidth);
let debugHudEnabled = CFG.debugHud;

// --- EVENT BUS ---
const listeners = new Map();

function on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => off(event, fn);
}

function off(event, fn) {
    const set = listeners.get(event);
    if (set) set.delete(fn);
}

function emit(event, payload) {
    const set = listeners.get(event);
    if (!set) return;
    for (const fn of Array.from(set)) {
        try {
            fn(payload);
        } catch (err) {
            OS.log(`DE event [${event}] error: ${formatErrDetail(err)}`);
        }
    }
}

// --- STRUTS & WORKAREA ---
const struts = new Map();
let workarea = { x: 0, y: 0, w: gfx.width, h: gfx.height };

function recomputeWorkarea() {
    let top = 0;
    let bottom = 0;
    let left = 0;
    let right = 0;

    for (const s of struts.values()) {
        if (s.top > top) top = s.top;
        if (s.bottom > bottom) bottom = s.bottom;
        if (s.left > left) left = s.left;
        if (s.right > right) right = s.right;
    }

    const x = Math.max(0, Math.min(gfx.width - 16, left | 0));
    const y = Math.max(0, Math.min(gfx.height - 16, top | 0));
    const w = Math.max(16, gfx.width - x - Math.max(0, right | 0));
    const h = Math.max(16, gfx.height - y - Math.max(0, bottom | 0));

    workarea = { x, y, w, h };
    emit('workarea:change', { ...workarea });
}

function setStrut(id, strut = {}) {
    if (!id) return;
    struts.set(String(id), {
        top: Math.max(0, Number(strut.top) || 0),
        bottom: Math.max(0, Number(strut.bottom) || 0),
        left: Math.max(0, Number(strut.left) || 0),
        right: Math.max(0, Number(strut.right) || 0),
    });
    recomputeWorkarea();
}

function removeStrut(id) {
    if (struts.delete(String(id))) {
        recomputeWorkarea();
    }
}

// --- PLUGIN REGISTRY & LAYERS ---
const plugins = [];

function registerPlugin(spec = {}) {
    const layer = LAYERS.includes(spec.layer) ? spec.layer : 'desktop';
    const order = Number.isFinite(Number(spec.order)) ? Number(spec.order) : 100;
    const entry = {
        id: spec.id || `plugin-${plugins.length + 1}`,
        layer,
        order,
        init: typeof spec.init === 'function' ? spec.init : null,
        update: typeof spec.update === 'function' ? spec.update : null,
        render: typeof spec.render === 'function' ? spec.render : null,
        onMouse: typeof spec.onMouse === 'function' ? spec.onMouse : null,
        onKey: typeof spec.onKey === 'function' ? spec.onKey : null,
        destroy: typeof spec.destroy === 'function' ? spec.destroy : null,
    };
    plugins.push(entry);
    plugins.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    return entry;
}

function pluginsInLayer(layer, reverse = false) {
    const list = plugins.filter((p) => p.layer === layer);
    return reverse ? list.reverse() : list;
}

// --- WINDOW MANAGER ---
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

    const pw = Math.min(240, Math.max(140, workarea.w - 16));
    const ph = 92;
    const px = workarea.x + Math.max(4, Math.floor((workarea.w - pw) / 2));
    const py = workarea.y + Math.max(4, Math.floor((workarea.h - ph) / 2));

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
    if (popup) {
        focusWindow(popup);
    }
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
        `DE DBG [${reason}]: wins=${windows.length} top=${top ? `#${top.id}:${top.title}` : 'none'} plugins=${plugins.length} workarea=(${workarea.x},${workarea.y},${workarea.w}x${workarea.h}) [${summary}]`,
    );
}

function loadJsModule(filePath) {
    if (!filePath || typeof filePath !== 'string') {
        throw new Error('Invalid module path');
    }
    const resolved = typeof OS.resolvePath === 'function' ? OS.resolvePath(filePath) : filePath;
    if (!OS.fs || typeof OS.fs.read !== 'function') {
        throw new Error('OS.fs.read unavailable');
    }
    const code = OS.fs.read(resolved);
    if (code === null || code === undefined) {
        throw new Error(`Module not found: ${resolved}`);
    }

    try {
        const module = { exports: {} };
        const fn = new Function('OS', 'HW', 'DE', 'module', 'exports', `"use strict";\n${code}`);
        fn(OS, HW, api, module, module.exports);
        return module.exports && module.exports.default ? module.exports.default : module.exports;
    } catch (err) {
        OS.log(
            `DE loadJsModule [${resolved}] err=${err && err.name}: ${err && err.message}\nstack=${err && err.stack ? err.stack : ''}`,
        );
        throw new Error(`[${resolved}] ${err && err.message ? err.message : String(err)}`);
    }
}

function resolveAppInstance(appOrPath, win) {
    let raw = appOrPath;
    if (typeof appOrPath === 'string') {
        raw = loadJsModule(appOrPath);
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
    x = workarea.x + 16,
    y = workarea.y + 16,
    w = 140,
    h = 90,
    app,
    appPath,
    args = [],
}) {
    const scale = gfx.scale;
    const initW = Math.max(48, Math.min(workarea.w - BORDER * 2, w | 0));
    const initH = Math.max(32, Math.min(workarea.h - TITLE_H - BORDER * 2, h | 0));
    const clampedX = Math.max(
        workarea.x,
        Math.min(workarea.x + workarea.w - initW - BORDER * 2, x | 0),
    );
    const clampedY = Math.max(
        workarea.y,
        Math.min(workarea.y + workarea.h - initH - TITLE_H - BORDER * 2, y | 0),
    );

    const win = {
        id: nextWinId++,
        title,
        appPath: appPath || null,
        x: clampedX,
        y: clampedY,
        w: initW,
        h: initH,
        args,
        minimized: false,
        maximized: false,
        restoreRect: null,
        buf: gfx.createBuffer(initW * scale, initH * scale, scale),
        dirty: true,
        app: {},
        setTitle(nextTitle) {
            this.title = String(nextTitle || '');
            emit('window:title', this);
        },
        invalidate() {
            this.dirty = true;
        },
        resize(nextW, nextH) {
            const maxW = Math.max(48, gfx.width - this.x - BORDER * 2);
            const maxH = Math.max(32, gfx.height - this.y - TITLE_H - BORDER * 2);
            const nw = Math.max(48, Math.min(maxW, nextW | 0));
            const nh = Math.max(32, Math.min(maxH, nextH | 0));
            const sizeChanged = nw !== this.w || nh !== this.h || !this.buf;

            if (sizeChanged) {
                const s = gfx.scale;
                this.w = nw;
                this.h = nh;
                this.buf = gfx.createBuffer(nw * s, nh * s, s);
                if (this.app && typeof this.app.onResize === 'function') {
                    try {
                        this.app.onResize(this, api);
                    } catch (err) {
                        showErrorPopup(`RESIZE: ${this.title}`, err);
                    }
                }
            }
            this.dirty = true;
        },
        toggleMinimize() {
            this.minimized = !this.minimized;
            if (this.minimized) {
                clearPointerCaptureFor(this);
            } else {
                this.dirty = true;
                focusWindow(this);
            }
            emit('window:minimize', this);
        },
        toggleMaximize() {
            this.minimized = false;
            if (!this.maximized) {
                this.restoreRect = { x: this.x, y: this.y, w: this.w, h: this.h };
                const maxW = Math.max(48, workarea.w - BORDER * 2);
                const maxH = Math.max(32, workarea.h - TITLE_H - BORDER * 2);
                this.x = workarea.x;
                this.y = workarea.y;
                this.maximized = true;
                this.dirty = true;
                this.resize(maxW, maxH);
            } else if (this.restoreRect) {
                const r = this.restoreRect;
                this.x = r.x;
                this.y = r.y;
                this.restoreRect = null;
                this.maximized = false;
                this.dirty = true;
                this.resize(r.w, r.h);
            }
            focusWindow(this);
            emit('window:maximize', this);
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
            emit('window:close', this);
        },
    };

    try {
        win.app = resolveAppInstance(appPath || app, win);
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
    emit('window:open', win);
    return win;
}

function focusWindow(win) {
    if (!win) return;
    const idx = windows.indexOf(win);
    if (idx !== -1 && idx !== windows.length - 1) {
        const prevTop = windows[windows.length - 1];
        if (prevTop) prevTop.dirty = true;
        windows.splice(idx, 1);
        windows.push(win);
        win.dirty = true;
        emit('window:focus', win);
    }
}

function hitTestWindow(mx, my) {
    for (let i = windows.length - 1; i >= 0; i--) {
        const win = windows[i];
        if (win.minimized) continue;

        const outerW = win.w + BORDER * 2;
        const outerH = win.h + TITLE_H + BORDER * 2;

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
        win.x + BORDER + win.w - 1,
        win.y + BORDER + TITLE_H - 1,
        isFocused ? 15 : 7,
    );

    const titleX = win.x + BORDER + 3;
    const availPx = Math.max(0, minX - 2 - titleX);
    const maxChars = Math.floor(availPx / 8);
    if (maxChars > 0) {
        const shown =
            win.title.length > maxChars && maxChars > 1
                ? win.title.slice(0, maxChars - 1) + '~'
                : win.title.slice(0, maxChars);
        gfx.drawText(shown, titleX, win.y + BORDER + 2, 15, -1);
    }

    gfx.rect(minX, btnY, 9, 9, 7, true);
    gfx.drawChar('_', minX + 1, btnY - 1, 0, -1);

    gfx.rect(maxX, btnY, 9, 9, 2, true);
    gfx.drawChar(win.maximized ? '-' : '+', maxX + 1, btnY, 15, -1);

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

    if (!win.maximized) {
        const gx = win.x + outerW - 1;
        const gy = win.y + outerH - 1;
        gfx.line(gx - 6, gy, gx, gy - 6, isFocused ? 11 : 7);
        gfx.line(gx - 3, gy, gx, gy - 3, isFocused ? 15 : 8);
    }
}

function drawCursor(cx, cy, pressed) {
    const color = pressed ? 11 : 15;
    gfx.line(cx - 4, cy, cx + 4, cy, color);
    gfx.line(cx, cy - 4, cx, cy + 4, color);
    gfx.pixel(cx, cy, 9);
}

// --- PUBLIC CORE API PASSED TO PLUGINS & APPS ---
const api = {
    config: CFG,
    layers: LAYERS,
    getWorkarea() {
        return { ...workarea };
    },
    setStrut,
    removeStrut,
    registerPlugin,
    on,
    off,
    emit,
    readJson: readJsonSafe,
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
    isDebugHud() {
        return debugHudEnabled;
    },
    dumpDebug: dumpDebugState,
};

// --- AUTO-DISCOVERY & PLUGIN LOADING ---
function discoverPluginPaths(dirPath) {
    const found = new Set();

    if (OS.fs && typeof OS.fs.listDir === 'function') {
        try {
            const canCheck =
                typeof OS.fs.exists === 'function' && typeof OS.fs.isDir === 'function';
            if (!canCheck || (OS.fs.exists(dirPath) && OS.fs.isDir(dirPath))) {
                const entries = OS.fs.listDir(dirPath) || [];
                for (const entry of entries) {
                    if (!entry || entry.type !== 'file') continue;
                    const p = entry.path || `${dirPath.replace(/\/+$/, '')}/${entry.name}`;
                    if (p.endsWith('.js')) {
                        found.add(p);
                    }
                }
            }
        } catch (err) {
            OS.log(`DE: failed to list plugins in ${dirPath}: ${formatErrDetail(err)}`);
        }
    }

    for (const p of CFG.plugins) {
        if (typeof p === 'string' && p.trim()) {
            found.add(p.trim());
        } else if (p && typeof p.path === 'string' && p.enabled !== false) {
            found.add(p.path.trim());
        }
    }

    return Array.from(found).sort();
}

function initPlugins() {
    const paths = discoverPluginPaths(CFG.pluginDir);
    const loadedSpecs = [];

    for (const path of paths) {
        try {
            const mod = loadJsModule(path);
            const spec = typeof mod === 'function' ? mod(api) : mod;
            if (spec && typeof spec === 'object') {
                const entry = registerPlugin({ id: path, ...spec });
                loadedSpecs.push({ entry, spec });
            }
        } catch (err) {
            showErrorPopup(`PLUGIN: ${path.split('/').pop()}`, err);
        }
    }

    // Re-sort after plugins may have updated `order` in their returned spec
    plugins.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

    for (const { entry, spec } of loadedSpecs) {
        if (!entry.init) continue;
        try {
            entry.init(api, spec.config || {});
        } catch (err) {
            showErrorPopup(`INIT: ${entry.id}`, err);
        }
    }
}

initPlugins();

// Spawn any windows passed via `args` when launching DE
const startupArgs = typeof args !== 'undefined' && Array.isArray(args) ? args : [];
for (let i = 0; i < startupArgs.length; i++) {
    const path = startupArgs[i];
    const name = String(path).split('/').pop().replace(/\.js$/, '').toUpperCase();
    createWindow({
        title: name || 'APP',
        x: workarea.x + 16 + i * 24,
        y: workarea.y + 16 + i * 20,
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

function routeMouseToLayer(layer, ev) {
    for (const p of pluginsInLayer(layer, true)) {
        if (!p.onMouse) continue;
        try {
            if (p.onMouse(ev, api)) return true;
        } catch (err) {
            showErrorPopup(`MOUSE: ${p.id}`, err);
            return true;
        }
    }
    return false;
}

function routeKeyToLayer(layer, key) {
    for (const p of pluginsInLayer(layer, true)) {
        if (!p.onKey) continue;
        try {
            if (p.onKey(key, api)) return true;
        } catch (err) {
            showErrorPopup(`KEY: ${p.id}`, err);
            return true;
        }
    }
    return false;
}

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

            // 1. Keyboard routing: overlay -> focused window -> panel/desktop/background -> DE shortcuts
            let shouldExit = false;
            while (pendingKeys.length > 0) {
                const key = pendingKeys.shift();
                let handled = routeKeyToLayer('overlay', key);

                if (!handled) {
                    const focused = api.getFocusedWindow();
                    if (focused && typeof focused.app.onKey === 'function') {
                        try {
                            handled = Boolean(focused.app.onKey(key, focused, api));
                        } catch (err) {
                            handled = true;
                            showErrorPopup(`KEY: ${focused.title}`, err);
                        }
                    }
                }

                if (!handled) handled = routeKeyToLayer('panel', key);
                if (!handled) handled = routeKeyToLayer('desktop', key);
                if (!handled) handled = routeKeyToLayer('background', key);

                if (!handled && key === 'F12') {
                    debugHudEnabled = !debugHudEnabled;
                    emit('debug:toggle', debugHudEnabled);
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

            // 2. Pointer routing: overlay -> panel -> windows -> desktop -> background
            let ev;
            while ((ev = OS.pollMouse()) !== null) {
                const mx = Math.floor(ev.x / gfx.scale);
                const my = Math.floor(ev.y / gfx.scale);
                const ptEv = {
                    action: ev.action,
                    x: mx,
                    y: my,
                    button: ev.button,
                    buttons: ev.buttons,
                };

                if (ev.action === 'down') {
                    if (routeMouseToLayer('overlay', ptEv)) continue;
                    if (routeMouseToLayer('panel', ptEv)) continue;

                    const hit = hitTestWindow(mx, my);
                    if (hit) {
                        focusWindow(hit.win);
                        if (hit.inClose) {
                            hit.win.close();
                        } else if (hit.inMin) {
                            hit.win.toggleMinimize();
                        } else if (hit.inMax) {
                            hit.win.toggleMaximize();
                        } else if (hit.inResize) {
                            dragWin = null;
                            activeMouseWin = null;
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
                        continue;
                    }

                    if (routeMouseToLayer('desktop', ptEv)) continue;
                    routeMouseToLayer('background', ptEv);
                } else if (ev.action === 'move') {
                    if (resizeWin && !resizeWin.minimized) {
                        resizeWin.resize(
                            resizeOrigW + (mx - resizeStartX),
                            resizeOrigH + (my - resizeStartY),
                        );
                    } else if (dragWin && !dragWin.minimized) {
                        dragWin.x = Math.max(0, Math.min(gfx.width - 24, mx - dragOffX));
                        dragWin.y = Math.max(
                            workarea.y,
                            Math.min(gfx.height - TITLE_H, my - dragOffY),
                        );
                        dragWin.dirty = true;
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
                    } else {
                        routeMouseToLayer('overlay', ptEv);
                        routeMouseToLayer('panel', ptEv);
                        routeMouseToLayer('desktop', ptEv);
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
                    routeMouseToLayer('overlay', ptEv);
                    routeMouseToLayer('panel', ptEv);
                }
            }

            // 3. Per-frame plugin & window updates
            for (let i = 0; i < plugins.length; i++) {
                const p = plugins[i];
                if (!p.update) continue;
                try {
                    p.update(dt, api, { fps, pendingKeys: pendingKeys.length });
                } catch (err) {
                    showErrorPopup(`UPDATE: ${p.id}`, err);
                }
            }

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

            // 4. Composite layers bottom-to-top: background -> desktop -> windows -> panel -> overlay
            gfx.clear(CFG.desktopBg);

            for (const p of pluginsInLayer('background')) {
                try {
                    p.render && p.render(gfx, api);
                } catch (err) {
                    showErrorPopup(`RENDER: ${p.id}`, err);
                }
            }

            for (const p of pluginsInLayer('desktop')) {
                try {
                    p.render && p.render(gfx, api);
                } catch (err) {
                    showErrorPopup(`RENDER: ${p.id}`, err);
                }
            }

            for (let i = 0; i < windows.length; i++) {
                compositeWindow(windows[i], i === windows.length - 1 && !windows[i].minimized);
            }

            for (const p of pluginsInLayer('panel')) {
                try {
                    p.render && p.render(gfx, api);
                } catch (err) {
                    showErrorPopup(`RENDER: ${p.id}`, err);
                }
            }

            for (const p of pluginsInLayer('overlay')) {
                try {
                    p.render && p.render(gfx, api);
                } catch (err) {
                    showErrorPopup(`RENDER: ${p.id}`, err);
                }
            }

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
    for (let i = plugins.length - 1; i >= 0; i--) {
        if (plugins[i].destroy) {
            try {
                plugins[i].destroy(api);
            } catch (err) {
                OS.log(`DE: plugin destroy error (${plugins[i].id}): ${formatErrDetail(err)}`);
            }
        }
    }
    if (typeof releaseInput === 'function') {
        releaseInput();
    }
    if (OS.input && typeof OS.input.focus === 'function' && OS.tty) {
        OS.input.focus(OS.tty);
    }
}
