const { parseArgs, error, usage } = OS.require('/lib/cli.js');

const { positional } = parseArgs(args);

if (positional.length < 1) {
    return usage('exec <path> [arg1 arg2 ...]');
}

const targetPath = OS.resolvePath(positional[0]);
const childArgs = positional.slice(1);

if (!OS.fs.exists(targetPath)) {
    return error('exec', `${targetPath}: No such file or directory`);
}

if (OS.fs.isDir(targetPath)) {
    return error('exec', `${targetPath}: Is a directory`);
}

try {
    const result = await OS.exec(targetPath, childArgs);
    return typeof result === 'number' ? result : 0;
} catch (err) {
    return error('exec', err && err.message ? err.message : String(err));
}
