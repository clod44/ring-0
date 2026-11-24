const { COLOR, parseArgs, error, usage } = OS.require('/lib/cli.js');

const { positional } = parseArgs(args);

if (positional.length === 0) {
  return usage('cat <path> [...paths]');
}

let exitCode = 0;

for (const arg of positional) {
  const path = OS.resolvePath(arg);

  if (OS.fs.isDir(path)) {
    exitCode = error('cat', `${path}: Is a directory`);
    continue;
  }

  const content = OS.fs.read(path);
  if (content === null) {
    exitCode = error('cat', `${path}: No such file`);
  } else {
    OS.tty.println(content, COLOR.text);
  }
}

return exitCode;