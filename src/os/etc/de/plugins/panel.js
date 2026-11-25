const BAR_H = 11;
const BAR_BG = 0;
const BAR_BORDER = 8;
const BAR_FG = 15;

let chips = [];
let fps = 0;
let frameCount = 0;
let elapsed = 0;

function restoreWindow(win) {
    if (!win) return;
    if (win.minimized) {
        win.toggleMinimize();
    } else {
        DE.focusWindow(win);
    }
}

module.exports = {
    id: 'top-panel',
    layer: 'panel',
    order: 5,

    init() {
        DE.setStrut('panel', { top: BAR_H });
    },

    update(dt) {
        frameCount++;
        elapsed += dt;
        if (elapsed >= 0.5) {
            fps = Math.round(frameCount / elapsed);
            frameCount = 0;
            elapsed = 0;
        }
    },

    render(gfx) {
        const w = gfx.width;
        gfx.rect(0, 0, w, BAR_H, BAR_BG, true);
        gfx.line(0, BAR_H, w - 1, BAR_H, BAR_BORDER);

        chips = [];
        let x = 4;

        const wins = DE.getWindows();
        for (const win of wins) {
            if (!win.minimized) continue;
            const rawTitle = String(win.title || 'WIN').slice(0, 7);
            const label = `[${rawTitle}]`;
            const chipW = label.length * 8 + 4;
            if (x + chipW >= w - 4) break;

            gfx.rect(x, 1, chipW, BAR_H - 2, 1, true);
            gfx.rect(x, 1, chipW, BAR_H - 2, 11, false);
            gfx.drawText(label, x + 2, 2, 15, -1);

            chips.push({
                win,
                x0: x,
                x1: x + chipW,
                y0: 0,
                y1: BAR_H,
            });
            x += chipW + 4;
        }

        const activeCount = wins.filter((win) => !win.minimized).length;
        const status = DE.isDebugHud()
            ? `DBG W:${activeCount}/${wins.length} FPS:${fps}`
            : `RING-0 DE | WIN:${activeCount} | ESC:EXIT`;

        const availW = Math.max(0, w - x - 4);
        if (availW >= 16) {
            const maxChars = Math.floor(availW / 8);
            gfx.drawText(status.slice(0, maxChars), x, 2, BAR_FG, -1);
        }
    },

    onMouse(ev) {
        if (ev.action !== 'down') return false;
        if (ev.y < 0 || ev.y > BAR_H) return false;

        for (const chip of chips) {
            if (ev.x >= chip.x0 && ev.x <= chip.x1 && ev.y >= chip.y0 && ev.y <= chip.y1) {
                restoreWindow(chip.win);
                return true;
            }
        }

        // Consume clicks on the bar so they don't fall through to windows/icons underneath
        return true;
    },

    destroy() {
        DE.removeStrut('panel');
    },
};
