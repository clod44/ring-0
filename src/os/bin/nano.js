// --- 1. VALIDATION & CONFIG ---

if (!args[0]) {
    OS.tty.println('Usage: nano <file>', 11);
    return 1;
}

const path = OS.resolvePath(args[0]);
if (OS.fs.isDir(path)) {
    OS.tty.println(`nano: ${path}: Is a directory`, 9);
    return 1;
}

const COLS = OS.tty.cols; // 40
const ROWS = OS.tty.rows; // 30
const VIEW_ROWS = ROWS - 2; // 28 editable rows

const THEME = {
    bg: 0,
    text: 15,
    headerBg: 10,
    headerFg: 0,
    footerBg: 214,
    footerFg: 0,
};

// --- 2. STATE & PURE HELPERS ---

function createState(filePath, content) {
    return {
        path: filePath,
        lines: content !== null ? content.replace(/\r\n/g, '\n').split('\n') : [''],
        cx: 0,
        cy: 0,
        scrollX: 0,
        scrollY: 0,
        dirty: false,
        status: content === null ? 'New file' : '',
        running: true,
    };
}

function clampScroll(s) {
    if (s.cy < s.scrollY) s.scrollY = s.cy;
    if (s.cy >= s.scrollY + VIEW_ROWS) s.scrollY = s.cy - VIEW_ROWS + 1;

    if (s.cx < s.scrollX) s.scrollX = s.cx;
    if (s.cx >= s.scrollX + COLS) s.scrollX = s.cx - COLS + 1;
}

function insertText(s, text) {
    const line = s.lines[s.cy];
    s.lines[s.cy] = line.slice(0, s.cx) + text + line.slice(s.cx);
    s.cx += text.length;
    s.dirty = true;
}

function insertNewline(s) {
    const line = s.lines[s.cy];
    s.lines[s.cy] = line.slice(0, s.cx);
    s.lines.splice(s.cy + 1, 0, line.slice(s.cx));
    s.cy++;
    s.cx = 0;
    s.dirty = true;
}

function deleteBackward(s) {
    if (s.cx > 0) {
        const line = s.lines[s.cy];
        s.lines[s.cy] = line.slice(0, s.cx - 1) + line.slice(s.cx);
        s.cx--;
        s.dirty = true;
    } else if (s.cy > 0) {
        const prevLen = s.lines[s.cy - 1].length;
        s.lines[s.cy - 1] += s.lines[s.cy];
        s.lines.splice(s.cy, 1);
        s.cy--;
        s.cx = prevLen;
        s.dirty = true;
    }
}

function deleteForward(s) {
    const line = s.lines[s.cy];
    if (s.cx < line.length) {
        s.lines[s.cy] = line.slice(0, s.cx) + line.slice(s.cx + 1);
        s.dirty = true;
    } else if (s.cy < s.lines.length - 1) {
        s.lines[s.cy] += s.lines[s.cy + 1];
        s.lines.splice(s.cy + 1, 1);
        s.dirty = true;
    }
}

function saveFile(s) {
    OS.fs.write(s.path, s.lines.join('\n'));
    s.dirty = false;
    s.status = 'Saved!';
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
            s.cx = Math.min(s.cx, s.lines[s.cy].length);
        }
    },
    ArrowDown: (s) => {
        if (s.cy < s.lines.length - 1) {
            s.cy++;
            s.cx = Math.min(s.cx, s.lines[s.cy].length);
        }
    },
    ArrowLeft: (s) => {
        if (s.cx > 0) {
            s.cx--;
        } else if (s.cy > 0) {
            s.cy--;
            s.cx = s.lines[s.cy].length;
        }
    },
    ArrowRight: (s) => {
        if (s.cx < s.lines[s.cy].length) {
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
        s.cx = s.lines[s.cy].length;
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
    OS.gfx.rect(0, 0, OS.width, 8, THEME.headerBg, true);
    const title = ` NANO  ${s.path}${s.dirty ? ' *' : ''}`;
    OS.gfx.drawText(title.slice(0, COLS), 0, 0, THEME.headerFg, THEME.headerBg);
}

function drawViewport(s) {
    for (let row = 0; row < VIEW_ROWS; row++) {
        const lineIdx = s.scrollY + row;
        if (lineIdx >= s.lines.length) break;

        const visible = s.lines[lineIdx].slice(s.scrollX, s.scrollX + COLS);
        OS.gfx.drawText(visible, 0, (row + 1) * 8, THEME.text, THEME.bg);
    }
}

function drawCursor(s) {
    const screenX = (s.cx - s.scrollX) * 8;
    const screenY = (s.cy - s.scrollY + 1) * 8;
    const chUnder = s.lines[s.cy][s.cx] || ' ';
    OS.gfx.drawChar(chUnder, screenX, screenY, THEME.bg, THEME.text);
}

function drawFooter(s) {
    const footerY = (ROWS - 1) * 8;
    OS.gfx.rect(0, footerY, OS.width, 8, THEME.footerBg, true);

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

const state = createState(path, OS.fs.read(path));
let frame = 0;
let cursorVisible = true;
let needsRedraw = true;

while (state.running) {
    let key;
    while ((key = OS.pollKey()) !== null) {
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

    await OS.nextFrame();
}

OS.tty.clear(THEME.bg);
return 0;
