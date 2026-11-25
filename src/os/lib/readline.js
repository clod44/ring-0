// GNU Readline-style line editor & history library

function createHistory(filePath, limit = 100) {
    const maxItems = Math.max(1, limit | 0);
    let items = [];

    try {
        if (filePath && OS.fs && typeof OS.fs.read === 'function') {
            const raw = OS.fs.read(filePath);
            if (typeof raw === 'string') {
                items = raw.split('\n').filter(Boolean).slice(-maxItems);
            }
        }
    } catch (_) {
        items = [];
    }

    return {
        items,
        add(line) {
            const entry = String(line ?? '').trim();
            if (!entry || items[items.length - 1] === entry) return;
            items.push(entry);
            if (items.length > maxItems) {
                items.splice(0, items.length - maxItems);
            }
            try {
                if (filePath && OS.fs && typeof OS.fs.write === 'function') {
                    OS.fs.write(filePath, items.join('\n'));
                }
            } catch (_) {}
        },
    };
}

function longestCommonPrefix(list) {
    if (!Array.isArray(list) || list.length === 0) return '';
    let prefix = String(list[0] ?? '');
    for (let i = 1; i < list.length; i++) {
        const candidate = String(list[i] ?? '');
        while (prefix && !candidate.startsWith(prefix)) {
            prefix = prefix.slice(0, -1);
        }
        if (!prefix) return '';
    }
    return prefix;
}

function nextKey(tty) {
    if (tty && typeof tty.pollKey === 'function') {
        return tty.pollKey();
    }
    return typeof OS.pollKey === 'function' ? OS.pollKey() : null;
}

function resolveHistoryList(history) {
    if (Array.isArray(history)) return history;
    if (history && Array.isArray(history.items)) return history.items;
    return [];
}

async function readLine({
    tty = OS.tty,
    prompt = '',
    history = [],
    complete = null,
    fg = 15,
    bg = 0,
    promptColor = 214,
    dimColor = 8,
    blinkFrames = 30,
} = {}) {
    const dev = tty || OS.tty;
    if (!dev) return '';

    const getCols = () => Math.max(1, dev.cols | 0 || 40);
    const getRows = () => Math.max(1, dev.rows | 0 || 30);
    const histList = resolveHistoryList(history);

    if (prompt) {
        dev.print(prompt, promptColor, bg);
    }

    let { x: startX, y: startY } = dev.getCursor();
    startX = Math.max(0, Math.min(getCols() - 1, startX | 0));
    startY = Math.max(0, Math.min(getRows() - 1, startY | 0));

    const state = {
        buffer: '',
        pos: 0,
        prevLen: 0,
        draft: '',
        histIdx: histList.length,
    };

    const moveTo = (offset) => {
        const cols = getCols();
        const rows = getRows();
        const clampedPos = Math.max(0, Math.min(state.buffer.length, offset | 0));
        const total = startX + clampedPos;
        const nextX = total % cols;
        const nextY = Math.max(0, Math.min(rows - 1, startY + Math.floor(total / cols)));
        dev.setCursor(nextX, nextY);
    };

    let lastCols = getCols();
    let renderedCols = lastCols;

    const clearSpan = (x0, y0, len, spanCols) => {
        if (len <= 0) return;
        const colsNow = getCols();
        const rowsNow = getRows();
        let x = x0;
        let y = y0;
        for (let i = 0; i < len; i++) {
            if (x >= 0 && x < colsNow && y >= 0 && y < rowsNow) {
                dev.setCursor(x, y);
                dev.putChar(' ', fg, bg);
            }
            x++;
            if (x >= spanCols) {
                x = 0;
                y++;
            }
        }
    };

    const redraw = () => {
        const cols = getCols();
        const rows = getRows();

        startX = Math.max(0, Math.min(cols - 1, startX));
        startY = Math.max(0, Math.min(rows - 1, startY));

        if (state.prevLen > 0) {
            clearSpan(startX, startY, state.prevLen, renderedCols);
        }

        const maxLen = Math.max(state.buffer.length, state.prevLen);
        const endRow = startY + Math.floor((startX + Math.max(0, maxLen - 1)) / cols);
        if (endRow >= rows) {
            startY = Math.max(0, startY - (endRow - (rows - 1)));
        }

        dev.setCursor(startX, startY);
        dev.print(state.buffer, fg, bg);

        state.prevLen = state.buffer.length;
        renderedCols = cols;
        state.pos = Math.max(0, Math.min(state.buffer.length, state.pos));
        moveTo(state.pos);
    };

    const setBuffer = (text) => {
        state.buffer = String(text ?? '');
        state.pos = state.buffer.length;
        redraw();
    };

    const replaceRange = (from, to, text) => {
        const start = Math.max(0, Math.min(state.buffer.length, from | 0));
        const end = Math.max(start, Math.min(state.buffer.length, to | 0));
        const ins = String(text ?? '');
        state.buffer = state.buffer.slice(0, start) + ins + state.buffer.slice(end);
        state.pos = start + ins.length;
        redraw();
    };

    const keymap = {
        ArrowLeft() {
            if (state.pos > 0) {
                state.pos--;
                moveTo(state.pos);
            }
        },
        ArrowRight() {
            if (state.pos < state.buffer.length) {
                state.pos++;
                moveTo(state.pos);
            }
        },
        Home() {
            state.pos = 0;
            moveTo(0);
        },
        End() {
            state.pos = state.buffer.length;
            moveTo(state.pos);
        },
        Backspace() {
            if (state.pos > 0) {
                replaceRange(state.pos - 1, state.pos, '');
            }
        },
        Delete() {
            if (state.pos < state.buffer.length) {
                replaceRange(state.pos, state.pos + 1, '');
            }
        },
        ArrowUp() {
            if (state.histIdx > 0) {
                if (state.histIdx === histList.length) {
                    state.draft = state.buffer;
                }
                setBuffer(histList[--state.histIdx]);
            }
        },
        ArrowDown() {
            if (state.histIdx < histList.length) {
                state.histIdx++;
                setBuffer(
                    state.histIdx === histList.length ? state.draft : histList[state.histIdx],
                );
            }
        },
        Tab() {
            if (typeof complete !== 'function') return;
            const res = complete(state.buffer, state.pos);
            if (!res || !Array.isArray(res.matches) || res.matches.length === 0) return;

            const wordStart = Math.max(0, Math.min(state.pos, res.wordStart ?? state.pos));
            const word = String(res.word ?? '');
            const matches = res.matches.map((m) => String(m));
            const isDir = typeof res.isDir === 'function' ? res.isDir : null;

            if (matches.length === 1) {
                const suffix = isDir && isDir(matches[0]) ? '' : ' ';
                replaceRange(wordStart, state.pos, matches[0] + suffix);
                return;
            }

            const common = longestCommonPrefix(matches);
            if (common.length > word.length) {
                replaceRange(wordStart, state.pos, common);
                return;
            }

            moveTo(state.buffer.length);
            dev.putChar('\n', fg, bg);
            dev.println(matches.join('  '), dimColor, bg);
            if (prompt) {
                dev.print(prompt, promptColor, bg);
            }
            ({ x: startX, y: startY } = dev.getCursor());
            startX = Math.max(0, Math.min(getCols() - 1, startX | 0));
            startY = Math.max(0, Math.min(getRows() - 1, startY | 0));
            state.prevLen = 0;
            redraw();
        },
    };

    const blinkInterval = Math.max(1, blinkFrames | 0);
    let frame = 0;
    let cursorVisible = true;
    dev.drawCursor(true);

    while (true) {
        const curCols = getCols();
        if (curCols !== lastCols) {
            lastCols = curCols;
            dev.drawCursor(false);
            redraw();
            dev.drawCursor(true);
        }

        let key;
        while ((key = nextKey(dev)) !== null) {
            dev.drawCursor(false);
            frame = 0;
            cursorVisible = true;

            if (key === 'Enter') {
                moveTo(state.buffer.length);
                dev.putChar('\n', fg, bg);
                return state.buffer;
            }

            if (key === '\x03' || key === 'Control+c') {
                moveTo(state.buffer.length);
                dev.putChar('\n', fg, bg);
                return '';
            }

            if (key === '\x15' || key === 'Control+u') {
                state.buffer = '';
                state.pos = 0;
                redraw();
                dev.drawCursor(true);
                continue;
            }

            if (keymap[key]) {
                keymap[key]();
            } else if (typeof key === 'string' && key.length === 1 && key >= ' ') {
                replaceRange(state.pos, state.pos, key);
            }

            dev.drawCursor(true);
        }

        frame++;
        if (frame % blinkInterval === 0) {
            cursorVisible = !cursorVisible;
            dev.drawCursor(cursorVisible);
        }

        await OS.nextFrame();
    }
}

module.exports = { createHistory, readLine };
