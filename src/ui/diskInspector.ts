import { SECTOR_SIZE, TOTAL_SECTORS  } from '../hw/config.ts';
const TABLE_START = 1;
const TABLE_SECTORS = 16;

// 128 x 32 = 4096 sectors, 6px per sector = 768x192 canvas
const MAP_COLS = 128;
const CELL_PX = 6;

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

  function readSectorSlice(sector: number, count = 1): Uint8Array {
    const start = sector * SECTOR_SIZE;
    return disk.subarray(start, start + count * SECTOR_SIZE);
  }

  function decodeZeroTerminated(bytes: Uint8Array): string {
    const end = bytes.indexOf(0);
    return decoder.decode(end === -1 ? bytes : bytes.subarray(0, end));
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

  function findSectorOwner(sector: number): string {
    if (sector === 0) return 'MBR (Bootloader)';
    if (sector >= TABLE_START && sector < TABLE_START + TABLE_SECTORS) {
      return 'File Table (JSON)';
    }
    for (const e of parsedEntries) {
      if (e.type === 'file' && e.start !== undefined && e.size !== undefined) {
        const count = Math.max(1, Math.ceil(e.size / SECTOR_SIZE));
        if (sector >= e.start && sector < e.start + count) {
          return `${e.path} (${e.size} B)`;
        }
      }
    }
    return 'Free / Unallocated';
  }

  function renderDiskMap() {
    let usedCount = 0;

    for (let s = 0; s < TOTAL_SECTORS; s++) {
      const offset = s * SECTOR_SIZE;
      let nonZero = 0;
      for (let i = 0; i < SECTOR_SIZE; i++) {
        if (disk[offset + i] !== 0) nonZero++;
      }

      if (nonZero > 0) usedCount++;

      const col = s % MAP_COLS;
      const row = Math.floor(s / MAP_COLS);

      if (s === 0) {
        ctx.fillStyle = '#f59e0b'; // MBR
      } else if (s < TABLE_START + TABLE_SECTORS) {
        ctx.fillStyle = '#38bdf8'; // File table
      } else if (nonZero > 0) {
        // Scale green brightness by sector fill density
        const density = 0.35 + (nonZero / SECTOR_SIZE) * 0.65;
        ctx.fillStyle = `rgba(74, 222, 128, ${density.toFixed(2)})`;
      } else {
        ctx.fillStyle = '#18181b'; // Empty
      }

      ctx.fillRect(col * CELL_PX, row * CELL_PX, CELL_PX - 1, CELL_PX - 1);

      if (s === selectedSector) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(col * CELL_PX + 0.5, row * CELL_PX + 0.5, CELL_PX - 2, CELL_PX - 2);
      }
    }

    statsEl.textContent = `Used: ${usedCount} / ${TOTAL_SECTORS} sectors (${((usedCount * 512) / 1024).toFixed(1)} KB)`;
  }

  function renderBitwiseSector(sector: number) {
    selectedSector = Math.max(0, Math.min(TOTAL_SECTORS - 1, sector));
    sectorInput.value = String(selectedSector);
    sectorOwnerEl.textContent = `Region: ${findSectorOwner(selectedSector)}`;

    const bytes = readSectorSlice(selectedSector);
    const lines: string[] = [];
    const BYTES_PER_ROW = 4; // 32 bits per row

    for (let i = 0; i < SECTOR_SIZE; i += BYTES_PER_ROW) {
      const addr = (selectedSector * SECTOR_SIZE + i).toString(16).padStart(6, '0');
      let bits = '';
      let hex = '';
      let ascii = '';

      for (let j = 0; j < BYTES_PER_ROW; j++) {
        const b = bytes[i + j];
        bits += b.toString(2).padStart(8, '0') + ' ';
        hex += b.toString(16).padStart(2, '0') + ' ';
        ascii += b >= 32 && b <= 126 ? String.fromCharCode(b) : '.';
      }

      lines.push(`0x${addr} | ${bits}| ${hex}| ${ascii}`);
    }

    bitDumpEl.textContent = lines.join('\n');
  }

  function renderParsedSections() {
    // 1. MBR
    mbrPreviewEl.textContent = decodeZeroTerminated(readSectorSlice(0)) || '(empty)';

    // 2. File table
    parsedEntries = parseFileTable();
    fsTableBody.innerHTML = '';

    for (const entry of parsedEntries) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${entry.path}</td>
        <td>${entry.type}</td>
        <td>${entry.start ?? '-'}</td>
        <td>${entry.size !== undefined ? `${entry.size} B` : '-'}</td>
      `;

      if (entry.start !== undefined) {
        tr.addEventListener('click', () => {
          renderBitwiseSector(entry.start!);
          renderDiskMap();
        });
      }

      fsTableBody.appendChild(tr);
    }
  }

  function refresh() {
    renderParsedSections();
    renderDiskMap();
    renderBitwiseSector(selectedSector);
  }

  // Click any cell on the disk map to inspect its bits
  mapCanvas.addEventListener('click', (e) => {
    const rect = mapCanvas.getBoundingClientRect();
    const scaleX = mapCanvas.width / rect.width;
    const scaleY = mapCanvas.height / rect.height;
    const col = Math.floor(((e.clientX - rect.left) * scaleX) / CELL_PX);
    const row = Math.floor(((e.clientY - rect.top) * scaleY) / CELL_PX);
    const sector = row * MAP_COLS + col;
    if (sector >= 0 && sector < TOTAL_SECTORS) {
      renderBitwiseSector(sector);
      renderDiskMap();
    }
  });

  document.getElementById('prev-sector')!.addEventListener('click', () => {
    renderBitwiseSector(selectedSector - 1);
    renderDiskMap();
  });

  document.getElementById('next-sector')!.addEventListener('click', () => {
    renderBitwiseSector(selectedSector + 1);
    renderDiskMap();
  });

  sectorInput.addEventListener('change', () => {
    renderBitwiseSector(parseInt(sectorInput.value, 10) || 0);
    renderDiskMap();
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