// Normal top-level code — no createApp() wrapper!
const win = env.win;
const dots = [];

while (!win.closed) {
    let ev;
    while ((ev = win.pollMouse()) !== null) {
        if (ev.action === 'down' || (ev.action === 'move' && ev.buttons)) {
            dots.push({ x: ev.x, y: ev.y });
        }
    }

    win.draw(() => {
        OS.gfx.clear(0);
        for (const d of dots) OS.gfx.rect(d.x, d.y, 2, 2, 14, true);
    });

    await OS.nextFrame();
}
