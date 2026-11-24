const { COLOR, parseArgs, error, usage } = OS.require('/lib/cli.js');

const { has, positional } = parseArgs(args);
const ignoreCase = has('i');
const showLineNum = has('n');

if (positional.length === 0 || (positional.length === 1 && OS.stdin === null)) {
    return usage('grep [-in] <pattern> [file...]');
}

const [pattern, ...files] = positional;
const needle = ignoreCase ? pattern.toLowerCase() : pattern;
const multiFile = files.length > 1;

let foundAny = false;
let hadError = false;

function printHighlighted(line) {
    if (pattern.length === 0) {
        OS.tty.println(line, COLOR.text);
        return;
    }

    const hay = ignoreCase ? line.toLowerCase() : line;
    let pos = 0;

    while (pos < line.length) {
        const idx = hay.indexOf(needle, pos);
        if (idx === -1) {
            OS.tty.print(line.slice(pos), COLOR.text);
            break;
        }
        if (idx > pos) {
            OS.tty.print(line.slice(pos, idx), COLOR.text);
        }
        OS.tty.print(line.slice(idx, idx + pattern.length), COLOR.error);
        pos = idx + pattern.length;
    }

    OS.tty.println('');
}

function searchLines(lines, label = null) {
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const hay = ignoreCase ? line.toLowerCase() : line;

        if (hay.includes(needle)) {
            foundAny = true;
            if (label) OS.tty.print(`${label}:`, COLOR.info);
            if (showLineNum) OS.tty.print(`${i + 1}:`, COLOR.ok);
            printHighlighted(line);
        }
    }
}

if (files.length === 0) {
    const input = OS.stdin.endsWith('\n') ? OS.stdin.slice(0, -1) : OS.stdin;
    searchLines(input.split('\n'));
} else {
    for (const arg of files) {
        const path = OS.resolvePath(arg);

        if (!OS.fs.exists(path)) {
            error('grep', `${path}: No such file`);
            hadError = true;
            continue;
        }

        if (OS.fs.isDir(path)) {
            error('grep', `${path}: Is a directory`);
            hadError = true;
            continue;
        }

        searchLines(OS.fs.read(path).split('\n'), multiFile ? path : null);
    }
}

return hadError || !foundAny ? 1 : 0;
