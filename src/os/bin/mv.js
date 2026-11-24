const { parseArgs, error, usage } = OS.require('/lib/cli.js');

const { positional } = parseArgs(args);

if (positional.length < 2) {
    return usage('mv <src> <dest>');
}

const src = OS.resolvePath(positional[0]);
const dest = OS.resolvePath(positional[1]);

if (!OS.fs.exists(src)) {
    return error('mv', `${src}: No such file or directory`);
}

OS.fs.move(src, dest);
return 0;
