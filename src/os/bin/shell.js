const { createHistory, readLine } = OS.require('/lib/readline.js');

const io = (typeof tty !== 'undefined' && tty) || OS.tty;
env = env || (OS.env ??= {});

const THEME = {
    bg: 0,
    banner: 10,
    prompt: 214,
    input: 15,
    text: 15,
    dim: 8,
    warn: 11,
    error: 9,
};

if (!env.PATH) env.PATH = '/bin:/usr/bin';
if (!env.HISTFILE) env.HISTFILE = '/tmp/history';
env['?'] = '0';

function warn(msg) {
    try {
        if (io && typeof io.println === 'function') {
            io.println(`WARN: ${msg}`, THEME.warn);
        }
        if (typeof OS.log === 'function') {
            OS.log(`SHELL WARN: ${msg}`);
        }
    } catch (_) {}
}

function reportError(msg, err = null) {
    const detail = err && err.message ? `${msg}: ${err.message}` : msg;
    try {
        if (io && typeof io.println === 'function') {
            io.println(detail, THEME.error);
        }
        if (typeof OS.log === 'function') {
            OS.log(`SHELL ERR: ${err && err.stack ? err.stack : detail}`);
        }
    } catch (_) {}
}

function initHistory(filePath, limit = 100) {
    try {
        if (typeof createHistory === 'function') {
            return createHistory(filePath, limit);
        }
    } catch (err) {
        warn(`History unavailable (${err.message}); using memory only`);
    }
    const items = [];
    return {
        items,
        add(line) {
            if (!line || items[items.length - 1] === line) return;
            items.push(line);
            if (items.length > limit) items.shift();
        },
    };
}

const history = initHistory(env.HISTFILE, 100);

const BUILTINS = {
    export(cmdArgs) {
        const expr = cmdArgs.join(' ');
        const eqIdx = expr.indexOf('=');
        if (eqIdx <= 0) {
            io.println('Usage: export KEY=VALUE', THEME.warn);
            return 1;
        }
        env[expr.slice(0, eqIdx).trim()] = expr.slice(eqIdx + 1).trim();
        return 0;
    },

    env() {
        for (const [k, v] of Object.entries(env)) {
            io.println(`${k}=${v}`, THEME.text);
        }
        return 0;
    },

    history() {
        history.items.forEach((item, i) => {
            io.println(`${i + 1}  ${item}`, THEME.text);
        });
        return 0;
    },
};

function completeShell(buffer, pos) {
    try {
        const before = buffer.slice(0, pos);
        const wordStart = before.search(/[^\s|;&>]*$/);
        const word = before.slice(wordStart);
        const prev = before.slice(0, wordStart).trimEnd();

        const isCommandPos = !word.includes('/') && (prev === '' || /[|;&]$/.test(prev));

        if (isCommandPos) {
            const names = new Set(Object.keys(BUILTINS));
            for (const dir of (env.PATH || '').split(':').filter(Boolean)) {
                if (!OS.fs.exists(dir) || !OS.fs.isDir(dir)) continue;
                for (const e of OS.fs.listDir(dir)) {
                    if (e.type === 'file') names.add(e.name.replace(/\.js$/, ''));
                }
            }
            const matches = [...names].filter((n) => n.startsWith(word)).sort();
            return { wordStart, word, matches };
        }

        const slash = word.lastIndexOf('/');
        const dirPart = slash === -1 ? '' : word.slice(0, slash + 1);
        const basePart = slash === -1 ? word : word.slice(slash + 1);
        const searchDir = dirPart ? OS.resolvePath(dirPart) : OS.cwd;

        if (!OS.fs.exists(searchDir) || !OS.fs.isDir(searchDir)) {
            return { wordStart, word, matches: [] };
        }

        const entries = OS.fs.listDir(searchDir).filter((e) => e.name.startsWith(basePart));
        const dirs = new Set(
            entries.filter((e) => e.type === 'dir').map((e) => dirPart + e.name + '/'),
        );
        const matches = entries.map((e) => dirPart + e.name + (e.type === 'dir' ? '/' : ''));

        return { wordStart, word, matches, isDir: (m) => dirs.has(m) };
    } catch (err) {
        warn(`Completion error: ${err.message}`);
        return { wordStart: pos, word: '', matches: [] };
    }
}

function expandVars(token) {
    return token.replace(/\$(\?|[A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => env[name] ?? '');
}

function tokenize(line) {
    const tokens = [];
    let current = '';
    let quote = null;

    const flush = () => {
        if (current) {
            tokens.push({ type: 'word', value: expandVars(current) });
            current = '';
        }
    };

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        const next = line[i + 1];

        if (quote) {
            if (ch === quote) quote = null;
            else current += ch;
            continue;
        }

        if (ch === '"' || ch === "'") {
            quote = ch;
        } else if (/\s/.test(ch)) {
            flush();
        } else if (
            (ch === '&' && next === '&') ||
            (ch === '|' && next === '|') ||
            (ch === '>' && next === '>')
        ) {
            flush();
            tokens.push({ type: 'op', value: ch + next });
            i++;
        } else if (ch === '|' || ch === '>' || ch === ';') {
            flush();
            tokens.push({ type: 'op', value: ch });
        } else {
            current += ch;
        }
    }

    if (quote) {
        warn(`Unclosed quote ${quote}; treating remainder literally`);
    }

    flush();
    return tokens;
}

function resolveCommand(cmd) {
    if (!cmd) return null;
    if (cmd.includes('/') || cmd.startsWith('.')) {
        const resolved = OS.resolvePath(cmd);
        return OS.fs.exists(resolved) && !OS.fs.isDir(resolved) ? resolved : null;
    }

    for (const dir of (env.PATH || '').split(':').filter(Boolean)) {
        const base = dir === '/' ? '' : dir;
        const candidates = cmd.endsWith('.js')
            ? [`${base}/${cmd}`]
            : [`${base}/${cmd}.js`, `${base}/${cmd}`];

        for (const candidate of candidates) {
            if (OS.fs.exists(candidate) && !OS.fs.isDir(candidate)) return candidate;
        }
    }

    return null;
}

async function runCommand(cmd, cmdArgs, stdin, captureOutput) {
    const prevStdin = OS.stdin;
    const prevCapture = io.capture;
    const buffer = captureOutput ? [] : null;

    OS.stdin = stdin;
    io.capture = buffer;

    let code = 0;
    try {
        if (BUILTINS[cmd]) {
            code = BUILTINS[cmd](cmdArgs) ?? 0;
        } else {
            const target = resolveCommand(cmd);
            if (!target) {
                io.capture = prevCapture;
                io.println(`shell: ${cmd}: command not found`, THEME.error);
                return { code: 127, output: '' };
            }
            code = (await OS.exec(target, cmdArgs, env, io)) ?? 0;
        }
    } catch (err) {
        io.capture = prevCapture;
        reportError(cmd, err);
        return { code: 1, output: '' };
    } finally {
        OS.stdin = prevStdin;
        io.capture = prevCapture;
    }

    return { code, output: buffer ? buffer.join('') : '' };
}

async function runPipeline(tokens) {
    const stages = [[]];
    for (const tok of tokens) {
        if (tok.type === 'op' && tok.value === '|') stages.push([]);
        else stages[stages.length - 1].push(tok);
    }

    let pipedInput = null;
    let lastCode = 0;

    for (let i = 0; i < stages.length; i++) {
        const stage = stages[i];
        const isLast = i === stages.length - 1;

        const words = [];
        let redirMode = null;
        let redirFile = null;

        for (let j = 0; j < stage.length; j++) {
            const tok = stage[j];
            if (tok.type === 'op' && (tok.value === '>' || tok.value === '>>')) {
                redirMode = tok.value;
                redirFile = stage[++j]?.value || null;
            } else if (tok.type === 'word') {
                words.push(tok.value);
            }
        }

        if (words.length === 0) continue;

        const [cmd, ...cmdArgs] = words;
        const res = await runCommand(cmd, cmdArgs, pipedInput, !isLast || redirMode !== null);
        lastCode = res.code;

        if (redirMode) {
            if (!redirFile) {
                io.println('shell: syntax error near redirection', THEME.error);
                return 1;
            }
            try {
                const dest = OS.resolvePath(redirFile);
                const existing = redirMode === '>>' ? OS.fs.read(dest) || '' : '';
                OS.fs.write(dest, existing + res.output);
            } catch (err) {
                reportError(`redirection to ${redirFile}`, err);
                return 1;
            }
            pipedInput = null;
        } else {
            pipedInput = res.output;
        }
    }

    return lastCode;
}

async function runLine(line) {
    const tokens = tokenize(line);
    if (tokens.length === 0) return 0;

    const chains = [];
    let current = [];

    for (const tok of tokens) {
        if (tok.type === 'op' && (tok.value === ';' || tok.value === '&&' || tok.value === '||')) {
            chains.push({ tokens: current, nextOp: tok.value });
            current = [];
        } else {
            current.push(tok);
        }
    }
    if (current.length > 0) chains.push({ tokens: current, nextOp: null });

    let lastCode = 0;
    let prevOp = null;

    for (const segment of chains) {
        if ((prevOp === '&&' && lastCode !== 0) || (prevOp === '||' && lastCode === 0)) {
            prevOp = segment.nextOp;
            continue;
        }
        lastCode = await runPipeline(segment.tokens);
        env['?'] = String(lastCode);
        prevOp = segment.nextOp;
    }

    return lastCode;
}

io.clear(THEME.bg);
io.println('RING-0 // SHELL v0.6', THEME.banner);
io.println('type "tree" to see the file system', THEME.text);
io.println('', THEME.text);

while (true) {
    try {
        const line = (
            await readLine({
                tty: io,
                prompt: `${OS.cwd}> `,
                history: history.items,
                complete: completeShell,
                fg: THEME.input,
                bg: THEME.bg,
                promptColor: THEME.prompt,
                dimColor: THEME.dim,
            })
        ).trim();

        if (!line) continue;

        try {
            history.add(line);
        } catch (err) {
            warn(`Could not save history entry: ${err.message}`);
        }

        await runLine(line);
    } catch (err) {
        reportError('shell loop recovered', err);
        env['?'] = '1';
        if (typeof OS.nextFrame === 'function') {
            await OS.nextFrame();
        }
    }
}
