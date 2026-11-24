const { parseArgs, error, usage } = OS.require('/lib/cli.js');

const { positional } = parseArgs(args);

if (positional.length < 2) {
  return usage('cp <src> <dest>');
}

const src = OS.resolvePath(positional[0]);
let dest = OS.resolvePath(positional[1]);

if (!OS.fs.exists(src)) {
  return error('cp', `${src}: No such file or directory`);
}

if (OS.fs.isDir(src)) {
  return error('cp', `${src}: Is a directory`);
}

if (OS.fs.isDir(dest)) {
  const fileName = src.slice(src.lastIndexOf('/') + 1);
  dest = (dest === '/' ? '' : dest) + '/' + fileName;
}

if (src === dest) {
  return error('cp', `'${src}' and '${dest}' are the same file`);
}

OS.fs.writeBytes(dest, OS.fs.readBytes(src));
return 0;