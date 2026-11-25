// --- 1. VALIDATION & CONFIG ---

const io = (typeof tty !== 'undefined' && tty) || OS.tty;

if (!args[0]) {
    if (io && typeof io.println === 'function') io.println('Usage: nano <file>', 11);
    return 1;
}

const path = OS.resolvePath(args[0]);
if (OS.fs && typeof OS.fs.isDir === 'function' && OS.fs.isDir(path)) {
    if (io && typeof io.println === 'function') io.println(`nano: ${path}: Is a directory`, 9);
    return 1;
}

const COLS = (io && io.cols) || Math.max(1, Math.floor((OS.width || 320) / 8));
const ROWS = (io && io.rows) || Math.max(1, Math.floor((OS.height || 240) / 8));
const VIEW_ROWS = Math.max(1, ROWS - 2);

const THEME = {
    bg: 0,
    text: 15,
    headerBg: 10,
    headerFg: 0,
    footerBg: 214,
    footerFg: 0,
};

function formatErr(err) {
    if (!err) return 'Unknown error';
    if (typeof err === 'string') return err;
    return err.message || String(err);
}

function safeReadFile(filePath) {
    if (!OS.fs || typeof OS.fs.read !== 'function') return null;
    try {
        return OS.fs.read(filePath);
    } catch (err) {
        if (typeof OS.log === 'function') OS.log(`nano read error: ${formatErr(err)}`);
        return null;
    }
}

// --- 2. STATE & PURE HELPERS ---

function createState(filePath, content, initialStatus = '') {
    return {
        path: filePath,
        lines: content !== null ? String(content).replace(/\r\n/g, '\n').split('\n') : [''],
        cx: 0,
        cy: 0,
        scrollX: 0,
        scrollY: 0,
        dirty: false,
        status: initialStatus || (content === null ? 'New file' : ''),
        running: true,
    };
}

function clampScroll(s) {
    if (!Array.isArray(s.lines) || s.lines.length === 0) {
        s.lines = [''];
    }
    s.cy = Math.max(0, Math.min(s.lines.length - 1, s.cy | 0));
    const curLine = s.lines[s.cy] ?? '';
    s.cx = Math.max(0, Math.min(curLine.length, s.cx | 0));

    if (s.cy < s.scrollY) s.scrollY = s.cy;
    if (s.cy >= s.scrollY + VIEW_ROWS) s.scrollY = s.cy - VIEW_ROWS + 1;
    s.scrollY = Math.max(0, Math.min(Math.max(0, s.lines.length - VIEW_ROWS), s.scrollY));

    if (s.cx < s.scrollX) s.scrollX = s.cx;
    if (s.cx >= s.scrollX + COLS) s.scrollX = s.cx - COLS + 1;
    s.scrollX = Math.max(0, s.scrollX);
}

function insertText(s, text) {
    const line = s.lines[s.cy] ?? '';
    s.lines[s.cy] = line.slice(0, s.cx) + text + line.slice(s.cx);
    s.cx += text.length;
    s.dirty = true;
}

function insertNewline(s) {
    const line = s.lines[s.cy] ?? '';
    s.lines[s.cy] = line.slice(0, s.cx);
    s.lines.splice(s.cy + 1, 0, line.slice(s.cx));
    s.cy++;
    s.cx = 0;
    s.dirty = true;
}

function deleteBackward(s) {
    if (s.cx > 0) {
        const line = s.lines[s.cy] ?? '';
        s.lines[s.cy] = line.slice(0, s.cx - 1) + line.slice(s.cx);
        s.cx--;
        s.dirty = true;
    } else if (s.cy > 0) {
        const prevLen = (s.lines[s.cy - 1] ?? '').length;
        s.lines[s.cy - 1] = (s.lines[s.cy - 1] ?? '') + (s.lines[s.cy] ?? '');
        s.lines.splice(s.cy, 1);
        s.cy--;
        s.cx = prevLen;
        s.dirty = true;
    }
}

function deleteForward(s) {
    const line = s.lines[s.cy] ?? '';
    if (s.cx < line.length) {
        s.lines[s.cy] = line.slice(0, s.cx) + line.slice(s.cx + 1);
        s.dirty = true;
    } else if (s.cy < s.lines.length - 1) {
        s.lines[s.cy] = line + (s.lines[s.cy + 1] ?? '');
        s.lines.splice(s.cy + 1, 1);
        s.dirty = true;
    }
}

function saveFile(s) {
    if (!OS.fs || typeof OS.fs.write !== 'function') {
        s.status = 'ERR: No FS';
        return;
    }
    try {
        OS.fs.write(s.path, s.lines.join('\n'));
        s.dirty = false;
        s.status = 'Saved!';
    } catch (err) {
        s.status = `ERR: ${formatErr(err).slice(0, 24)}`;
        if (typeof OS.log === 'function') OS.log(`nano save error: ${formatErr(err)}`);
    }
}

function extractKey(raw) {
    if (raw && typeof raw === 'object') {
        if (raw.ctrlKey || raw.ctrl) return null;
        return String(raw.key ?? '');
    }
    return typeof raw === 'string' ? raw : '';
}

// --- 3. KEY DISPATCH TABLE ---

const KEY_ACTIONS = {
    Escape: (s) => {
        s.running = false;
    },
    F2: saveFile,
    ArrowUp: (s) => {
        if (s.cy > 0) {
            s.cy--;
            s.cx = Math.min(s.cx, (s.lines[s.cy] ?? '').length);
        }
    },
    ArrowDown: (s) => {
        if (s.cy < s.lines.length - 1) {
            s.cy++;
            s.cx = Math.min(s.cx, (s.lines[s.cy] ?? '').length);
        }
    },
    ArrowLeft: (s) => {
        if (s.cx > 0) {
            s.cx--;
        } else if (s.cy > 0) {
            s.cy--;
            s.cx = (s.lines[s.cy] ?? '').length;
        }
    },
    ArrowRight: (s) => {
        const curLen = (s.lines[s.cy] ?? '').length;
        if (s.cx < curLen) {
            s.cx++;
        } else if (s.cy < s.lines.length - 1) {
            s.cy++;
            s.cx = 0;
        }
    },
    Home: (s) => {
        s.cx = 0;
    },
    End: (s) => {
        s.cx = (s.lines[s.cy] ?? '').length;
    },
    Enter: insertNewline,
    Backspace: deleteBackward,
    Delete: deleteForward,
    Tab: (s) => insertText(s, '  '),
};

function handleKey(s, rawKey) {
    s.status = '';
    const key = extractKey(rawKey);
    if (!key) return;

    const action = KEY_ACTIONS[key];
    if (action) {
        action(s);
    } else if (key.length === 1 && key >= ' ') {
        insertText(s, key);
    }

    clampScroll(s);
}

// --- 4. RENDERER ---

function drawHeader(s) {
    const w = (OS.gfx && OS.gfx.width) || OS.width || COLS * 8;
    OS.gfx.rect(0, 0, w, 8, THEME.headerBg, true);
    const title = ` NANO  ${s.path}${s.dirty ? ' *' : ''}`;
    OS.gfx.drawText(title.slice(0, COLS), 0, 0, THEME.headerFg, THEME.headerBg);
}

function drawViewport(s) {
    for (let row = 0; row < VIEW_ROWS; row++) {
        const lineIdx = s.scrollY + row;
        if (lineIdx >= s.lines.length) break;

        const visible = (s.lines[lineIdx] ?? '').slice(s.scrollX, s.scrollX + COLS);
        OS.gfx.drawText(visible, 0, (row + 1) * 8, THEME.text, THEME.bg);
    }
}

function drawCursor(s) {
    const screenX = (s.cx - s.scrollX) * 8;
    const screenY = (s.cy - s.scrollY + 1) * 8;
    const line = s.lines[s.cy] ?? '';
    const chUnder = line[s.cx] || ' ';
    OS.gfx.drawChar(chUnder, screenX, screenY, THEME.bg, THEME.text);
}

function drawFooter(s) {
    const w = (OS.gfx && OS.gfx.width) || OS.width || COLS * 8;
    const footerY = (ROWS - 1) * 8;
    OS.gfx.rect(0, footerY, w, 8, THEME.footerBg, true);

    const left = s.status ? ` ${s.status}` : ' F2:Save  ESC:Exit';
    const pos = `Ln ${s.cy + 1},Col ${s.cx + 1} `;
    const pad = Math.max(1, COLS - left.length - pos.length);
    const footer = (left + ' '.repeat(pad) + pos).slice(0, COLS);

    OS.gfx.drawText(footer, 0, footerY, THEME.footerFg, THEME.footerBg);
}

function render(s, cursorVisible) {
    OS.gfx.clear(THEME.bg);
    drawHeader(s);
    drawViewport(s);
    if (cursorVisible) drawCursor(s);
    drawFooter(s);
}

// --- 5. MAIN LOOP ---

const initialContent = safeReadFile(path);
const state = createState(path, initialContent);
let frame = 0;
let cursorVisible = true;
let needsRedraw = true;

const keyQueue = [];
const hasInputService = Boolean(OS.input && typeof OS.input.pushHandler === 'function');
const releaseInput = hasInputService ? OS.input.pushHandler((k) => keyQueue.push(k)) : null;

function drainKeys() {
    if (hasInputService) {
        return keyQueue.length > 0 ? keyQueue.shift() : null;
    }
    return typeof OS.pollKey === 'function' ? OS.pollKey() : null;
}

try {
    while (state.running) {
        try {
            let key;
            while ((key = drainKeys()) !== null) {
                handleKey(state, key);
                if (!state.running) break;

                needsRedraw = true;
                frame = 0;
                cursorVisible = true;
            }

            if (!state.running) break;

            frame++;
            if (frame % 30 === 0) {
                cursorVisible = !cursorVisible;
                needsRedraw = true;
            }

            if (needsRedraw) {
                render(state, cursorVisible);
                needsRedraw = false;
            }
        } catch (err) {
            state.status = `ERR: ${formatErr(err).slice(0, 24)}`;
            needsRedraw = true;
            if (typeof OS.log === 'function') OS.log(`nano loop error: ${formatErr(err)}`);
        }

        await OS.nextFrame();
    }
} finally {
    if (typeof releaseInput === 'function') {
        releaseInput();
    }
    if (io && typeof io.clear === 'function') {
        io.clear(THEME.bg);
    }
    if (OS.input && typeof OS.input.focus === 'function' && io) {
        OS.input.focus(io);
    }
}

return 0;
