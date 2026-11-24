const { COLOR, formatBytes } = OS.require('/lib/cli.js');

OS.tty.println('Defragmenting /dev/hd0...', COLOR.info);
const res = OS.fs.defrag();

OS.tty.println(`Packed ${res.filesPacked} files`, COLOR.text);
OS.tty.println(`Sectors: ${res.oldNextSector} -> ${res.newNextSector}`, COLOR.dim);

if (res.reclaimedSectors > 0) {
    OS.tty.println(
        `Reclaimed ${res.reclaimedSectors} sectors (${formatBytes(res.reclaimedBytes)})`,
        COLOR.ok,
    );
} else {
    OS.tty.println('Disk is already contiguous.', COLOR.ok);
}

return 0;
