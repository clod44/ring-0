const COLS = Math.floor(OS.width / 8); // 40 columns
const ROWS = Math.floor(OS.height / 8); // 30 rows
const CELLS = COLS * ROWS;

const DEFAULT_FG = 15; // White
const DEFAULT_BG = 0; // Black

// VGA-style text-mode screen buffer (1 byte per attribute, per cell)
const chars = new Uint8Array(CELLS).fill(32); // ASCII 32 = ' '
const fgs = new Uint8Array(CELLS).fill(DEFAULT_FG);
const bgs = new Uint8Array(CELLS).fill(DEFAULT_BG);

let cursorX = 0;
let cursorY = 0;

function cellIndex(x, y) {
    return y * COLS + x;
}

function renderCell(x, y, invert = false) {
    const idx = cellIndex(x, y);
    const ch = String.fromCharCode(chars[idx]);
    const fg = fgs[idx];
    const bg = bgs[idx];
    OS.gfx.drawChar(ch, x * 8, y * 8, invert ? bg : fg, invert ? fg : bg);
}

function writeCell(x, y, ch, fg, bg) {
    const idx = cellIndex(x, y);
    chars[idx] = ch.charCodeAt(0) & 0xff;
    fgs[idx] = fg;
    bgs[idx] = bg;
    OS.gfx.drawChar(ch, x * 8, y * 8, fg, bg);
}

function scroll(bg = DEFAULT_BG) {
    // Shift cell buffer up by 1 row
    chars.copyWithin(0, COLS);
    fgs.copyWithin(0, COLS);
    bgs.copyWithin(0, COLS);

    const lastRow = (ROWS - 1) * COLS;
    chars.fill(32, lastRow);
    fgs.fill(DEFAULT_FG, lastRow);
    bgs.fill(bg, lastRow);

    // Shift VRAM up by 8 pixel rows
    const rowBytes = OS.width * 8;
    OS.vram.copyWithin(0, rowBytes);
    OS.vram.fill(bg, OS.vram.length - rowBytes);

    cursorY = ROWS - 1;
}

function newline(bg = DEFAULT_BG) {
    cursorX = 0;
    cursorY++;
    if (cursorY >= ROWS) {
        scroll(bg);
    }
}

const tty = {
    cols: COLS,
    rows: ROWS,
    capture: null, // When set to an array, stdout is captured instead of drawn

    clear(bg = DEFAULT_BG) {
        chars.fill(32);
        fgs.fill(DEFAULT_FG);
        bgs.fill(bg);
        OS.gfx.clear(bg);
        cursorX = 0;
        cursorY = 0;
    },

    clearToEnd(bg = DEFAULT_BG) {
        for (let x = cursorX; x < COLS; x++) {
            writeCell(x, cursorY, ' ', DEFAULT_FG, bg);
        }
    },

    setCursor(x, y) {
        cursorX = Math.max(0, Math.min(COLS - 1, x | 0));
        cursorY = Math.max(0, Math.min(ROWS - 1, y | 0));
    },

    getCursor() {
        return { x: cursorX, y: cursorY };
    },

    drawCursor(visible) {
        renderCell(cursorX, cursorY, visible);
    },

    putChar(ch, fg = DEFAULT_FG, bg = DEFAULT_BG) {
        if (this.capture !== null) {
            this.capture.push(ch);
            return;
        }

        if (ch === '\r') {
            cursorX = 0;
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

        if (cursorX >= COLS) {
            newline(bg);
        }
    },

    print(text, fg = DEFAULT_FG, bg = DEFAULT_BG) {
        const str = String(text);
        if (this.capture !== null) {
            this.capture.push(str);
            return;
        }
        for (let i = 0; i < str.length; i++) {
            this.putChar(str[i], fg, bg);
        }
    },

    println(text = '', fg = DEFAULT_FG, bg = DEFAULT_BG) {
        this.print(text + '\n', fg, bg);
    },

    backspace(fg = DEFAULT_FG, bg = DEFAULT_BG) {
        if (cursorX > 0) {
            cursorX--;
        } else if (cursorY > 0) {
            cursorY--;
            cursorX = COLS - 1;
        }
        writeCell(cursorX, cursorY, ' ', fg, bg);
    },

    async readLine(fg = DEFAULT_FG, bg = DEFAULT_BG) {
        let buffer = '';
        let frame = 0;
        let cursorVisible = true;

        this.drawCursor(true);

        while (true) {
            let key;
            while ((key = OS.pollKey()) !== null) {
                this.drawCursor(false);

                if (key === 'Enter') {
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
                cursorVisible = true;
                this.drawCursor(true);
            }

            frame++;
            if (frame % 30 === 0) {
                cursorVisible = !cursorVisible;
                this.drawCursor(cursorVisible);
            }

            await OS.nextFrame();
        }
    },
};

OS.tty = tty;
