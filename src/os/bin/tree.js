const { COLOR, parseArgs, error } = OS.require('/lib/cli.js');

const io = (typeof tty !== 'undefined' && tty) || OS.tty;

const { positional } = parseArgs(args);
const target = OS.resolvePath(positional[0] || OS.cwd);

if (!OS.fs.exists(target)) {
    return error('tree', `${target}: No such file or directory`);
}

if (!OS.fs.isDir(target)) {
    return error('tree', `${target}: Not a directory`);
}

io.println(target, COLOR.info);
printTree(target);
return 0;

function printTree(path, prefix = '') {
    const entries = OS.fs.listDir(path);

    if (entries.length === 0 && prefix === '') {
        io.println('(empty)', COLOR.dim);
        return;
    }

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const isLast = i === entries.length - 1;
        const isDir = entry.type === 'dir';

        const connector = isLast ? '\\- ' : '|- ';
        const label = isDir ? entry.name + '/' : entry.name;
        const color = isDir ? COLOR.info : entry.name.endsWith('.js') ? COLOR.ok : COLOR.text;

        io.println(`${prefix}${connector}${label}`, color);

        if (isDir) {
            const nextPrefix = prefix + (isLast ? '   ' : '|  ');
            printTree(entry.path, nextPrefix);
        }
    }
}
