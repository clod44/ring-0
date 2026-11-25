// Mouse-Driven Text Editor DE Window App (with Save / Save As Dialog & Explorer Picker)

const TOOLBAR_H = 14;
const STATUS_H = 12;
const CELL_W = 8;
const CELL_H = 8;
const EXPLORER_PATH = '/apps/explorer.js';

function formatErr(err) {
    if (!err) return 'Unknown error';
    if (typeof err === 'string') return err;
    return err.message || String(err);
}

function safeReadText(filePath) {
    if (!filePath || !OS.fs || typeof OS.fs.read !== 'function') return null;
    try {
        const raw = OS.fs.read(filePath);
        return raw === null || raw === undefined ? null : String(raw);
    } catch (err) {
        if (typeof OS.log === 'function') {
            OS.log(`EDITOR read error [${filePath}]: ${formatErr(err)}`);
        }
        return null;
    }
}

function splitPath(fullPath) {
    const clean = String(fullPath || '/untitled.txt');
    const idx = clean.lastIndexOf('/');
    if (idx <= 0) {
        return {
            dir: '/',
            name: clean.replace(/^\/+/, '') || 'untitled.txt',
        };
    }
    return {
        dir: clean.slice(0, idx) || '/',
        name: clean.slice(idx + 1) || 'untitled.txt',
    };
}

function joinFolderFile(folderPath, fileName) {
    const cleanDir = String(folderPath || '/').replace(/\/+$/, '') || '/';
    const cleanName =
        String(fileName || 'untitled.txt')
            .trim()
            .replace(/^\/+/, '') || 'untitled.txt';
    return cleanDir === '/' ? `/${cleanName}` : `${cleanDir}/${cleanName}`;
}

function createApp(win, frameApi) {
    const hostApi = frameApi || null;
    const rawPath = win && Array.isArray(win.args) && win.args[0] ? String(win.args[0]) : '';
    const hasExplicitPath = Boolean(rawPath);
    const initialPath = hasExplicitPath
        ? typeof OS.resolvePath === 'function'
            ? OS.resolvePath(rawPath)
            : rawPath
        : '/untitled.txt';

    const loaded = hasExplicitPath ? safeReadText(initialPath) : null;

    const state = {
        path: initialPath,
        hasTargetFile: hasExplicitPath && loaded !== null,
        lines: loaded !== null ? loaded.replace(/\r\n/g, '\n').split('\n') : [''],
        cx: 0,
        cy: 0,
        scrollX: 0,
        scrollY: 0,
        dirty: false,
        status: loaded === null ? 'New file' : 'Loaded',
        draggingText: false,
    };

    let buttons = [];
    let viewArea = { x: 0, y: TOOLBAR_H, w: 1, h: 1, cols: 1, rows: 1 };
    let activeChildWin = null;

    function computeLayout(w) {
        const viewW = Math.max(1, w.w | 0 || 1);
        const viewH = Math.max(1, w.h | 0 || 1);
        const areaTop = Math.min(viewH, TOOLBAR_H);
        const areaBottom = Math.max(areaTop, viewH - STATUS_H);
        const areaH = Math.max(0, areaBottom - areaTop);
        const cols = Math.max(1, Math.floor(viewW / CELL_W));
        const rows = Math.max(1, Math.floor(areaH / CELL_H));

        viewArea = {
            x: 0,
            y: areaTop,
            w: viewW,
            h: areaH,
            cols,
            rows,
        };
    }

    function clampState() {
        if (!Array.isArray(state.lines) || state.lines.length === 0) {
            state.lines = [''];
        }
        state.cy = Math.max(0, Math.min(state.lines.length - 1, state.cy | 0));
        const line = state.lines[state.cy] ?? '';
        state.cx = Math.max(0, Math.min(line.length, state.cx | 0));

        const maxScrollY = Math.max(0, state.lines.length - viewArea.rows);
        if (state.cy < state.scrollY) state.scrollY = state.cy;
        if (state.cy >= state.scrollY + viewArea.rows) {
            state.scrollY = state.cy - viewArea.rows + 1;
        }
        state.scrollY = Math.max(0, Math.min(maxScrollY, state.scrollY));

        if (state.cx < state.scrollX) state.scrollX = state.cx;
        if (state.cx >= state.scrollX + viewArea.cols) {
            state.scrollX = state.cx - viewArea.cols + 1;
        }
        state.scrollX = Math.max(0, state.scrollX);
    }

    function placeCursorAt(clientX, clientY) {
        const hitRow = Math.floor((clientY - viewArea.y) / CELL_H);
        const hitCol = Math.floor((clientX - viewArea.x) / CELL_W);

        const targetLineIdx = Math.max(
            0,
            Math.min(state.lines.length - 1, state.scrollY + Math.max(0, hitRow)),
        );
        const lineText = state.lines[targetLineIdx] ?? '';
        const targetCol = Math.max(
            0,
            Math.min(lineText.length, state.scrollX + Math.max(0, hitCol)),
        );

        state.cy = targetLineIdx;
        state.cx = targetCol;
        state.status = '';
        clampState();
    }

    function writeToTarget(targetPath) {
        if (!OS.fs || typeof OS.fs.write !== 'function') {
            state.status = 'ERR: OS.fs.write missing';
            return false;
        }
        try {
            const resolved =
                typeof OS.resolvePath === 'function' ? OS.resolvePath(targetPath) : targetPath;
            OS.fs.write(resolved, state.lines.join('\n'));
            state.path = resolved;
            state.hasTargetFile = true;
            state.dirty = false;
            state.status = `Saved ${resolved.split('/').pop()}`;
            return true;
        } catch (err) {
            state.status = `ERR: ${formatErr(err).slice(0, 24)}`;
            if (typeof OS.log === 'function') {
                OS.log(`EDITOR save error: ${formatErr(err)}`);
            }
            return false;
        }
    }

    function newBuffer() {
        state.path = '/untitled.txt';
        state.hasTargetFile = false;
        state.lines = [''];
        state.cx = 0;
        state.cy = 0;
        state.scrollX = 0;
        state.scrollY = 0;
        state.dirty = false;
        state.status = 'New file';
    }

    function scrollBy(deltaRows) {
        const maxScrollY = Math.max(0, state.lines.length - viewArea.rows);
        state.scrollY = Math.max(0, Math.min(maxScrollY, state.scrollY + deltaRows));
    }

    function spawnChildWindow(opts) {
        if (!hostApi || typeof hostApi.spawnWindow !== 'function') {
            state.status = 'ERR: spawnWindow unavailable';
            return null;
        }
        if (activeChildWin) {
            if (hostApi.focusWindow) hostApi.focusWindow(activeChildWin);
            return activeChildWin;
        }
        activeChildWin = hostApi.spawnWindow(opts);
        return activeChildWin;
    }

    function openSaveAsDialog(w) {
        const parts = splitPath(state.path);
        let dlgDir = parts.dir;
        let dlgName = parts.name;
        let dlgButtons = [];
        let fieldRect = { x: 6, y: 34, w: 160, h: 12 };
        let editingName = true;

        const dialogApp = {
            init(dw) {
                if (dw && typeof dw.invalidate === 'function') dw.invalidate();
            },
            onResize(dw) {
                if (dw && typeof dw.invalidate === 'function') dw.invalidate();
            },
            onKey(key, dw) {
                const k =
                    key && typeof key === 'object' ? String(key.key ?? '') : String(key ?? '');
                if (!k) return false;
                if (k === 'Escape') {
                    activeChildWin = null;
                    if (dw && typeof dw.close === 'function') dw.close();
                    if (w && typeof w.invalidate === 'function') w.invalidate();
                    return true;
                }
                if (k === 'Enter') {
                    const full = joinFolderFile(dlgDir, dlgName);
                    writeToTarget(full);
                    activeChildWin = null;
                    if (dw && typeof dw.close === 'function') dw.close();
                    if (w && typeof w.invalidate === 'function') w.invalidate();
                    return true;
                }
                if (!editingName) return false;
                if (k === 'Backspace') {
                    dlgName = dlgName.slice(0, -1);
                    if (dw && typeof dw.invalidate === 'function') dw.invalidate();
                    return true;
                }
                if (k.length === 1 && k >= ' ' && k !== '/') {
                    dlgName += k;
                    if (dw && typeof dw.invalidate === 'function') dw.invalidate();
                    return true;
                }
                return false;
            },
            onMouse(ev, dw) {
                if (!ev || ev.action !== 'down') return false;

                if (
                    ev.x >= fieldRect.x &&
                    ev.x < fieldRect.x + fieldRect.w &&
                    ev.y >= fieldRect.y &&
                    ev.y < fieldRect.y + fieldRect.h
                ) {
                    editingName = true;
                    if (dw && typeof dw.invalidate === 'function') dw.invalidate();
                    return true;
                }

                for (const b of dlgButtons) {
                    if (ev.x >= b.x && ev.x < b.x + b.w && ev.y >= b.y && ev.y < b.y + b.h) {
                        if (b.id === 'dir') {
                            editingName = false;
                            if (hostApi && typeof hostApi.spawnWindow === 'function') {
                                const folderPicker = {
                                    mode: 'folder',
                                    startDir: dlgDir,
                                    onPick(pickedDir) {
                                        dlgDir = pickedDir;
                                        if (dw && typeof dw.invalidate === 'function') {
                                            dw.invalidate();
                                        }
                                    },
                                };
                                hostApi.spawnWindow({
                                    title: 'PICK FOLDER',
                                    x: Math.max(4, (dw.x || 24) + 14),
                                    y: Math.max(16, (dw.y || 28) + 14),
                                    w: 190,
                                    h: 120,
                                    appPath: EXPLORER_PATH,
                                    args: [folderPicker],
                                });
                            }
                        } else if (b.id === 'ok') {
                            const full = joinFolderFile(dlgDir, dlgName);
                            writeToTarget(full);
                            activeChildWin = null;
                            if (dw && typeof dw.close === 'function') dw.close();
                            if (w && typeof w.invalidate === 'function') w.invalidate();
                        } else if (b.id === 'cancel') {
                            activeChildWin = null;
                            if (dw && typeof dw.close === 'function') dw.close();
                            if (w && typeof w.invalidate === 'function') w.invalidate();
                        }
                        return true;
                    }
                }
                return false;
            },
            render(dw, fApi) {
                const gfx = (fApi && fApi.gfx) || OS.gfx;
                if (!gfx) return;
                const dW = Math.max(1, dw.w | 0 || 1);
                const dH = Math.max(1, dw.h | 0 || 1);

                gfx.clear(0);
                gfx.rect(0, 0, dW, dH, 1, true);
                gfx.rect(0, 0, dW, dH, 15, false);

                gfx.drawText('FOLDER:', 6, 6, 7, -1);
                const dirChars = Math.max(1, Math.floor((dW - 68) / CELL_W));
                const dirShown =
                    dlgDir.length > dirChars ? '..' + dlgDir.slice(-(dirChars - 2)) : dlgDir;
                gfx.drawText(dirShown, 62, 6, 14, -1);

                gfx.drawText('FILE:', 6, 22, 7, -1);
                fieldRect = {
                    x: 46,
                    y: 20,
                    w: Math.max(24, dW - 52),
                    h: 12,
                };
                gfx.rect(fieldRect.x, fieldRect.y, fieldRect.w, fieldRect.h, 0, true);
                gfx.rect(
                    fieldRect.x,
                    fieldRect.y,
                    fieldRect.w,
                    fieldRect.h,
                    editingName ? 11 : 8,
                    false,
                );
                const nameChars = Math.max(1, Math.floor((fieldRect.w - 6) / CELL_W));
                const shownName =
                    dlgName.length > nameChars
                        ? dlgName.slice(-(nameChars - 1)) + '_'
                        : dlgName + (editingName ? '_' : '');
                gfx.drawText(shownName, fieldRect.x + 3, fieldRect.y + 2, 15, -1);

                const defs = [
                    { id: 'dir', label: 'DIR', bg: 1 },
                    { id: 'ok', label: 'SAVE', bg: 2 },
                    { id: 'cancel', label: 'X', bg: 9 },
                ];
                dlgButtons = [];
                let bx = 6;
                const by = Math.max(36, dH - 17);
                for (const d of defs) {
                    const bw = d.label.length * CELL_W + 6;
                    dlgButtons.push({
                        id: d.id,
                        label: d.label,
                        x: bx,
                        y: by,
                        w: bw,
                        h: 11,
                        bg: d.bg,
                    });
                    gfx.rect(bx, by, bw, 11, d.bg, true);
                    gfx.rect(bx, by, bw, 11, 15, false);
                    gfx.drawText(d.label, bx + 3, by + 2, 15, -1);
                    bx += bw + 4;
                }
            },
            destroy() {
                if (activeChildWin) activeChildWin = null;
            },
        };

        spawnChildWindow({
            title: 'SAVE AS',
            x: Math.max(4, (w.x || 24) + 18),
            y: Math.max(16, (w.y || 28) + 18),
            w: 196,
            h: 64,
            app: dialogApp,
        });
    }

    function handleSaveClick(w) {
        if (!state.hasTargetFile) {
            openSaveAsDialog(w);
            return;
        }
        writeToTarget(state.path);
    }

    function openFileWithPicker(w) {
        spawnChildWindow({
            title: 'OPEN FILE',
            x: Math.max(4, (w.x || 24) + 16),
            y: Math.max(16, (w.y || 28) + 16),
            w: Math.min(220, Math.max(150, (w.w || 160) + 20)),
            h: Math.min(160, Math.max(105, (w.h || 110) + 15)),
            appPath: EXPLORER_PATH,
            args: [
                {
                    mode: 'file',
                    startDir: splitPath(state.path).dir,
                    exts: ['txt', 'json', 'md', 'log', 'js', 'cfg'],
                    onPick(pickedPath) {
                        activeChildWin = null;
                        const text = safeReadText(pickedPath);
                        if (text === null) {
                            state.status = `ERR: Cannot read ${pickedPath.split('/').pop()}`;
                        } else {
                            state.path = pickedPath;
                            state.hasTargetFile = true;
                            state.lines = text.replace(/\r\n/g, '\n').split('\n');
                            state.cx = 0;
                            state.cy = 0;
                            state.scrollX = 0;
                            state.scrollY = 0;
                            state.dirty = false;
                            state.status = `Opened ${pickedPath.split('/').pop()}`;
                            clampState();
                        }
                        if (w && typeof w.invalidate === 'function') w.invalidate();
                    },
                    onCancel() {
                        activeChildWin = null;
                        if (w && typeof w.invalidate === 'function') w.invalidate();
                    },
                },
            ],
        });
    }

    function getButtons(w) {
        const defs = [
            { id: 'open', label: 'OPEN', bg: 1 },
            { id: 'save', label: 'SAVE', bg: state.dirty || !state.hasTargetFile ? 2 : 1 },
            { id: 'saveas', label: 'SAVE AS', bg: 1 },
            { id: 'new', label: 'NEW', bg: 1 },
            { id: 'up', label: '^', bg: 1 },
            { id: 'dn', label: 'v', bg: 1 },
        ];

        const list = [];
        let x = 3;
        const y = 2;
        const h = 10;

        for (const d of defs) {
            const bw = d.label.length * CELL_W + 6;
            if (x + bw > w.w - 2) break;
            list.push({ id: d.id, label: d.label, x, y, w: bw, h, bg: d.bg });
            x += bw + 3;
        }
        return list;
    }

    return {
        init(w) {
            computeLayout(w);
            clampState();
            w.invalidate();
        },

        onResize(w) {
            computeLayout(w);
            clampState();
            w.invalidate();
        },

        onMouse(ev, w) {
            if (!ev) return false;

            if (ev.action === 'down') {
                for (const b of buttons) {
                    if (ev.x >= b.x && ev.x < b.x + b.w && ev.y >= b.y && ev.y < b.y + b.h) {
                        if (b.id === 'open') openFileWithPicker(w);
                        else if (b.id === 'save') handleSaveClick(w);
                        else if (b.id === 'saveas') openSaveAsDialog(w);
                        else if (b.id === 'new') newBuffer();
                        else if (b.id === 'up') scrollBy(-Math.max(1, viewArea.rows - 1));
                        else if (b.id === 'dn') scrollBy(Math.max(1, viewArea.rows - 1));
                        w.invalidate();
                        return true;
                    }
                }

                if (
                    ev.x >= viewArea.x &&
                    ev.x < viewArea.x + viewArea.w &&
                    ev.y >= viewArea.y &&
                    ev.y < viewArea.y + viewArea.h
                ) {
                    state.draggingText = true;
                    placeCursorAt(ev.x, ev.y);
                    w.invalidate();
                    return true;
                }
            } else if (ev.action === 'move') {
                if (state.draggingText) {
                    placeCursorAt(ev.x, ev.y);
                    w.invalidate();
                    return true;
                }
            } else if (ev.action === 'up') {
                if (state.draggingText) {
                    state.draggingText = false;
                    w.invalidate();
                    return true;
                }
            }

            return false;
        },

        onKey(key, w) {
            const k = key && typeof key === 'object' ? String(key.key ?? '') : String(key ?? '');
            if (!k) return false;

            state.status = '';

            if (k === 'ArrowLeft') {
                if (state.cx > 0) {
                    state.cx--;
                } else if (state.cy > 0) {
                    state.cy--;
                    state.cx = (state.lines[state.cy] ?? '').length;
                }
            } else if (k === 'ArrowRight') {
                const curLen = (state.lines[state.cy] ?? '').length;
                if (state.cx < curLen) {
                    state.cx++;
                } else if (state.cy < state.lines.length - 1) {
                    state.cy++;
                    state.cx = 0;
                }
            } else if (k === 'ArrowUp') {
                if (state.cy > 0) {
                    state.cy--;
                    state.cx = Math.min(state.cx, (state.lines[state.cy] ?? '').length);
                }
            } else if (k === 'ArrowDown') {
                if (state.cy < state.lines.length - 1) {
                    state.cy++;
                    state.cx = Math.min(state.cx, (state.lines[state.cy] ?? '').length);
                }
            } else if (k === 'Home') {
                state.cx = 0;
            } else if (k === 'End') {
                state.cx = (state.lines[state.cy] ?? '').length;
            } else if (k === 'Enter') {
                const line = state.lines[state.cy] ?? '';
                state.lines[state.cy] = line.slice(0, state.cx);
                state.lines.splice(state.cy + 1, 0, line.slice(state.cx));
                state.cy++;
                state.cx = 0;
                state.dirty = true;
            } else if (k === 'Backspace') {
                if (state.cx > 0) {
                    const line = state.lines[state.cy] ?? '';
                    state.lines[state.cy] = line.slice(0, state.cx - 1) + line.slice(state.cx);
                    state.cx--;
                    state.dirty = true;
                } else if (state.cy > 0) {
                    const prevLine = state.lines[state.cy - 1] ?? '';
                    const curLine = state.lines[state.cy] ?? '';
                    const prevLen = prevLine.length;
                    state.lines[state.cy - 1] = prevLine + curLine;
                    state.lines.splice(state.cy, 1);
                    state.cy--;
                    state.cx = prevLen;
                    state.dirty = true;
                }
            } else if (k === 'Delete') {
                const line = state.lines[state.cy] ?? '';
                if (state.cx < line.length) {
                    state.lines[state.cy] = line.slice(0, state.cx) + line.slice(state.cx + 1);
                    state.dirty = true;
                } else if (state.cy < state.lines.length - 1) {
                    state.lines[state.cy] = line + (state.lines[state.cy + 1] ?? '');
                    state.lines.splice(state.cy + 1, 1);
                    state.dirty = true;
                }
            } else if (k === 'Tab') {
                const line = state.lines[state.cy] ?? '';
                state.lines[state.cy] = line.slice(0, state.cx) + '  ' + line.slice(state.cx);
                state.cx += 2;
                state.dirty = true;
            } else if (k.length === 1 && k >= ' ') {
                const line = state.lines[state.cy] ?? '';
                state.lines[state.cy] = line.slice(0, state.cx) + k + line.slice(state.cx);
                state.cx += 1;
                state.dirty = true;
            } else {
                return false;
            }

            clampState();
            if (w && typeof w.invalidate === 'function') w.invalidate();
            return true;
        },

        render(w, frameApi) {
            const gfx = (frameApi && frameApi.gfx) || OS.gfx;
            if (!gfx) return;

            computeLayout(w);
            clampState();

            const viewW = viewArea.w;
            const viewH = Math.max(1, w.h | 0 || 1);

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

            const titleX =
                buttons.length > 0
                    ? buttons[buttons.length - 1].x + buttons[buttons.length - 1].w + 5
                    : 4;
            if (viewW - titleX >= 8) {
                const baseName = state.path.split('/').pop() || 'untitled.txt';
                const label = `${baseName}${state.dirty ? '*' : ''}`;
                const maxChars = Math.floor((viewW - titleX - 2) / CELL_W);
                gfx.drawText(label.slice(0, maxChars), titleX, 3, 15, -1);
            }

            // Document viewport
            for (let r = 0; r < viewArea.rows; r++) {
                const lineIdx = state.scrollY + r;
                if (lineIdx >= state.lines.length) break;
                const lineText = state.lines[lineIdx] ?? '';
                const visible = lineText.slice(state.scrollX, state.scrollX + viewArea.cols);
                gfx.drawText(visible, viewArea.x, viewArea.y + r * CELL_H, 15, -1);
            }

            // Cursor block
            const curScreenX = viewArea.x + (state.cx - state.scrollX) * CELL_W;
            const curScreenY = viewArea.y + (state.cy - state.scrollY) * CELL_H;
            if (
                curScreenX >= viewArea.x &&
                curScreenX < viewArea.x + viewArea.w &&
                curScreenY >= viewArea.y &&
                curScreenY < viewArea.y + viewArea.h
            ) {
                const curLine = state.lines[state.cy] ?? '';
                const chUnder = curLine[state.cx] || ' ';
                gfx.rect(curScreenX, curScreenY, CELL_W, CELL_H, 15, true);
                gfx.drawChar(chUnder, curScreenX, curScreenY, 0, -1);
            }

            // Bottom status strip
            const statusY = Math.max(TOOLBAR_H, viewH - STATUS_H);
            gfx.rect(0, statusY, viewW, STATUS_H, 1, true);
            gfx.line(0, statusY, viewW - 1, statusY, 8);

            const posText = `L${state.cy + 1}:C${state.cx + 1}`;
            const leftAvail = Math.max(
                1,
                Math.floor((viewW - (posText.length + 2) * CELL_W) / CELL_W),
            );
            const leftText = (state.status || (state.dirty ? 'Modified' : 'Ready')).slice(
                0,
                leftAvail,
            );

            gfx.drawText(leftText, 3, statusY + 2, state.dirty ? 11 : 7, -1);
            gfx.drawText(
                posText,
                Math.max(3, viewW - posText.length * CELL_W - 3),
                statusY + 2,
                14,
                -1,
            );
        },

        destroy() {
            state.draggingText = false;
            buttons = [];
            if (activeChildWin && typeof activeChildWin.close === 'function') {
                const child = activeChildWin;
                activeChildWin = null;
                try {
                    child.close();
                } catch (_) {}
            }
        },
    };
}

module.exports = { createApp };
