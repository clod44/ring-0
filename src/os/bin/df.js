const { COLOR, parseArgs, formatBytes } = OS.require('/lib/cli.js');

const { has } = parseArgs(args);
const human = has('h');
const info = OS.fs.statFs();

const usageColor = (pct) => (pct >= 90 ? COLOR.error : pct >= 70 ? COLOR.warn : COLOR.ok);
const drawBar = (pct, w = 20) => {
  const filled = Math.min(w, Math.round((pct / 100) * w));
  return '[' + '#'.repeat(filled) + '-'.repeat(w - filled) + ']';
};

const usedPct = Math.round((info.usedSectors / info.totalSectors) * 100);
const tablePct = Math.round((info.tableBytes / info.tableMaxBytes) * 100);

OS.tty.println('FS        SIZE   USED  AVAIL  USE%', COLOR.info);
OS.tty.print('/dev/hd0', COLOR.text);
OS.tty.print(
  formatBytes(info.totalBytes, human).padStart(6) +
  formatBytes(info.usedBytes, human).padStart(6) +
  formatBytes(info.freeBytes, human).padStart(6),
  COLOR.text
);
OS.tty.println((usedPct + '%').padStart(5), usageColor(usedPct));

OS.tty.print(drawBar(usedPct) + ' ', usageColor(usedPct));
OS.tty.println(`${info.usedSectors}/${info.totalSectors} sec`, COLOR.dim);

const tUsed = formatBytes(info.tableBytes, true);
const tMax = formatBytes(info.tableMaxBytes, true);
OS.tty.print(`Table: ${tUsed}/${tMax} (${tablePct}%)`, usageColor(tablePct));
OS.tty.println(` | ${info.fileCount}f ${info.dirCount}d`, COLOR.dim);

return 0;