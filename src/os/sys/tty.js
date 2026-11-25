const DEFAULT_FG = 15;
const DEFAULT_BG = 0;
const CELL_W = 8;
const CELL_H = 8;
const TAB_STOP = 8;

function createTTY(cols, rows, opts = {}) {
    let c = Math.max(1, cols | 0);
    let r = Math.max(1, rows | 0);
    const defaultFg = opts.defaultFg ?? DEFAULT_FG;
    const defaultBg = opts.defaultBg ?? DEFAULT_BG;

    let chars = new Uint8Array(c * r).fill(32);
    let fgs = new Uint8Array(c * r).fill(defaultFg);
    let bgs = new Uint8Array(c * r).fill(defaultBg);

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

    const api = {
        get cols() {
            return c;
        },
        get rows() {
            return r;
        },
        get chars() {
            return chars;
        },
        get fgs() {
            return fgs;
        },
        get bgs() {
            return bgs;
        },
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

        resize(nextCols, nextRows) {
            const nc = Math.max(1, nextCols | 0);
            const nr = Math.max(1, nextRows | 0);
            if (nc === c && nr === r) return;

            const nextChars = new Uint8Array(nc * nr).fill(32);
            const nextFgs = new Uint8Array(nc * nr).fill(defaultFg);
            const nextBgs = new Uint8Array(nc * nr).fill(defaultBg);

            const copyCols = Math.min(c, nc);
            const copyRows = Math.min(r, nr);

            for (let row = 0; row < copyRows; row++) {
                for (let col = 0; col < copyCols; col++) {
                    const sIdx = row * c + col;
                    const dIdx = row * nc + col;
                    nextChars[dIdx] = chars[sIdx];
                    nextFgs[dIdx] = fgs[sIdx];
                    nextBgs[dIdx] = bgs[sIdx];
                }
            }

            c = nc;
            r = nr;
            chars = nextChars;
            fgs = nextFgs;
            bgs = nextBgs;

            cursorX = Math.max(0, Math.min(c - 1, cursorX));
            cursorY = Math.max(0, Math.min(r - 1, cursorY));
            dirty = true;
        },

        pushKey(key) {
            if (typeof key === 'string' && key.length > 0) {
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
                const nextTab = Math.min(c, (Math.floor(cursorX / TAB_STOP) + 1) * TAB_STOP);
                while (cursorX < nextTab) {
                    writeCell(cursorX, cursorY, ' ', fg, bg);
                    cursorX++;
                }
                if (cursorX >= c) {
                    newline(bg);
                }
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
    };

    return api;
}

const defaultCols = Math.max(1, Math.floor((OS.width || 320) / CELL_W));
const defaultRows = Math.max(1, Math.floor((OS.height || 240) / CELL_H));

OS.createTTY = createTTY;
OS.tty = createTTY(defaultCols, defaultRows);
