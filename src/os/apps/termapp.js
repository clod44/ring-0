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

    let tty = typeof OS.createTTY === 'function' ? OS.createTTY(initCols, initRows) : null;

    function wrapTty(rawTty) {
        if (!rawTty) return null;
        const notify = () => {
            win.invalidate();
        };
        return new Proxy(rawTty, {
            get(target, prop, receiver) {
                if (
                    prop === 'cols' ||
                    prop === 'rows' ||
                    prop === 'chars' ||
                    prop === 'fgs' ||
                    prop === 'bgs'
                ) {
                    return target[prop];
                }
                const val = Reflect.get(target, prop, target);
                if (typeof val === 'function') {
                    return function (...args) {
                        const res = val.apply(target, args);
                        if (
                            prop === 'print' ||
                            prop === 'println' ||
                            prop === 'putChar' ||
                            prop === 'backspace' ||
                            prop === 'clear' ||
                            prop === 'clearToEnd' ||
                            prop === 'setCursor' ||
                            prop === 'drawCursor' ||
                            prop === 'invalidate'
                        ) {
                            notify();
                        }
                        return res;
                    };
                }
                return val;
            },
        });
    }

    if (tty) {
        tty = wrapTty(tty);
    }

    function syncTtySize(w) {
        const nextCols = Math.max(10, Math.floor(w.w / cellW));
        const nextRows = Math.max(3, Math.floor(w.h / cellH));
        if (!tty) return;

        if (nextCols !== tty.cols || nextRows !== tty.rows) {
            const prev = tty;
            const prevCur =
                typeof prev.getCursor === 'function' ? prev.getCursor() : { x: 0, y: 0 };
            const fresh = OS.createTTY(nextCols, nextRows);

            if (prev && prev.chars) {
                const copyRows = Math.min(prev.rows, fresh.rows);
                const copyCols = Math.min(prev.cols, fresh.cols);
                const rowOffset = Math.max(0, prev.rows - copyRows);
                for (let y = 0; y < copyRows; y++) {
                    for (let x = 0; x < copyCols; x++) {
                        const sIdx = (y + rowOffset) * prev.cols + x;
                        const dIdx = y * fresh.cols + x;
                        fresh.chars[dIdx] = prev.chars[sIdx];
                        fresh.fgs[dIdx] = prev.fgs[sIdx];
                        fresh.bgs[dIdx] = prev.bgs[sIdx];
                    }
                }
            }

            const clampedX = Math.max(0, Math.min(nextCols - 1, prevCur.x || 0));
            const clampedY = Math.max(0, Math.min(nextRows - 1, prevCur.y || 0));
            if (typeof fresh.setCursor === 'function') {
                fresh.setCursor(clampedX, clampedY);
            }
            if (typeof fresh.drawCursor === 'function' && prevCur.visible !== undefined) {
                fresh.drawCursor(prevCur.visible);
            }

            tty = wrapTty(fresh);
        }
    }

    async function startShell() {
        if (!tty) return;
        if (!OS.fs || typeof OS.fs.exists !== 'function' || !OS.fs.exists('/bin/shell.js')) {
            tty.println('Missing /bin/shell.js', 9);
            win.invalidate();
            return;
        }
        try {
            await OS.exec('/bin/shell.js', [], OS.env || {}, tty);
        } catch (err) {
            if (tty && typeof tty.println === 'function') {
                tty.println(`SHELL EXIT: ${formatErr(err)}`, 9);
            }
            win.invalidate();
        }
    }

    return {
        init() {
            startShell();
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

        render(w) {
            syncTtySize(w);
            OS.gfx.clear(0);
            OS.gfx.rect(0, 0, w.w, w.h, 0, true);

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
            if (cur && cur.visible) {
                OS.gfx.drawText('_', cur.x * cellW, cur.y * cellH, 15, -1);
            }

            if (tty.dirty && typeof tty.markClean === 'function') {
                tty.markClean();
            }
        },
    };
}

module.exports = { createApp };
