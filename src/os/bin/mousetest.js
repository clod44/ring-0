const gfx = OS.gfx;
const w = gfx.width;
const h = gfx.height;
const vram = OS.vram;
const savedVram = new Uint8Array(vram);

function drawCursor(cx, cy, color) {
    gfx.line(cx - 6, cy, cx + 6, cy, color);
    gfx.line(cx, cy - 6, cx, cy + 6, color);
    gfx.rect(cx - 1, cy - 1, 3, 3, 15, true);
}

let lastAction = 'NONE';
let lastButton = 0;
let shouldExit = false;

const hasInputService = Boolean(OS.input && typeof OS.input.pushHandler === 'function');
const releaseInput = hasInputService
    ? OS.input.pushHandler((key) => {
          const k = key && typeof key === 'object' ? key.key : key;
          if (k === 'q' || k === 'Q' || k === 'Escape' || k === 'Enter') {
              shouldExit = true;
          }
      })
    : null;

try {
    while (!shouldExit) {
        if (!hasInputService && typeof OS.pollKey === 'function') {
            const key = OS.pollKey();
            if (key === 'q' || key === 'Q' || key === 'Escape' || key === 'Enter') {
                break;
            }
        }

        let ev;
        while ((ev = OS.pollMouse()) !== null) {
            lastAction = ev.action.toUpperCase();
            lastButton = ev.button;
            if (ev.action === 'down') {
                gfx.circle(ev.x, ev.y, 3, 9, true);
            }
        }

        const mx = OS.mouse ? OS.mouse.x : 0;
        const my = OS.mouse ? OS.mouse.y : 0;
        const buttons = OS.mouse ? OS.mouse.buttons : 0;

        // Top status bar using OS.gfx
        gfx.rect(0, 0, w, 10, 0, true);
        gfx.line(0, 10, w - 1, 10, 8);
        gfx.drawText(
            `XY:${mx},${my} ACT:${lastAction} BTN:${lastButton} MSK:${buttons}`,
            4,
            1,
            10,
            0,
        );

        // Bottom exit hint
        gfx.rect(0, h - 10, w, 10, 0, true);
        gfx.drawText('Q / ESC / ENTER TO EXIT', 4, h - 9, 7, 0);

        // Draw cursor indicator
        drawCursor(mx, my, buttons ? 11 : 14);

        await OS.nextFrame();
    }
} finally {
    if (typeof releaseInput === 'function') {
        releaseInput();
    }
    vram.set(savedVram);
}

return 0;
