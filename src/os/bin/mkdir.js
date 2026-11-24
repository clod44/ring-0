const { parseArgs, error, usage } = OS.require('/lib/cli.js');

const { positional } = parseArgs(args);

if (positional.length === 0) {
  return usage('mkdir <dir> [...dirs]');
}

let exitCode = 0;

for (const arg of positional) {
  const target = OS.resolvePath(arg);

  if (OS.fs.exists(target)) {
    exitCode = error('mkdir', `${target}: File exists`);
    continue;
  }

  OS.fs.mkdir(target);
}

return exitCode;