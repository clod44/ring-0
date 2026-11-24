import { SECTOR_SIZE, TOTAL_SECTORS } from '../hw/config.ts';

const TABLE_START = 1;
const TABLE_SECTORS = 16;
const DATA_START = TABLE_START + TABLE_SECTORS;

// 128 x 32 = 4096 sectors, 6px per sector = 768x192 canvas
const MAP_COLS = 128;
const CELL_PX = 6;
const BYTES_PER_ROW = 4; // 32 bits per row

type SectorState = 'mbr' | 'table' | 'allocated' | 'stale' | 'free';

interface SectorInfo {
  state: SectorState;
  label: string;
  nonZeroBytes: number;
}

interface FsEntry {
  path: string;
  name: string;
  type: 'file' | 'dir';
  start?: number;
  size?: number;
}

export function initDiskInspector(initialDisk: Uint8Array, onRequestRefresh: () => void) {
  let disk = initialDisk;

  const mapCanvas = document.getElementById('disk-map') as HTMLCanvasElement;
  const ctx = mapCanvas.getContext('2d')!;
  const statsEl = document.getElementById('disk-stats')!;
  const bitDumpEl = document.getElementById('bit-dump')!;
  const sectorInput = document.getElementById('sector-input') as HTMLInputElement;
  const sectorOwnerEl = document.getElementById('sector-owner')!;
  const mbrPreviewEl = document.getElementById('mbr-preview')!;
  const fsTableBody = document.getElementById('fs-table-body')!;

  const decoder = new TextDecoder();
  let selectedSector = 0;
  let parsedEntries: FsEntry[] = [];
  let sectorMap: SectorInfo[] = [];

  function readSectorSlice(sector: number, count = 1): Uint8Array {
    const start = sector * SECTOR_SIZE;
    return disk.subarray(start, start + count * SECTOR_SIZE);
  }

  function decodeZeroTerminated(bytes: Uint8Array): string {
    const end = bytes.indexOf(0);
    return decoder.decode(end === -1 ? bytes : bytes.subarray(0, end));
  }

  function countNonZero(sector: number): number {
    const offset = sector * SECTOR_SIZE;
    const end = Math.min(disk.length, offset + SECTOR_SIZE);
    let count = 0;
    for (let i = offset; i < end; i++) {
      if (disk[i] !== 0) count++;
    }
    return count;
  }

  function parseFileTable(): FsEntry[] {
    const raw = decodeZeroTerminated(readSectorSlice(TABLE_START, TABLE_SECTORS));
    if (!raw.trim()) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed.entries) ? parsed.entries : [];
    } catch {
      return [];
    }
  }

  function buildSectorMap(): SectorInfo[] {
    const ownerBySector = new Map<number, string>();

    for (const entry of parsedEntries) {
      if (entry.type === 'file' && entry.start !== undefined && entry.size !== undefined) {
        const count = Math.max(1, Math.ceil(entry.size / SECTOR_SIZE));
        const end = Math.min(TOTAL_SECTORS, entry.start + count);
        for (let s = entry.start; s < end; s++) {
          ownerBySector.set(s, `${entry.path} (${entry.size} B)`);
        }
      }
    }

    const infos: SectorInfo[] = new Array(TOTAL_SECTORS);

    for (let s = 0; s < TOTAL_SECTORS; s++) {
      const nonZeroBytes = countNonZero(s);

      if (s === 0) {
        infos[s] = { state: 'mbr', label: 'MBR (Bootloader)', nonZeroBytes };
      } else if (s < DATA_START) {
        infos[s] = { state: 'table', label: 'File Table (JSON)', nonZeroBytes };
      } else if (ownerBySector.has(s)) {
        infos[s] = { state: 'allocated', label: ownerBySector.get(s)!, nonZeroBytes };
      } else if (nonZeroBytes > 0) {
        infos[s] = {
          state: 'stale',
          label: `Flagged Free / Stale Data (${nonZeroBytes} non-zero B)`,
          nonZeroBytes,
        };
      } else {
        infos[s] = { state: 'free', label: 'Free / Zeroed', nonZeroBytes: 0 };
      }
    }

    return infos;
  }

  function getSectorFill(info: SectorInfo): string {
    switch (info.state) {
      case 'mbr':
        return '#f59e0b';
      case 'table':
        return '#38bdf8';
      case 'allocated': {
        const density = 0.35 + (info.nonZeroBytes / SECTOR_SIZE) * 0.65;
        return `rgba(74, 222, 128, ${density.toFixed(2)})`;
      }
      case 'stale':
        return '#f97316'; // Flagged free in FS, but non-zero bytes remain
      case 'free':
        return '#18181b'; // Flagged free and all zero bytes
    }
  }

  function renderDiskMap() {
    let allocatedCount = 0;
    let staleCount = 0;

    for (let s = 0; s < TOTAL_SECTORS; s++) {
      const info = sectorMap[s];
      if (info.state === 'mbr' || info.state === 'table' || info.state === 'allocated') {
        allocatedCount++;
      } else if (info.state === 'stale') {
        staleCount++;
      }

      const col = s % MAP_COLS;
      const row = Math.floor(s / MAP_COLS);

      ctx.fillStyle = getSectorFill(info);
      ctx.fillRect(col * CELL_PX, row * CELL_PX, CELL_PX - 1, CELL_PX - 1);

      if (s === selectedSector) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(col * CELL_PX + 0.5, row * CELL_PX + 0.5, CELL_PX - 2, CELL_PX - 2);
      }
    }

    const usedKb = ((allocatedCount * SECTOR_SIZE) / 1024).toFixed(1);
    statsEl.textContent =
      `Used: ${allocatedCount}/${TOTAL_SECTORS} (${usedKb} KB) · Flagged Free w/ Data: ${staleCount}`;
  }

  function renderBitwiseSector(sector: number) {
    const info = sectorMap[sector];
    sectorInput.value = String(sector);
    sectorOwnerEl.textContent = `Region: ${info.label}`;

    const bytes = readSectorSlice(sector);
    const lines: string[] = [];

    for (let i = 0; i < SECTOR_SIZE; i += BYTES_PER_ROW) {
      const addr = (sector * SECTOR_SIZE + i).toString(16).padStart(6, '0');
      let bits = '';
      let hex = '';
      let ascii = '';

      for (let j = 0; j < BYTES_PER_ROW; j++) {
        const b = bytes[i + j] ?? 0;
        bits += b.toString(2).padStart(8, '0') + ' ';
        hex += b.toString(16).padStart(2, '0') + ' ';
        ascii += b >= 32 && b <= 126 ? String.fromCharCode(b) : '.';
      }

      lines.push(`0x${addr} | ${bits}| ${hex}| ${ascii}`);
    }

    bitDumpEl.textContent = lines.join('\n');
  }

  function selectSector(sector: number) {
    selectedSector = Math.max(0, Math.min(TOTAL_SECTORS - 1, sector));
    renderDiskMap();
    renderBitwiseSector(selectedSector);
  }

  function renderFileTable() {
    fsTableBody.replaceChildren();

    for (const entry of parsedEntries) {
      const tr = document.createElement('tr');

      const cells = [
        entry.path,
        entry.type,
        entry.start !== undefined ? String(entry.start) : '-',
        entry.size !== undefined ? `${entry.size} B` : '-',
      ];

      for (const text of cells) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      }

      if (entry.start !== undefined) {
        tr.addEventListener('click', () => selectSector(entry.start!));
      }

      fsTableBody.appendChild(tr);
    }
  }

  function refresh() {
    mbrPreviewEl.textContent = decodeZeroTerminated(readSectorSlice(0)) || '(empty)';
    parsedEntries = parseFileTable();
    sectorMap = buildSectorMap();
    renderFileTable();
    selectSector(selectedSector);
  }

  mapCanvas.addEventListener('click', (e) => {
    const rect = mapCanvas.getBoundingClientRect();
    const scaleX = mapCanvas.width / rect.width;
    const scaleY = mapCanvas.height / rect.height;
    const col = Math.floor(((e.clientX - rect.left) * scaleX) / CELL_PX);
    const row = Math.floor(((e.clientY - rect.top) * scaleY) / CELL_PX);
    const sector = row * MAP_COLS + col;
    if (sector >= 0 && sector < TOTAL_SECTORS) {
      selectSector(sector);
    }
  });

  document.getElementById('prev-sector')!.addEventListener('click', () => {
    selectSector(selectedSector - 1);
  });

  document.getElementById('next-sector')!.addEventListener('click', () => {
    selectSector(selectedSector + 1);
  });

  sectorInput.addEventListener('change', () => {
    selectSector(parseInt(sectorInput.value, 10) || 0);
  });

  document.getElementById('refresh-disk-btn')!.addEventListener('click', () => {
    onRequestRefresh();
  });

  refresh();

  return {
    updateDisk(newDisk: Uint8Array) {
      disk = newDisk;
      refresh();
    },
  };
}