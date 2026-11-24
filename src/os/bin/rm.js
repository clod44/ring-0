const { parseArgs, error, usage } = OS.require('/lib/cli.js');

const { has, positional } = parseArgs(args);
const recursive = has('r', 'R');
const force = has('f');

if (positional.length === 0) {
  return usage('rm [-rf] <path> [...paths]');
}

let exitCode = 0;

for (const arg of positional) {
  const path = OS.resolvePath(arg);

  if (path === '/') {
    exitCode = error('rm', 'cannot remove root directory');
    continue;
  }

  if (!OS.fs.exists(path)) {
    if (!force) exitCode = error('rm', `${path}: No such file or directory`);
    continue;
  }

  if (OS.fs.isDir(path) && !recursive) {
    exitCode = error('rm', `${path}: Is a directory (use -r)`);
    continue;
  }

  OS.fs.remove(path, recursive);
}

return exitCode;