// GNU Readline-style line editor & history library

function createHistory(filePath, limit = 100) {
    let items = [];
    try {
        if (filePath && OS.fs && typeof OS.fs.read === 'function') {
            const raw = OS.fs.read(filePath);
            if (typeof raw === 'string') {
                items = raw.split('\n').filter(Boolean).slice(-limit);
            }
        }
    } catch (_) {
        items = [];
    }

    return {
        items,
        add(line) {
            if (!line || items[items.length - 1] === line) return;
            items.push(line);
            if (items.length > limit) items.shift();
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
    let prefix = list[0];
    for (let i = 1; i < list.length; i++) {
        while (!list[i].startsWith(prefix)) {
            prefix = prefix.slice(0, -1);
            if (!prefix) return '';
        }
    }
    return prefix;
}

function nextKey(tty) {
    if (tty && typeof tty.pollKey === 'function') {
        return tty.pollKey();
    }
    return typeof OS.pollKey === 'function' ? OS.pollKey() : null;
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
} = {}) {
    const dev = tty || OS.tty;
    if (!dev) return '';

    const COLS = dev.cols || 40;
    const ROWS = dev.rows || 30;
    const histList = Array.isArray(history) ? history : [];

    dev.print(prompt, promptColor, bg);
    let { x: startX, y: startY } = dev.getCursor();

    const state = {
        buffer: '',
        pos: 0,
        prevLen: 0,
        draft: '',
        histIdx: histList.length,
    };

    const moveTo = (offset) => {
        const total = startX + offset;
        dev.setCursor(total % COLS, startY + Math.floor(total / COLS));
    };

    const redraw = () => {
        const maxLen = Math.max(state.buffer.length, state.prevLen);
        const endRow = startY + Math.floor((startX + maxLen) / COLS);
        const overflow = Math.max(0, endRow - (ROWS - 1));

        dev.setCursor(startX, startY);
        dev.print(state.buffer, fg, bg);

        if (state.prevLen > state.buffer.length) {
            dev.print(' '.repeat(state.prevLen - state.buffer.length), fg, bg);
        }

        if (overflow > 0) startY = Math.max(0, startY - overflow);

        state.prevLen = state.buffer.length;
        moveTo(state.pos);
    };

    const setBuffer = (text) => {
        state.buffer = String(text ?? '');
        state.pos = state.buffer.length;
        redraw();
    };

    const replaceRange = (from, to, text) => {
        state.buffer = state.buffer.slice(0, from) + text + state.buffer.slice(to);
        state.pos = from + text.length;
        redraw();
    };

    const keymap = {
        ArrowLeft() {
            if (state.pos > 0) moveTo(--state.pos);
        },
        ArrowRight() {
            if (state.pos < state.buffer.length) moveTo(++state.pos);
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
            if (state.pos > 0) replaceRange(state.pos - 1, state.pos, '');
        },
        Delete() {
            if (state.pos < state.buffer.length) {
                state.buffer = state.buffer.slice(0, state.pos) + state.buffer.slice(state.pos + 1);
                redraw();
            }
        },
        ArrowUp() {
            if (state.histIdx > 0) {
                if (state.histIdx === histList.length) state.draft = state.buffer;
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

            const { wordStart = state.pos, word = '', matches, isDir } = res;

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
            dev.print(prompt, promptColor, bg);
            ({ x: startX, y: startY } = dev.getCursor());
            state.prevLen = 0;
            redraw();
        },
    };

    let frame = 0;
    let cursorVisible = true;
    dev.drawCursor(true);

    while (true) {
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

            if (keymap[key]) {
                keymap[key]();
            } else if (typeof key === 'string' && key.length === 1) {
                replaceRange(state.pos, state.pos, key);
            }

            dev.drawCursor(true);
        }

        frame++;
        if (frame % 30 === 0) {
            cursorVisible = !cursorVisible;
            dev.drawCursor(cursorVisible);
        }

        await OS.nextFrame();
    }
}

module.exports = { createHistory, readLine };
