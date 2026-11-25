function formatErr(err) {
    if (!err) return 'Unknown error';
    if (typeof err === 'string') return err;
    return err.message || String(err);
}

function createApp(win) {
    const cellW = 8;
    const cellH = 8;

    const initCols = Math.max(10, Math.floor(win.w / cellW));
    const initRows = Math.max(3, Math.floor(win.h / cellH));

    const tty = typeof OS.createTTY === 'function' ? OS.createTTY(initCols, initRows) : null;
    let shellStarted = false;

    function syncTtySize(w) {
        if (!tty) return;
        const target = w || win;
        const nextCols = Math.max(10, Math.floor(target.w / cellW));
        const nextRows = Math.max(3, Math.floor(target.h / cellH));

        if (nextCols !== tty.cols || nextRows !== tty.rows) {
            if (typeof tty.resize === 'function') {
                tty.resize(nextCols, nextRows);
            }
            win.invalidate();
        }
    }

    async function startShell() {
        if (!tty || shellStarted) return;
        shellStarted = true;

        if (!OS.fs || typeof OS.fs.exists !== 'function' || !OS.fs.exists('/bin/shell.js')) {
            tty.println('Missing /bin/shell.js', 9);
            win.invalidate();
            return;
        }
        try {
            await OS.exec('/bin/shell.js', [], OS.env || {}, tty);
        } catch (err) {
            if (typeof tty.println === 'function') {
                tty.println(`SHELL EXIT: ${formatErr(err)}`, 9);
            }
            win.invalidate();
        }
    }

    return {
        init() {
            startShell();
        },

        onResize(w) {
            syncTtySize(w);
        },

        onKey(key) {
            if (!tty || typeof tty.pushKey !== 'function') return false;
            const k = key && typeof key === 'object' ? key.key : key;
            if (typeof k !== 'string' || !k.length) return false;
            tty.pushKey(k);
            win.invalidate();
            return true;
        },

        destroy() {
            if (tty && typeof tty.clearKeys === 'function') {
                tty.clearKeys();
            }
        },

        update() {
            if (tty && tty.dirty) {
                win.invalidate();
            }
        },

        render(w) {
            const target = w || win;
            syncTtySize(target);

            OS.gfx.clear(0);
            OS.gfx.rect(0, 0, target.w, target.h, 0, true);

            if (!tty || !tty.chars) return;

            for (let y = 0; y < tty.rows; y++) {
                for (let x = 0; x < tty.cols; x++) {
                    const idx = y * tty.cols + x;
                    const code = tty.chars[idx];
                    const fg = tty.fgs[idx];
                    const bg = tty.bgs[idx];
                    const ch = code >= 32 && code <= 126 ? String.fromCharCode(code) : ' ';
                    OS.gfx.drawChar(ch, x * cellW, y * cellH, fg, bg);
                }
            }

            const cur = typeof tty.getCursor === 'function' ? tty.getCursor() : null;
            if (
                cur &&
                cur.visible &&
                cur.x >= 0 &&
                cur.x < tty.cols &&
                cur.y >= 0 &&
                cur.y < tty.rows
            ) {
                OS.gfx.drawChar('_', cur.x * cellW, cur.y * cellH, 15, -1);
            }

            if (tty.dirty && typeof tty.markClean === 'function') {
                tty.markClean();
            }
        },
    };
}

module.exports = { createApp };
