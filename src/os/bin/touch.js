const { parseArgs, error, usage } = OS.require('/lib/cli.js');

const { positional } = parseArgs(args);

if (positional.length === 0) {
  return usage('touch <file> [...files]');
}

let exitCode = 0;

for (const arg of positional) {
  const target = OS.resolvePath(arg);

  if (OS.fs.isDir(target)) {
    exitCode = error('touch', `${target}: Is a directory`);
    continue;
  }

  if (!OS.fs.exists(target)) {
    OS.fs.write(target, '');
  }
}

return exitCode;