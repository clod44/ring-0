const { COLOR, parseArgs, error } = OS.require('/lib/cli.js');

const { positional } = parseArgs(args);
const target = OS.resolvePath(positional[0] || OS.cwd);

if (!OS.fs.exists(target)) {
    return error('ls', `${target}: No such file or directory`);
}

if (!OS.fs.isDir(target)) {
    const name = target.slice(target.lastIndexOf('/') + 1);
    OS.tty.println(name, name.endsWith('.js') ? COLOR.ok : COLOR.text);
    return 0;
}

const entries = OS.fs.listDir(target);
if (entries.length === 0) {
    OS.tty.println('(empty)', COLOR.dim);
    return 0;
}

for (const entry of entries) {
    if (entry.type === 'dir') {
        OS.tty.println(entry.name + '/', COLOR.info);
    } else {
        OS.tty.println(entry.name, entry.name.endsWith('.js') ? COLOR.ok : COLOR.text);
    }
}

return 0;
