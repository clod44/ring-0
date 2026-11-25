function formatErr(err) {
    if (!err) return 'Unknown error';
    if (typeof err === 'string') return err;
    return err.message || String(err);
}

function createApp(win, api) {
    const cellW = 8;
    const cellH = 8;

    let cols = Math.max(10, Math.floor(win.w / cellW));
    let rows = Math.max(4, Math.floor(win.h / cellH));
    let cwd = OS.cwd || '/';

    let rawLines = [];
    let inputBuf = '';
    let history = [];
    let histIdx = -1;
    let busy = false;

    const prompt = () => `${cwd}> `;

    function resolveLocalPath(p) {
        if (!p) return cwd;
        if (p.startsWith('/')) {
            return typeof OS.resolvePath === 'function' ? OS.resolvePath(p) : p;
        }
        const joined = `${cwd === '/' ? '' : cwd}/${p}`;
        return typeof OS.resolvePath === 'function' ? OS.resolvePath(joined) : joined;
    }

    function sanitizeTermText(input) {
        return String(input ?? '')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '')
            .replace(/\t/g, '  ')
            .replace(/[^\n\x20-\x7e]/g, '?');
    }

    function pushLine(text, fg = 15) {
        const str = sanitizeTermText(text);
        for (const part of str.split('\n')) {
            rawLines.push({ text: part, fg });
        }
        if (rawLines.length > 200) {
            rawLines = rawLines.slice(rawLines.length - 200);
        }
        win.invalidate();
    }

    function wrapForCols(widthCols) {
        const wCols = Math.max(8, widthCols);
        const wrapped = [];
        for (const item of rawLines) {
            const s = item.text;
            if (!s.length) {
                wrapped.push({ text: '', fg: item.fg });
                continue;
            }
            for (let i = 0; i < s.length; i += wCols) {
                wrapped.push({ text: s.slice(i, i + wCols), fg: item.fg });
            }
        }
        return wrapped;
    }

    function clearScreen() {
        rawLines = [];
        win.invalidate();
    }

    function makeWindowTty() {
        return {
            cols,
            rows,
            println(msg, fg = 15) {
                pushLine(msg, fg);
            },
            print(msg, fg = 15) {
                const str = sanitizeTermText(msg);
                if (!str) return;
                const parts = str.split('\n');
                if (rawLines.length === 0) {
                    rawLines.push({ text: parts[0], fg });
                } else {
                    rawLines[rawLines.length - 1].text += parts[0];
                }
                for (let i = 1; i < parts.length; i++) {
                    rawLines.push({ text: parts[i], fg });
                }
                if (rawLines.length > 200) {
                    rawLines = rawLines.slice(rawLines.length - 200);
                }
                win.invalidate();
            },
            clear() {
                clearScreen();
            },
            invalidate() {
                win.invalidate();
            },
        };
    }

    function tokenize(line) {
        return line.trim().split(/\s+/).filter(Boolean);
    }

    async function runCommand(rawLine) {
        const trimmed = rawLine.trim();
        if (!trimmed) return;

        history.push(trimmed);
        histIdx = history.length;

        const [cmd, ...cmdArgs] = tokenize(trimmed);
        if (!cmd) return;

        if (cmd === 'clear') {
            clearScreen();
            return;
        }
        if (cmd === 'help') {
            pushLine('Builtins: help, clear, echo, pwd, cd, ls', 11);
            pushLine('Or run any script in /bin/<name>.js', 7);
            return;
        }
        if (cmd === 'echo') {
            pushLine(cmdArgs.join(' '), 15);
            return;
        }
        if (cmd === 'pwd') {
            pushLine(cwd, 14);
            return;
        }
        if (cmd === 'cd') {
            const target = resolveLocalPath(cmdArgs[0] || '/');
            if (OS.fs && typeof OS.fs.isDir === 'function' && OS.fs.isDir(target)) {
                cwd = target;
                pushLine(cwd, 14);
            } else {
                pushLine(`cd: not a directory: ${target}`, 9);
            }
            return;
        }
        if (cmd === 'ls') {
            if (OS.fs && typeof OS.fs.listDir === 'function') {
                const target = resolveLocalPath(cmdArgs[0] || '.');
                const entries = OS.fs.listDir(target);
                pushLine(
                    entries.map((e) => (e.type === 'dir' ? `${e.name}/` : e.name)).join('  ') ||
                        '(empty)',
                    15,
                );
            }
            return;
        }

        const binPath = cmd.startsWith('/') ? cmd : `/bin/${cmd}.js`;
        if (OS.fs && typeof OS.fs.exists === 'function' && OS.fs.exists(binPath)) {
            busy = true;
            win.invalidate();
            try {
                await OS.exec(binPath, cmdArgs, OS.env || {}, makeWindowTty());
            } catch (err) {
                pushLine(`ERR: ${formatErr(err)}`, 9);
            } finally {
                busy = false;
                win.invalidate();
            }
            return;
        }

        pushLine(`termapp: command not found: ${cmd}`, 9);
    }

    return {
        init() {
            pushLine('TERMAPP READY (type "help")', 10);
        },

        onKey(key) {
            if (busy) return true;

            const k = key && typeof key === 'object' ? key.key : key;
            if (typeof k !== 'string') return false;

            if (k === 'Enter') {
                const line = inputBuf;
                inputBuf = '';
                pushLine(prompt() + line, 14);
                runCommand(line);
                return true;
            }
            if (k === 'Backspace') {
                if (inputBuf.length > 0) {
                    inputBuf = inputBuf.slice(0, -1);
                    win.invalidate();
                }
                return true;
            }
            if (k === 'ArrowUp') {
                if (history.length > 0 && histIdx > 0) {
                    histIdx--;
                    inputBuf = history[histIdx];
                    win.invalidate();
                }
                return true;
            }
            if (k === 'ArrowDown') {
                if (history.length > 0 && histIdx < history.length - 1) {
                    histIdx++;
                    inputBuf = history[histIdx];
                } else {
                    histIdx = history.length;
                    inputBuf = '';
                }
                win.invalidate();
                return true;
            }
            if (k.length === 1 && k >= ' ') {
                inputBuf += k;
                win.invalidate();
                return true;
            }

            return false;
        },

        render(w) {
            cols = Math.max(10, Math.floor(w.w / cellW));
            rows = Math.max(3, Math.floor(w.h / cellH));

            OS.gfx.clear(0);

            const wrappedLines = wrapForCols(cols);
            const promptStr = busy ? '[running...]' : `${prompt()}${inputBuf}_`;
            const promptLines = Math.max(1, Math.ceil(promptStr.length / cols));
            const visibleHistoryRows = Math.max(0, rows - promptLines);
            const startIdx = Math.max(0, wrappedLines.length - visibleHistoryRows);

            let y = 0;
            for (let i = startIdx; i < wrappedLines.length && y < visibleHistoryRows; i++) {
                OS.gfx.drawText(wrappedLines[i].text, 0, y * cellH, wrappedLines[i].fg, 0);
                y++;
            }

            for (let p = 0; p < promptLines && y < rows; p++) {
                const chunk = promptStr.slice(p * cols, (p + 1) * cols);
                OS.gfx.drawText(chunk, 0, y * cellH, busy ? 11 : 15, 0);
                y++;
            }
        },
    };
}

module.exports = { createApp };
