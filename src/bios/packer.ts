import { SECTOR_SIZE,DISK_SIZE } from '../hw/config.ts';

export const TABLE_START_SECTOR = 1;
export const TABLE_SECTOR_COUNT = 16; // 8 KB reserved for the file table
export const DATA_START_SECTOR = TABLE_START_SECTOR + TABLE_SECTOR_COUNT; // Sector 17

export interface FsEntry {
  path: string;
  name: string;
  parent: string;
  type: 'file' | 'dir';
  start?: number; // Starting sector index (files only)
  size?: number;  // Exact byte length (files only)
}

export interface FileTable {
  nextSector: number;
  entries: FsEntry[];
}

// Text/code files bundled as UTF-8 strings
const textOsFiles = import.meta.glob(
  ['../os/**/*', '!../os/**/*.{png,jpg,jpeg,webp,gif,bmp,ico,bin}'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  }
) as Record<string, string>;

// Binary assets bundled as base64 data URLs (preserves exact bytes)
const binaryOsFiles = import.meta.glob(
  '../os/**/*.{png,jpg,jpeg,webp,gif,bmp,ico,bin}',
  {
    query: '?inline',
    import: 'default',
    eager: true,
  }
) as Record<string, string>;

const encoder = new TextEncoder();

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function splitPath(fullPath: string): { parent: string; name: string } {
  const idx = fullPath.lastIndexOf('/');
  return {
    parent: idx <= 0 ? '/' : fullPath.slice(0, idx),
    name: fullPath.slice(idx + 1),
  };
}

function ensureParentDirs(
  entries: FsEntry[],
  seenDirs: Set<string>,
  filePath: string
): void {
  const parts = filePath.split('/').filter(Boolean);
  parts.pop();

  let current = '';
  for (const part of parts) {
    current += '/' + part;
    if (!seenDirs.has(current)) {
      seenDirs.add(current);
      const { parent, name } = splitPath(current);
      entries.push({ path: current, name, parent, type: 'dir' });
    }
  }
}

function writeBootSector(disk: Uint8Array, mbrCode: string): void {
  const mbrBytes = encoder.encode(mbrCode);

  if (mbrBytes.length > SECTOR_SIZE) {
    throw new Error(
      `MBR is too large (${mbrBytes.length} bytes). Sector 0 max is ${SECTOR_SIZE} bytes.`
    );
  }

  disk.set(mbrBytes, 0);
}

function packFiles(disk: Uint8Array, files: Record<string, Uint8Array>): FileTable {
  const entries: FsEntry[] = [];
  const seenDirs = new Set<string>(['/']);
  let nextSector = DATA_START_SECTOR;

  for (const [rawPath, bytes] of Object.entries(files)) {
    if (rawPath === '../os/mbr.js') continue;

    const path = rawPath.replace('../os', '');
    ensureParentDirs(entries, seenDirs, path);

    const sectorsNeeded = Math.ceil(bytes.length / SECTOR_SIZE) || 1;

    if ((nextSector + sectorsNeeded) * SECTOR_SIZE > DISK_SIZE) {
      throw new Error(`Disk full! Could not fit ${path}`);
    }

    disk.set(bytes, nextSector * SECTOR_SIZE);
    const { parent, name } = splitPath(path);
    entries.push({
      path,
      name,
      parent,
      type: 'file',
      start: nextSector,
      size: bytes.length,
    });
    nextSector += sectorsNeeded;
  }

  return { nextSector, entries };
}

function writeFileTable(disk: Uint8Array, table: FileTable): void {
  const tableBytes = encoder.encode(JSON.stringify(table));
  const maxTableBytes = TABLE_SECTOR_COUNT * SECTOR_SIZE;

  if (tableBytes.length > maxTableBytes) {
    throw new Error(
      `File table too large (${tableBytes.length} bytes). Max is ${maxTableBytes} bytes.`
    );
  }

  disk.set(tableBytes, TABLE_START_SECTOR * SECTOR_SIZE);
}

export function createFactoryDisk(): Uint8Array {
  const disk = new Uint8Array(DISK_SIZE);

  writeBootSector(disk, textOsFiles['../os/mbr.js'] ?? '');

  const allFiles: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(textOsFiles)) {
    allFiles[path] = encoder.encode(content);
  }
  for (const [path, dataUrl] of Object.entries(binaryOsFiles)) {
    allFiles[path] = dataUrlToBytes(dataUrl);
  }

  const table = packFiles(disk, allFiles);
  writeFileTable(disk, table);

  return disk;
}