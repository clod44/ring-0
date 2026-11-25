const { COLOR, parseArgs, error, usage } = OS.require('/lib/cli.js');

const { positional, has } = parseArgs(args);

if (has('h', 'help')) {
    return usage('ps [kill <pid>]');
}

if (!OS.procs || typeof OS.procs.values !== 'function') {
    return error('ps', 'OS.procs is not available in kernel');
}

if (positional.length > 0) {
    if (positional[0] === 'kill') {
        const targetPid = Number(positional[1]);
        if (!Number.isFinite(targetPid) || targetPid <= 0) {
            return usage('ps kill <pid>');
        }
        if (typeof OS.kill !== 'function') {
            return error('ps', 'OS.kill is not available in kernel');
        }
        if (!OS.kill(targetPid)) {
            return error('ps', `No active process with PID ${targetPid}`);
        }
        OS.tty.println(`Killed PID ${targetPid}`, COLOR.ok);
        return 0;
    }
    return usage('ps [kill <pid>]');
}

const rows = Array.from(OS.procs.values()).sort((a, b) => a.pid - b.pid);

OS.tty.println('PID   PPID  STATE   COMMAND', COLOR.info);
OS.tty.println('----  ----  ------  -------', COLOR.dim);

for (const p of rows) {
    const pid = String(p.pid).padEnd(6);
    const ppid = String(p.parentPid ?? '-').padEnd(6);
    const state = (p.alive === false ? 'DEAD' : 'RUN').padEnd(8);
    const cmd = p.path || '<unknown>';
    OS.tty.println(`${pid}${ppid}${state}${cmd}`, COLOR.text);
}

return 0;
