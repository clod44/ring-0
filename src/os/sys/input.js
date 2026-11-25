// /sys/input.js — Single hardware key poller & focus/handler router

let focusedTty = OS.tty || null;
const handlerStack = [];
let running = false;

function dispatchKey(key) {
    if (key === null || key === undefined) return;

    try {
        if (handlerStack.length > 0) {
            const top = handlerStack[handlerStack.length - 1];
            if (typeof top === 'function') {
                top(key);
                return;
            }
            if (top && typeof top.pushKey === 'function') {
                top.pushKey(key);
                return;
            }
        }

        if (focusedTty && typeof focusedTty.pushKey === 'function') {
            focusedTty.pushKey(key);
        }
    } catch (err) {
        if (typeof OS.log === 'function') {
            OS.log(`INPUT dispatch error: ${err && err.message ? err.message : String(err)}`);
        }
    }
}

function focus(tty) {
    focusedTty = tty || null;
}

function getFocused() {
    return focusedTty;
}

function pushHandler(handler) {
    if (handler) handlerStack.push(handler);
    return () => popHandler(handler);
}

function popHandler(handler) {
    if (!handlerStack.length) return null;
    if (!handler) return handlerStack.pop();
    const idx = handlerStack.lastIndexOf(handler);
    if (idx !== -1) return handlerStack.splice(idx, 1)[0];
    return null;
}

function setHandler(handler) {
    handlerStack.length = 0;
    if (handler) handlerStack.push(handler);
}

async function loop() {
    if (running) return;
    running = true;
    try {
        while (running) {
            let key;
            while ((key = OS.pollKey()) !== null) {
                dispatchKey(key);
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
    setHandler,
    pushHandler,
    popHandler,
    start: loop,
    stop() {
        running = false;
    },
};

if (!focusedTty && OS.tty) {
    focusedTty = OS.tty;
}
OS.input.start();
