const { parseArgs, error } = OS.require('/lib/cli.js');

const { positional } = parseArgs(args);
const target = OS.resolvePath(positional[0] || '/');

if (!OS.fs.exists(target)) {
    return error('cd', `${target}: No such file or directory`);
}

if (!OS.fs.isDir(target)) {
    return error('cd', `${target}: Not a directory`);
}

OS.cwd = target;
return 0;
