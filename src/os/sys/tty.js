const DEFAULT_FG = 15;
const DEFAULT_BG = 0;
const CELL_W = 8;
const CELL_H = 8;

function createTTY(cols, rows, opts = {}) {
    const c = Math.max(1, cols | 0);
    const r = Math.max(1, rows | 0);
    const cells = c * r;
    const defaultFg = opts.defaultFg ?? DEFAULT_FG;
    const defaultBg = opts.defaultBg ?? DEFAULT_BG;

    const chars = new Uint8Array(cells).fill(32);
    const fgs = new Uint8Array(cells).fill(defaultFg);
    const bgs = new Uint8Array(cells).fill(defaultBg);

    let cursorX = 0;
    let cursorY = 0;
    let cursorVisible = true;
    let dirty = true;

    const keyQueue = [];

    function cellIndex(x, y) {
        return y * c + x;
    }

    function writeCell(x, y, ch, fg, bg) {
        if (x < 0 || x >= c || y < 0 || y >= r) return;
        const idx = cellIndex(x, y);
        const code = typeof ch === 'number' ? ch & 0xff : String(ch).charCodeAt(0) & 0xff;
        chars[idx] = code;
        fgs[idx] = fg;
        bgs[idx] = bg;
        dirty = true;
    }

    function scroll(bg = defaultBg) {
        chars.copyWithin(0, c);
        fgs.copyWithin(0, c);
        bgs.copyWithin(0, c);

        const lastRow = (r - 1) * c;
        chars.fill(32, lastRow);
        fgs.fill(defaultFg, lastRow);
        bgs.fill(bg, lastRow);

        cursorY = r - 1;
        dirty = true;
    }

    function newline(bg = defaultBg) {
        cursorX = 0;
        cursorY++;
        if (cursorY >= r) {
            scroll(bg);
        } else {
            dirty = true;
        }
    }

    return {
        cols: c,
        rows: r,
        chars,
        fgs,
        bgs,
        capture: null,

        get dirty() {
            return dirty;
        },

        markClean() {
            dirty = false;
        },

        invalidate() {
            dirty = true;
        },

        pushKey(key) {
            if (key !== null && key !== undefined) {
                keyQueue.push(key);
            }
        },

        pollKey() {
            return keyQueue.length > 0 ? keyQueue.shift() : null;
        },

        clearKeys() {
            keyQueue.length = 0;
        },

        clear(bg = defaultBg) {
            chars.fill(32);
            fgs.fill(defaultFg);
            bgs.fill(bg);
            cursorX = 0;
            cursorY = 0;
            dirty = true;
        },

        clearToEnd(bg = defaultBg) {
            for (let x = cursorX; x < c; x++) {
                writeCell(x, cursorY, ' ', defaultFg, bg);
            }
        },

        setCursor(x, y) {
            cursorX = Math.max(0, Math.min(c - 1, x | 0));
            cursorY = Math.max(0, Math.min(r - 1, y | 0));
            dirty = true;
        },

        getCursor() {
            return { x: cursorX, y: cursorY, visible: cursorVisible };
        },

        drawCursor(visible) {
            cursorVisible = Boolean(visible);
            dirty = true;
        },

        putChar(ch, fg = defaultFg, bg = defaultBg) {
            if (this.capture !== null) {
                this.capture.push(ch);
                return;
            }

            if (ch === '\r') {
                cursorX = 0;
                dirty = true;
                return;
            }

            if (ch === '\n') {
                newline(bg);
                return;
            }

            if (ch === '\t') {
                this.print('  ', fg, bg);
                return;
            }

            writeCell(cursorX, cursorY, ch, fg, bg);
            cursorX++;

            if (cursorX >= c) {
                newline(bg);
            }
        },

        print(text, fg = defaultFg, bg = defaultBg) {
            const str = String(text);
            if (this.capture !== null) {
                this.capture.push(str);
                return;
            }
            for (let i = 0; i < str.length; i++) {
                this.putChar(str[i], fg, bg);
            }
        },

        println(text = '', fg = defaultFg, bg = defaultBg) {
            this.print(String(text) + '\n', fg, bg);
        },

        backspace(fg = defaultFg, bg = defaultBg) {
            if (cursorX > 0) {
                cursorX--;
            } else if (cursorY > 0) {
                cursorY--;
                cursorX = c - 1;
            }
            writeCell(cursorX, cursorY, ' ', fg, bg);
        },

        async readLine(fg = defaultFg, bg = defaultBg) {
            let buffer = '';
            let frame = 0;

            this.drawCursor(true);

            while (true) {
                let key;
                while ((key = this.pollKey()) !== null) {
                    if (key === 'Enter') {
                        this.drawCursor(false);
                        this.putChar('\n', fg, bg);
                        return buffer;
                    }

                    if (key === 'Backspace') {
                        if (buffer.length > 0) {
                            buffer = buffer.slice(0, -1);
                            this.backspace(fg, bg);
                        }
                    } else if (key.length === 1) {
                        buffer += key;
                        this.putChar(key, fg, bg);
                    }

                    frame = 0;
                    this.drawCursor(true);
                }

                frame++;
                if (frame % 30 === 0) {
                    this.drawCursor(!cursorVisible);
                }

                await OS.nextFrame();
            }
        },
    };
}

const defaultCols = Math.max(1, Math.floor((OS.width || 320) / CELL_W));
const defaultRows = Math.max(1, Math.floor((OS.height || 240) / CELL_H));

OS.createTTY = createTTY;
OS.tty = createTTY(defaultCols, defaultRows);
