const { parseArgs, error, usage } = OS.require('/lib/cli.js');

const { positional } = parseArgs(args);

if (positional.length === 0) {
    return usage('rmdir <dir> [...dirs]');
}

let exitCode = 0;

for (const arg of positional) {
    const path = OS.resolvePath(arg);

    if (!OS.fs.exists(path)) {
        exitCode = error('rmdir', `${path}: No such file or directory`);
        continue;
    }

    if (!OS.fs.isDir(path)) {
        exitCode = error('rmdir', `${path}: Not a directory`);
        continue;
    }

    if (OS.fs.listDir(path).length > 0) {
        exitCode = error('rmdir', `${path}: Directory not empty`);
        continue;
    }

    OS.fs.remove(path, false);
}

return exitCode;
