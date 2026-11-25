const gfx = OS.gfx;
const vram = OS.vram;
const physW = OS.width;
const physH = OS.height;

// Snapshot the screen on entry so we can restore cleanly on exit
const screenBackup = new Uint8Array(vram);

// App owns its own offscreen buffer (sized in logical gfx units)
const bufW = 180;
const bufH = 110;
const appBuf = gfx.createBuffer(bufW, bufH, gfx.scale);

let winX = Math.max(8, Math.floor((gfx.width - bufW) / 2));
let winY = Math.max(16, Math.floor((gfx.height - bufH) / 2));
let clicks = 0;
let dragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let dirty = true;

function renderAppBuffer() {
    gfx.withTarget(appBuf, () => {
        const w = gfx.width;
        const h = gfx.height;

        // Window body & border
        gfx.clear(1); // Navy
        gfx.rect(0, 0, w, h, 15, false);

        // Title bar
        gfx.rect(1, 1, w - 2, 12, dragging ? 14 : 4, true);
        gfx.line(0, 13, w - 1, 13, 15);
        gfx.drawText('BUF DEMO APP', 6, 3, 15, -1);

        // Content inside appBuf
        gfx.drawText(`BUF: ${w}x${h}`, 8, 22, 10, 1);
        gfx.drawText(`POS: ${winX},${winY}`, 8, 34, 15, 1);
        gfx.drawText(`CLICKS: ${clicks}`, 8, 46, 11, 1);
        gfx.drawText('DRAG TITLE / ARROWS', 8, 66, 7, 1);
        gfx.drawText('Q OR ESC TO EXIT', 8, 78, 7, 1);

        // Interactive badge inside buffer
        gfx.circle(w - 22, h - 22, 10, clicks % 2 === 0 ? 10 : 9, true);
    });
    dirty = false;
}

function drawCursor(cx, cy) {
    gfx.line(cx - 5, cy, cx + 5, cy, 11);
    gfx.line(cx, cy - 5, cx, cy + 5, 11);
    gfx.rect(cx - 1, cy - 1, 3, 3, 15, true);
}

while (true) {
    const key = OS.pollKey();
    if (key === 'q' || key === 'Q' || key === 'Escape') {
        break;
    }

    const step = 4;
    if (key === 'ArrowLeft' || key === 'a') {
        winX -= step;
        dirty = true;
    }
    if (key === 'ArrowRight' || key === 'd') {
        winX += step;
        dirty = true;
    }
    if (key === 'ArrowUp' || key === 'w') {
        winY -= step;
        dirty = true;
    }
    if (key === 'ArrowDown' || key === 's') {
        winY += step;
        dirty = true;
    }

    let ev;
    while ((ev = OS.pollMouse()) !== null) {
        const mx = Math.floor(ev.x / gfx.scale);
        const my = Math.floor(ev.y / gfx.scale);

        if (ev.action === 'down') {
            // Check title bar hit for dragging
            if (mx >= winX && mx < winX + bufW && my >= winY && my < winY + 13) {
                dragging = true;
                dragOffsetX = mx - winX;
                dragOffsetY = my - winY;
                dirty = true;
            } else if (mx >= winX && mx < winX + bufW && my >= winY && my < winY + bufH) {
                clicks++;
                dirty = true;
            }
        } else if (ev.action === 'move') {
            if (dragging) {
                winX = mx - dragOffsetX;
                winY = my - dragOffsetY;
                dirty = true;
            }
        } else if (ev.action === 'up') {
            if (dragging) {
                dragging = false;
                dirty = true;
            }
        }
    }

    if (dirty) {
        renderAppBuffer();
    }

    // Restore clean background each frame, then blit the app's buffer
    vram.set(screenBackup);
    gfx.blit(appBuf, winX * gfx.scale, winY * gfx.scale, vram, physW, physH);

    // Draw cursor on top of VRAM
    if (OS.mouse) {
        const curX = Math.floor(OS.mouse.x / gfx.scale);
        const curY = Math.floor(OS.mouse.y / gfx.scale);
        drawCursor(curX, curY);
    }

    await OS.nextFrame();
}

// Restore screen before returning to shell
vram.set(screenBackup);
return 0;
