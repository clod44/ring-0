function createTerminalRenderer(tty, opts = {}) {
    const dev = tty || OS.tty;
    const cellW = opts.cellW || 8;
    const cellH = opts.cellH || 8;
    const target = opts.target || null;

    function renderAll() {
        const { cols, rows, chars, fgs, bgs } = dev;
        const cur = dev.getCursor();

        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const idx = y * cols + x;
                const ch = String.fromCharCode(chars[idx]);
                const fg = fgs[idx];
                const bg = bgs[idx];
                const isCursor = cur.visible && x === cur.x && y === cur.y;

                OS.gfx.drawChar(ch, x * cellW, y * cellH, isCursor ? bg : fg, isCursor ? fg : bg);
            }
        }
    }

    function render() {
        if (!dev.dirty) return;
        if (target) {
            OS.gfx.withTarget(target, renderAll);
        } else {
            renderAll();
        }
        dev.markClean();
    }

    return { render };
}

async function start(tty, opts = {}) {
    const dev = tty || OS.tty;
    const renderer = createTerminalRenderer(dev, opts);
    dev.invalidate();

    while (true) {
        try {
            renderer.render();
        } catch (err) {
            if (OS && typeof OS.log === 'function') {
                OS.log('TERM_ERR: ' + (err && err.message ? err.message : err));
            }
        }
        await OS.nextFrame();
    }
}

OS.term = {
    createRenderer: createTerminalRenderer,
    start,
};
