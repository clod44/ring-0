function createTerminalRenderer(tty, opts = {}) {
    const cellW = opts.cellW || 8;
    const cellH = opts.cellH || 8;
    const target = opts.target || null;

    function renderAll() {
        const { cols, rows, chars, fgs, bgs } = tty;
        const cur = tty.getCursor();

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
        if (!tty.dirty) return;
        if (target) {
            OS.gfx.withTarget(target, renderAll);
        } else {
            renderAll();
        }
        tty.markClean();
    }

    return { render };
}

async function start(tty = OS.tty, opts = {}) {
    const renderer = createTerminalRenderer(tty, opts);
    tty.invalidate();

    while (true) {
        renderer.render();
        await OS.nextFrame();
    }
}

OS.term = {
    createRenderer: createTerminalRenderer,
    start,
};
