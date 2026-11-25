// Folder Explorer DE Window App (with File & Folder Picker Modes)

const { loadFileAssociations, resolveHandlerApp } =
    typeof OS.require === 'function'
        ? OS.require('/lib/filetype.js')
        : {
              loadFileAssociations: () => ({}),
              resolveHandlerApp: (p) =>
                  String(p || '')
                      .toLowerCase()
                      .endsWith('.js')
                      ? { appPath: p, args: [], directExec: true }
                      : null,
          };

const TOOLBAR_H = 14;
const STATUS_H = 12;
const ROW_H = 10;

function normalizePath(p) {
    if (typeof OS.resolvePath === 'function') {
        const res = OS.resolvePath(p || '/');
        return res || '/';
    }
    const raw = String(p || '/').trim() || '/';
    const parts = raw.split('/').filter((seg) => seg && seg !== '.');
    const stack = [];
    for (const part of parts) {
        if (part === '..') stack.pop();
        else stack.push(part);
    }
    return '/' + stack.join('/');
}

function parentPath(p) {
    const norm = normalizePath(p);
    if (norm === '/') return '/';
    const idx = norm.lastIndexOf('/');
    return idx <= 0 ? '/' : norm.slice(0, idx);
}

function joinChild(base, name) {
    const b = normalizePath(base);
    return b === '/' ? `/${name}` : `${b}/${name}`;
}

function getExtLower(name) {
    const idx = String(name || '').lastIndexOf('.');
    if (idx <= 0 || idx === name.length - 1) return '';
    return name.slice(idx + 1).toLowerCase();
}

function extractPickerConfig(win) {
    const firstArg = win && Array.isArray(win.args) ? win.args[0] : null;
    const raw =
        win && win.picker && typeof win.picker === 'object'
            ? win.picker
            : firstArg && typeof firstArg === 'object'
              ? firstArg
              : null;

    if (!raw || !raw.mode) {
        return {
            enabled: false,
            mode: 'browse',
            startDir: typeof firstArg === 'string' ? firstArg : OS.cwd || '/',
            exts: null,
            onPick: null,
            onCancel: null,
        };
    }

    const mode = raw.mode === 'folder' ? 'folder' : 'file';
    const exts = Array.isArray(raw.exts)
        ? raw.exts.map((e) => String(e).replace(/^\./, '').toLowerCase()).filter(Boolean)
        : null;

    return {
        enabled: true,
        mode,
        startDir: raw.startDir || OS.cwd || '/',
        exts,
        onPick: typeof raw.onPick === 'function' ? raw.onPick : null,
        onCancel: typeof raw.onCancel === 'function' ? raw.onCancel : null,
    };
}

function safeReadDir(dirPath, picker) {
    if (!OS.fs || typeof OS.fs.listDir !== 'function') {
        return { entries: [], error: 'OS.fs.listDir unavailable' };
    }
    try {
        const raw = OS.fs.listDir(dirPath);
        const list = Array.isArray(raw) ? raw : [];
        const entries = list
            .filter((e) => e && e.name)
            .map((e) => {
                const full = joinChild(dirPath, String(e.name));
                const isDir =
                    e.type === 'dir' || (typeof OS.fs.isDir === 'function' && OS.fs.isDir(full));
                const ext = isDir ? '' : getExtLower(String(e.name));
                const allowed =
                    isDir ||
                    !picker.enabled ||
                    picker.mode !== 'file' ||
                    !picker.exts ||
                    picker.exts.includes(ext);

                return {
                    name: String(e.name),
                    path: full,
                    isDir: Boolean(isDir),
                    ext,
                    allowed,
                };
            })
            .sort((a, b) => {
                if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
                return a.name.localeCompare(b.name);
            });
        return { entries, error: null };
    } catch (err) {
        return {
            entries: [],
            error: err && err.message ? err.message : String(err),
        };
    }
}

function createApp(win, api) {
    const associations = loadFileAssociations();
    const picker = extractPickerConfig(win);

    let cwd = normalizePath(picker.startDir);
    let entries = [];
    let loadError = null;
    let selectedIdx = -1;
    let scrollOffset = 0;
    let lastClickIdx = -1;
    let lastClickMs = 0;
    let buttons = [];
    let rowHitboxes = [];
    let statusMsg = '';
    let settled = false;

    function finishPick(chosenPath, w) {
        if (!chosenPath || settled) return;
        settled = true;
        const clean = normalizePath(chosenPath);
        try {
            if (picker.onPick) {
                picker.onPick(clean);
            }
        } finally {
            if (w && typeof w.close === 'function') {
                w.close();
            }
        }
    }

    function finishCancel(w) {
        if (settled) return;
        settled = true;
        try {
            if (picker.onCancel) {
                picker.onCancel();
            }
        } finally {
            if (w && typeof w.close === 'function') {
                w.close();
            }
        }
    }

    function canPickCurrent(entry) {
        if (!picker.enabled) return false;
        if (picker.mode === 'folder') {
            return true;
        }
        return Boolean(entry && !entry.isDir && entry.allowed);
    }

    function triggerPick(w) {
        const selected = selectedIdx >= 0 ? entries[selectedIdx] : null;
        if (picker.mode === 'folder') {
            const targetFolder = selected && selected.isDir ? selected.path : cwd;
            finishPick(targetFolder, w);
            return;
        }
        if (selected && !selected.isDir && selected.allowed) {
            finishPick(selected.path, w);
        } else {
            statusMsg = 'Select a valid file first';
            if (w && typeof w.invalidate === 'function') w.invalidate();
        }
    }

    function refresh(w) {
        const res = safeReadDir(cwd, picker);
        entries = res.entries;
        loadError = res.error;
        if (selectedIdx >= entries.length) selectedIdx = entries.length - 1;
        if (scrollOffset > Math.max(0, entries.length - 1)) scrollOffset = 0;
        if (w && typeof w.invalidate === 'function') w.invalidate();
    }

    function openEntry(entry, w) {
        if (!entry) return;
        if (entry.isDir) {
            cwd = normalizePath(entry.path);
            selectedIdx = -1;
            scrollOffset = 0;
            statusMsg = '';
            refresh(w);
            return;
        }

        if (picker.enabled) {
            if (picker.mode === 'file' && entry.allowed) {
                finishPick(entry.path, w);
            } else if (picker.mode === 'file' && !entry.allowed) {
                statusMsg = `Only ${picker.exts.join(', ')} allowed`;
                if (w && typeof w.invalidate === 'function') w.invalidate();
            }
            return;
        }

        const route = resolveHandlerApp(entry.path, associations);
        if (route && api && typeof api.spawnWindow === 'function') {
            const winTitle = route.directExec
                ? entry.name.replace(/\.js$/, '').toUpperCase()
                : `VIEW: ${entry.name.toUpperCase()}`;

            api.spawnWindow({
                title: winTitle,
                x: (w.x || 24) + 18,
                y: (w.y || 36) + 18,
                w: Math.min(240, Math.max(160, w.w)),
                h: Math.min(170, Math.max(110, w.h)),
                appPath: route.appPath,
                args: route.args,
            });
            statusMsg = `Opened ${entry.name}`;
            w.invalidate();
            return;
        }

        if (OS.fs && typeof OS.fs.read === 'function') {
            try {
                const txt = OS.fs.read(entry.path);
                const firstLine = String(txt ?? '')
                    .split('\n')[0]
                    .slice(0, 28);
                statusMsg = firstLine || '(empty file)';
            } catch (err) {
                statusMsg = err && err.message ? err.message : 'Read error';
            }
            w.invalidate();
        }
    }

    function getButtons(w) {
        const selected = selectedIdx >= 0 ? entries[selectedIdx] : null;
        const defs = picker.enabled
            ? [
                  { id: 'up', label: 'UP', bg: 1 },
                  { id: 'pick', label: 'PICK', bg: canPickCurrent(selected) ? 2 : 8 },
                  { id: 'cancel', label: 'X', bg: 9 },
              ]
            : [
                  { id: 'up', label: 'UP', bg: 1 },
                  { id: 'home', label: 'ROOT', bg: 1 },
                  { id: 'open', label: 'OPEN', bg: selectedIdx >= 0 ? 2 : 8 },
                  { id: 'dn', label: 'v', bg: 1 },
              ];

        const list = [];
        let x = 3;
        const y = 2;
        const h = 10;

        for (const d of defs) {
            const bw = d.label.length * 8 + 6;
            if (x + bw > w.w - 2) break;
            list.push({ id: d.id, label: d.label, x, y, w: bw, h, bg: d.bg });
            x += bw + 3;
        }
        return list;
    }

    return {
        init(w) {
            refresh(w);
        },

        onResize(w) {
            w.invalidate();
        },

        onMouse(ev, w) {
            if (ev.action !== 'down') return false;

            for (const b of buttons) {
                if (ev.x >= b.x && ev.x < b.x + b.w && ev.y >= b.y && ev.y < b.y + b.h) {
                    if (b.id === 'up') {
                        cwd = parentPath(cwd);
                        selectedIdx = -1;
                        scrollOffset = 0;
                        statusMsg = '';
                        refresh(w);
                    } else if (b.id === 'home') {
                        cwd = '/';
                        selectedIdx = -1;
                        scrollOffset = 0;
                        statusMsg = '';
                        refresh(w);
                    } else if (b.id === 'open') {
                        if (selectedIdx >= 0 && entries[selectedIdx]) {
                            openEntry(entries[selectedIdx], w);
                        }
                    } else if (b.id === 'pick') {
                        triggerPick(w);
                    } else if (b.id === 'cancel') {
                        finishCancel(w);
                    } else if (b.id === 'dn') {
                        const visibleRows = Math.max(
                            1,
                            Math.floor((w.h - TOOLBAR_H - STATUS_H) / ROW_H),
                        );
                        if (scrollOffset + visibleRows < entries.length) {
                            scrollOffset++;
                            w.invalidate();
                        }
                    }
                    return true;
                }
            }

            for (const r of rowHitboxes) {
                if (ev.x >= r.x && ev.x < r.x + r.w && ev.y >= r.y && ev.y < r.y + r.h) {
                    const now = Date.now();
                    const isDouble = lastClickIdx === r.idx && now - lastClickMs < 400;
                    selectedIdx = r.idx;
                    lastClickIdx = r.idx;
                    lastClickMs = now;
                    statusMsg = '';
                    if (isDouble) {
                        openEntry(entries[r.idx], w);
                    } else {
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

            // Top toolbar
            gfx.rect(0, 0, viewW, TOOLBAR_H, 1, true);
            gfx.line(0, TOOLBAR_H - 1, viewW - 1, TOOLBAR_H - 1, 8);

            buttons = getButtons(w);
            for (const b of buttons) {
                gfx.rect(b.x, b.y, b.w, b.h, b.bg, true);
                gfx.rect(b.x, b.y, b.w, b.h, 15, false);
                gfx.drawText(b.label, b.x + 3, b.y + 1, 15, -1);
            }

            const btnEndX =
                buttons.length > 0
                    ? buttons[buttons.length - 1].x + buttons[buttons.length - 1].w + 4
                    : 4;
            const pathAvail = Math.max(0, viewW - btnEndX - 2);
            if (pathAvail >= 8) {
                const maxPathChars = Math.floor(pathAvail / 8);
                const shownPath =
                    cwd.length > maxPathChars ? '..' + cwd.slice(-(maxPathChars - 2)) : cwd;
                gfx.drawText(shownPath, btnEndX, 3, picker.enabled ? 11 : 14, -1);
            }

            // Entry list
            const listTop = TOOLBAR_H + 1;
            const listBottom = Math.max(listTop, viewH - STATUS_H);
            const visibleRows = Math.max(1, Math.floor((listBottom - listTop) / ROW_H));
            rowHitboxes = [];

            if (loadError) {
                gfx.drawText(loadError.slice(0, Math.floor(viewW / 8)), 4, listTop + 2, 9, -1);
            } else if (entries.length === 0) {
                gfx.drawText('(empty)', 6, listTop + 2, 8, -1);
            } else {
                const maxScroll = Math.max(0, entries.length - visibleRows);
                if (scrollOffset > maxScroll) scrollOffset = maxScroll;

                const maxNameChars = Math.max(1, Math.floor((viewW - 44) / 8));
                for (let row = 0; row < visibleRows; row++) {
                    const idx = scrollOffset + row;
                    if (idx >= entries.length) break;

                    const item = entries[idx];
                    const ry = listTop + row * ROW_H;
                    const selected = idx === selectedIdx;

                    if (selected) {
                        gfx.rect(1, ry, viewW - 2, ROW_H - 1, 4, true);
                    }

                    const tag = item.isDir ? '[D]' : '   ';
                    const tagFg = item.isDir ? 11 : item.allowed ? 8 : 9;
                    const nameFg = selected ? 15 : !item.allowed ? 8 : item.isDir ? 14 : 7;
                    const suffix = item.isDir ? '/' : '';
                    const label = (item.name + suffix).slice(0, maxNameChars);

                    gfx.drawText(tag, 3, ry + 1, tagFg, -1);
                    gfx.drawText(label, 28, ry + 1, nameFg, -1);

                    rowHitboxes.push({
                        idx,
                        x: 1,
                        y: ry,
                        w: viewW - 2,
                        h: ROW_H - 1,
                    });
                }
            }

            // Bottom status strip
            const statusY = Math.max(TOOLBAR_H, viewH - STATUS_H);
            gfx.rect(0, statusY, viewW, STATUS_H, 1, true);
            gfx.line(0, statusY, viewW - 1, statusY, 8);

            const selectedItem = selectedIdx >= 0 ? entries[selectedIdx] : null;
            const defaultStatus = picker.enabled
                ? picker.mode === 'folder'
                    ? `Pick folder: ${selectedItem && selectedItem.isDir ? selectedItem.name : cwd}`
                    : selectedItem
                      ? `Pick file: ${selectedItem.name}`
                      : 'Select a file & click PICK'
                : selectedItem
                  ? `${selectedItem.isDir ? 'DIR' : 'FILE'}: ${selectedItem.name}`
                  : `${entries.length} item${entries.length === 1 ? '' : 's'}`;

            const infoText = statusMsg || defaultStatus;
            const maxStatusChars = Math.max(1, Math.floor((viewW - 6) / 8));
            gfx.drawText(infoText.slice(0, maxStatusChars), 3, statusY + 2, 15, -1);
        },

        destroy() {
            if (picker.enabled && !settled && picker.onCancel) {
                settled = true;
                try {
                    picker.onCancel();
                } catch (_) {}
            }
            buttons = [];
            rowHitboxes = [];
        },
    };
}

module.exports = { createApp };
