import {
    SCREEN_HEIGHT,
    SCREEN_WIDTH,
    SECTOR_SIZE,
    VRAM_SIZE,
} from "../hw/config.ts";

export interface MouseEventItem {
    action: "down" | "move" | "up";
    x: number;
    y: number;
    button: number;
    buttons: number;
}

let disk: Uint8Array | null = null;
const vram = new Uint8Array(VRAM_SIZE);
const keyQueue: string[] = [];
const mouseQueue: MouseEventItem[] = [];
const mouseState = {
    x: 0,
    y: 0,
    button: 0,
    buttons: 0,
};
let clockId: number | null = null;

const decoder = new TextDecoder();

// The Hardware Interface exposed to Sector 0 (and passed down to the Kernel)
const HW = {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    sectorSize: SECTOR_SIZE,
    vram,
    mouse: mouseState,

    readSectors(startSector: number, count = 1): Uint8Array {
        if (!disk) return new Uint8Array(count * SECTOR_SIZE);
        const offset = startSector * SECTOR_SIZE;
        return disk.slice(offset, offset + count * SECTOR_SIZE);
    },

    writeSectors(startSector: number, data: Uint8Array): void {
        if (!disk) return;
        disk.set(data, startSector * SECTOR_SIZE);
    },

    pollKey(): string | null {
        return keyQueue.shift() ?? null;
    },

    pollMouse(): MouseEventItem | null {
        return mouseQueue.shift() ?? null;
    },

    // The OS Kernel hooks into this 60Hz hardware interrupt
    onTick: null as (() => void) | null,

    log(...args: unknown[]) {
        console.log("[RING-0]", ...args);
    },

    reboot() {
        self.postMessage({ type: "REBOOT", disk: disk });
    },
};

function startClock() {
    if (clockId !== null) clearInterval(clockId);

    clockId = self.setInterval(() => {
        try {
            if (typeof HW.onTick === "function") {
                HW.onTick();
            }
        } catch (err) {
            console.error("[BIOS] Hardware Interrupt Fault:", err);
            HW.onTick = null;
        }

        // Send a snapshot of VRAM to the main thread to paint on the canvas
        self.postMessage({ type: "FRAME", vram });
    }, 1000 / 60);
}

function bootFromSectorZero() {
    // 1. Blindly read Sector 0 (bytes 0..511)
    const sector0 = HW.readSectors(0, 1);
    const mbrCode = decoder.decode(sector0).replace(/\0+$/, "");

    if (!mbrCode.trim()) {
        HW.log("BIOS: Sector 0 is empty. Halting.");
        return;
    }

    // 2. Execute Sector 0 in a shadowed sandbox (no fetch, self, indexedDB, etc.)
    try {
        const runMBR = new Function(
            "HW",
            "self",
            "globalThis",
            "fetch",
            "importScripts",
            "indexedDB",
            `"use strict";\n${mbrCode}`,
        );

        runMBR(HW, undefined, undefined, undefined, undefined, undefined);
    } catch (err) {
        console.error("[BIOS] Bootloader Fault:", err);
    }
}

// Listen for power-on, keyboard, and mouse events from the main thread
self.onmessage = (e: MessageEvent) => {
    const msg = e.data;

    if (msg.type === "BOOT") {
        disk = msg.disk;
        vram.fill(0);
        keyQueue.length = 0;
        mouseQueue.length = 0;
        mouseState.x = 0;
        mouseState.y = 0;
        mouseState.button = 0;
        mouseState.buttons = 0;

        bootFromSectorZero();
        startClock();
    } else if (msg.type === "KEY") {
        keyQueue.push(msg.key);
    } else if (msg.type === "MOUSE") {
        mouseState.x = msg.x;
        mouseState.y = msg.y;
        mouseState.button = msg.button;
        mouseState.buttons = msg.buttons;
        mouseQueue.push({
            action: msg.action,
            x: msg.x,
            y: msg.y,
            button: msg.button,
            buttons: msg.buttons,
        });
    } else if (msg.type === "GET_DISK") {
        self.postMessage({ type: "DISK_SNAPSHOT", disk: disk });
    } else if (msg.type === "REQUEST_REBOOT") {
        self.postMessage({ type: "REBOOT", disk: disk });
    }
};

// Expose all logs
function forwardLog(level: string, args: unknown[]) {
    const line = args.map((
        a,
    ) => (typeof a === "object" && a !== null ? JSON.stringify(a) : String(a)))
        .join(" ");
    self.postMessage({ type: "CONSOLE", text: `[${level}] ${line}` });
}

for (const lvl of ["log", "warn", "error"] as const) {
    const orig = console[lvl].bind(console);
    console[lvl] = (...args) => {
        orig(...args);
        forwardLog(lvl.toUpperCase(), args);
    };
}
self.addEventListener("error", (e) => forwardLog("ERR", [e.message]));
