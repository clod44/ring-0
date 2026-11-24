const { createHistory, readLine } = OS.require('/lib/readline.js');

// --- 1. CONFIG, THEME & ENV ---

const THEME = {
    bg: 0,
    banner: 10, // Bright Green
    prompt: 214, // Amber
    input: 15, // White
    text: 15, // White
    dim: 8, // Gray
    warn: 11, // Yellow
    error: 9, // Bright Red
};

if (!env.PATH) env.PATH = '/bin:/usr/bin';
if (!env.HISTFILE) env.HISTFILE = '/tmp/history';
env['?'] = '0';

const history = createHistory(env.HISTFILE, 100);

// --- 2. BUILTINS ---

const BUILTINS = {
    export(cmdArgs) {
        const expr = cmdArgs.join(' ');
        const eqIdx = expr.indexOf('=');
        if (eqIdx <= 0) {
            OS.tty.println('Usage: export KEY=VALUE', THEME.warn);
            return 1;
        }
        env[expr.slice(0, eqIdx).trim()] = expr.slice(eqIdx + 1).trim();
        return 0;
    },

    env() {
        for (const [k, v] of Object.entries(env)) {
            OS.tty.println(`${k}=${v}`, THEME.text);
        }
        return 0;
    },

    history() {
        history.items.forEach((item, i) => {
            OS.tty.println(`${i + 1}  ${item}`, THEME.text);
        });
        return 0;
    },
};

// --- 3. TAB COMPLETION PROVIDER ---

function completeShell(buffer, pos) {
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
}

// --- 4. TOKENIZER & COMMAND RESOLVER ---

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

    flush();
    return tokens;
}

function resolveCommand(cmd) {
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

// --- 5. EXECUTION ENGINE ---

async function runCommand(cmd, cmdArgs, stdin, captureOutput) {
    const prevStdin = OS.stdin;
    const prevCapture = OS.tty.capture;
    const buffer = captureOutput ? [] : null;

    OS.stdin = stdin;
    OS.tty.capture = buffer;

    let code = 0;
    try {
        if (BUILTINS[cmd]) {
            code = BUILTINS[cmd](cmdArgs) ?? 0;
        } else {
            const target = resolveCommand(cmd);
            if (!target) {
                OS.tty.capture = prevCapture;
                OS.tty.println(`shell: ${cmd}: command not found`, THEME.error);
                return { code: 127, output: '' };
            }
            code = (await OS.exec(target, cmdArgs, env)) ?? 0;
        }
    } catch (err) {
        OS.tty.capture = prevCapture;
        OS.tty.println(`${cmd}: ${err.message}`, THEME.error);
        return { code: 1, output: '' };
    } finally {
        OS.stdin = prevStdin;
        OS.tty.capture = prevCapture;
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
                OS.tty.println('shell: syntax error near redirection', THEME.error);
                return 1;
            }
            const dest = OS.resolvePath(redirFile);
            const existing = redirMode === '>>' ? OS.fs.read(dest) || '' : '';
            OS.fs.write(dest, existing + res.output);
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

// --- 6. MAIN REPL ---

OS.tty.clear(THEME.bg);
OS.tty.println('RING-0 // SHELL v0.6', THEME.banner);
OS.tty.println('type "tree" to see the file system', THEME.text);
OS.tty.println('', THEME.text);

while (true) {
    const line = (
        await readLine({
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
    history.add(line);
    await runLine(line);
}
