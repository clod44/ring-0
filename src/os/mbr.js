const dec = new TextDecoder();
const rawTable = dec.decode(HW.readSectors(1, 16)).replace(/\0+$/, '');
const table = JSON.parse(rawTable);
const entry = table.entries.find((e) => e.path === '/sys/kernel.js');

if (!entry) {
  HW.log('MBR: /sys/kernel.js not found!');
} else {
  const sectors = Math.ceil(entry.size / HW.sectorSize) || 1;
  const bytes = HW.readSectors(entry.start, sectors).slice(0, entry.size);
  new Function('HW', dec.decode(bytes))(HW);
}