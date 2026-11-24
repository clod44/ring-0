// Shared CLI utilities (similar to libc / getopt)

const COLOR = {
    error: 9, // Bright Red
    ok: 10, // Bright Green
    warn: 11, // Yellow
    info: 14, // Cyan
    text: 15, // White
    dim: 8, // Gray
};

function parseArgs(args = []) {
    const flags = new Set();
    const positional = [];
    let stopFlags = false;

    for (const arg of args) {
        if (stopFlags) {
            positional.push(arg);
            continue;
        }

        if (arg === '--') {
            stopFlags = true;
        } else if (arg.startsWith('--') && arg.length > 2) {
            flags.add(arg.slice(2));
        } else if (arg.startsWith('-') && arg.length > 1) {
            for (let i = 1; i < arg.length; i++) {
                flags.add(arg[i]);
            }
        } else {
            positional.push(arg);
        }
    }

    return {
        flags,
        positional,
        has: (...names) => names.some((n) => flags.has(n)),
    };
}

function error(cmd, msg) {
    OS.tty.println(`${cmd}: ${msg}`, COLOR.error);
    return 1;
}

function usage(text) {
    OS.tty.println(`Usage: ${text}`, COLOR.warn);
    return 1;
}

function formatBytes(bytes, human = true) {
    if (!human) return Math.ceil(bytes / 1024) + 'K';
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'M';
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + 'K';
    return bytes + 'B';
}

module.exports = { COLOR, parseArgs, error, usage, formatBytes };
