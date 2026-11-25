// /sys/input.js — Routes hardware keys to whichever TTY currently has focus

let focusedTty = OS.tty || null;
let running = false;

function focus(tty) {
    focusedTty = tty || null;
}

function getFocused() {
    return focusedTty;
}

async function loop() {
    if (running) return;
    running = true;
    try {
        while (running) {
            if (focusedTty && typeof focusedTty.pushKey === 'function') {
                let key;
                while ((key = OS.pollKey()) !== null) {
                    focusedTty.pushKey(key);
                }
            }
            await OS.nextFrame();
        }
    } finally {
        running = false;
    }
}

OS.input = {
    focus,
    getFocused,
    start: loop,
    stop() {
        running = false;
    },
};

if (!focusedTty && OS.tty) {
    focusedTty = OS.tty;
}
OS.input.start();
