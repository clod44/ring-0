const enc = new TextEncoder();
const dec = new TextDecoder();

const TABLE_START = 1;
const TABLE_SECTORS = 16;
const DATA_START = TABLE_START + TABLE_SECTORS; // Sector 17
const TABLE_MAX_BYTES = TABLE_SECTORS * HW.sectorSize;

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// --- 1. FILESYSTEM DRIVER (OS.fs) ---

function sectorsFor(byteLength) {
  return Math.ceil(byteLength / HW.sectorSize) || 1;
}

function getTotalSectors() {
  const totalBytes = HW.diskSize || 2 * 1024 * 1024;
  return Math.floor(totalBytes / HW.sectorSize);
}

function computeHighWaterSector(entries) {
  let maxEnd = DATA_START;
  for (const e of entries) {
    if (e.type === 'file' && typeof e.start === 'number' && typeof e.size === 'number') {
      maxEnd = Math.max(maxEnd, e.start + sectorsFor(e.size));
    }
  }
  return maxEnd;
}

function findFreeRun(entries, sectorsNeeded, ignoreEntry = null) {
  const totalSectors = getTotalSectors();
  if (sectorsNeeded <= 0 || DATA_START + sectorsNeeded > totalSectors) {
    return -1;
  }

  const used = new Uint8Array(totalSectors);
  for (let s = 0; s < Math.min(DATA_START, totalSectors); s++) {
    used[s] = 1;
  }

  for (const e of entries) {
    if (e === ignoreEntry || e.type !== 'file') continue;
    if (typeof e.start !== 'number' || typeof e.size !== 'number') continue;

    const count = sectorsFor(e.size);
    const end = Math.min(totalSectors, e.start + count);
    for (let s = e.start; s < end; s++) {
      used[s] = 1;
    }
  }

  let runStart = -1;
  let runLen = 0;

  for (let s = DATA_START; s < totalSectors; s++) {
    if (used[s] === 0) {
      if (runLen === 0) runStart = s;
      runLen++;
      if (runLen >= sectorsNeeded) {
        return runStart;
      }
    } else {
      runStart = -1;
      runLen = 0;
    }
  }

  return -1;
}

function loadTable() {
  const raw = dec.decode(HW.readSectors(TABLE_START, TABLE_SECTORS)).replace(/\0+$/, '');
  return JSON.parse(raw);
}

function saveTable(table) {
  table.nextSector = computeHighWaterSector(table.entries);
  const bytes = enc.encode(JSON.stringify(table));
  if (bytes.length > TABLE_MAX_BYTES) {
    throw new Error('FS: File table exceeded 8KB limit');
  }
  const padded = new Uint8Array(TABLE_MAX_BYTES);
  padded.set(bytes, 0);
  HW.writeSectors(TABLE_START, padded);
}

function splitPath(fullPath) {
  const idx = fullPath.lastIndexOf('/');
  return {
    parent: idx <= 0 ? '/' : fullPath.slice(0, idx),
    name: fullPath.slice(idx + 1),
  };
}

function ensureDirsInTable(table, dirPath) {
  if (dirPath === '/') return;
  const parts = dirPath.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current += '/' + part;
    if (!table.entries.some((e) => e.path === current)) {
      const { parent, name } = splitPath(current);
      table.entries.push({ path: current, name, parent, type: 'dir' });
    }
  }
}

const fs = {
  list() {
    return loadTable().entries.filter((e) => e.type === 'file').map((e) => e.path);
  },

  listDir(dirPath = '/') {
    const resolved = OS.resolvePath(dirPath);
    return loadTable()
      .entries.filter((e) => e.parent === resolved)
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  },

  exists(path) {
    const resolved = OS.resolvePath(path);
    if (resolved === '/') return true;
    return loadTable().entries.some((e) => e.path === resolved);
  },

  isDir(path) {
    const resolved = OS.resolvePath(path);
    if (resolved === '/') return true;
    return loadTable().entries.some((e) => e.path === resolved && e.type === 'dir');
  },

  mkdir(path) {
    const resolved = OS.resolvePath(path);
    if (resolved === '/') return;

    const table = loadTable();
    const existing = table.entries.find((e) => e.path === resolved);
    if (existing) {
      if (existing.type === 'file') throw new Error(`File exists: ${resolved}`);
      return;
    }

    ensureDirsInTable(table, resolved);
    saveTable(table);
  },

  readBytes(path) {
    const resolved = OS.resolvePath(path);
    const table = loadTable();
    const entry = table.entries.find((e) => e.path === resolved && e.type === 'file');
    if (!entry) return null;

    const sectors = sectorsFor(entry.size);
    return HW.readSectors(entry.start, sectors).slice(0, entry.size);
  },

  writeBytes(path, bytes) {
    const resolved = OS.resolvePath(path);
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

    const table = loadTable();
    const { parent, name } = splitPath(resolved);
    ensureDirsInTable(table, parent);

    const sectorsNeeded = sectorsFor(data.length);
    const padded = new Uint8Array(sectorsNeeded * HW.sectorSize);
    padded.set(data, 0);

    let entry = table.entries.find((e) => e.path === resolved);
    if (entry && entry.type === 'dir') {
      throw new Error(`Cannot overwrite directory: ${resolved}`);
    }

    const canReuse = entry && sectorsNeeded <= sectorsFor(entry.size);
    if (canReuse) {
      HW.writeSectors(entry.start, padded);
      entry.size = data.length;
    } else {
      const start = findFreeRun(table.entries, sectorsNeeded, entry);
      if (start === -1) {
        throw new Error(`Disk full: cannot write ${resolved}`);
      }

      HW.writeSectors(start, padded);

      if (entry) {
        entry.start = start;
        entry.size = data.length;
      } else {
        table.entries.push({ path: resolved, name, parent, type: 'file', start, size: data.length });
      }
    }

    saveTable(table);
  },

  read(path) {
    const bytes = this.readBytes(path);
    return bytes ? dec.decode(bytes) : null;
  },

  write(path, text) {
    this.writeBytes(path, enc.encode(text));
  },

  move(srcPath, destPath) {
    const src = OS.resolvePath(srcPath);
    const dest = OS.resolvePath(destPath);
    if (src === '/') throw new Error('Cannot move root directory');

    const table = loadTable();
    const entry = table.entries.find((e) => e.path === src);
    if (!entry) throw new Error(`Not found: ${src}`);

    let finalDest = dest;
    const destEntry = table.entries.find((e) => e.path === dest);
    if (dest === '/' || (destEntry && destEntry.type === 'dir')) {
      finalDest = (dest === '/' ? '' : dest) + '/' + entry.name;
    }

    if (finalDest === src) return;

    if (entry.type === 'dir' && finalDest.startsWith(src + '/')) {
      throw new Error('Cannot move a directory into itself');
    }

    const existingIdx = table.entries.findIndex((e) => e.path === finalDest);
    if (existingIdx !== -1) {
      if (table.entries[existingIdx].type === 'dir') {
        throw new Error(`Cannot overwrite directory: ${finalDest}`);
      }
      table.entries.splice(existingIdx, 1);
    }

    const { parent, name } = splitPath(finalDest);
    ensureDirsInTable(table, parent);

    entry.path = finalDest;
    entry.name = name;
    entry.parent = parent;

    if (entry.type === 'dir') {
      const oldPrefix = src + '/';
      for (const child of table.entries) {
        if (child.path.startsWith(oldPrefix)) {
          child.path = finalDest + child.path.slice(src.length);
          child.parent = splitPath(child.path).parent;
        }
      }
    }

    saveTable(table);
  },

  statFs() {
    const raw = dec.decode(HW.readSectors(TABLE_START, TABLE_SECTORS)).replace(/\0+$/, '');
    const table = JSON.parse(raw);

    const sectorSize = HW.sectorSize;
    const totalBytes = HW.diskSize || 2 * 1024 * 1024;
    const totalSectors = Math.floor(totalBytes / sectorSize);
    const highWaterSector = computeHighWaterSector(table.entries);

    let allocatedDataSectors = 0;
    for (const e of table.entries) {
      if (e.type === 'file' && typeof e.start === 'number' && typeof e.size === 'number') {
        allocatedDataSectors += sectorsFor(e.size);
      }
    }

    const usedSectors = DATA_START + allocatedDataSectors;
    const freeSectors = Math.max(0, totalSectors - usedSectors);

    const fileCount = table.entries.filter((e) => e.type === 'file').length;
    const dirCount = table.entries.filter((e) => e.type === 'dir').length;

    return {
      sectorSize,
      totalSectors,
      usedSectors,
      freeSectors,
      highWaterSector,
      totalBytes,
      usedBytes: usedSectors * sectorSize,
      freeBytes: freeSectors * sectorSize,
      tableBytes: enc.encode(raw).length,
      tableMaxBytes: TABLE_MAX_BYTES,
      fileCount,
      dirCount,
    };
  },

  remove(path, recursive = false) {
    const resolved = OS.resolvePath(path);
    if (resolved === '/') throw new Error('Cannot remove root directory');

    const table = loadTable();
    const entry = table.entries.find((e) => e.path === resolved);
    if (!entry) throw new Error(`No such file or directory: ${resolved}`);

    if (entry.type === 'dir') {
      const prefix = resolved + '/';
      const hasChildren = table.entries.some((e) => e.path.startsWith(prefix));
      if (hasChildren && !recursive) {
        throw new Error(`Directory not empty: ${resolved}`);
      }
      table.entries = table.entries.filter(
        (e) => e.path !== resolved && !e.path.startsWith(prefix)
      );
    } else {
      table.entries = table.entries.filter((e) => e.path !== resolved);
    }

    saveTable(table);
  },

  defrag() {
    const table = loadTable();
    const oldNextSector = computeHighWaterSector(table.entries);

    const files = table.entries
      .filter((e) => e.type === 'file')
      .map((entry) => {
        const sectors = sectorsFor(entry.size);
        const data = HW.readSectors(entry.start, sectors);
        return { entry, sectors, data };
      });

    let nextSector = DATA_START;
    for (const file of files) {
      HW.writeSectors(nextSector, file.data);
      file.entry.start = nextSector;
      nextSector += file.sectors;
    }

    const reclaimedSectors = Math.max(0, oldNextSector - nextSector);
    if (reclaimedSectors > 0) {
      HW.writeSectors(nextSector, new Uint8Array(reclaimedSectors * HW.sectorSize));
    }

    table.nextSector = nextSector;
    saveTable(table);

    return {
      filesPacked: files.length,
      oldNextSector,
      newNextSector: nextSector,
      reclaimedSectors,
      reclaimedBytes: reclaimedSectors * HW.sectorSize,
    };
  },
};

// --- 2. 60HZ FRAME LOOP & EXECUTION ENGINE ---

let frameWaiters = [];

HW.onTick = () => {
  const waiters = frameWaiters;
  frameWaiters = [];
  for (const resolve of waiters) resolve();
};

const OS = {
  fs,
  width: HW.width,
  height: HW.height,
  vram: HW.vram,
  log: HW.log,
  cwd: '/',
  stdin: null,
  modules: {},

  require(path) {
    const resolved = this.resolvePath(path);
    if (this.modules[resolved]) return this.modules[resolved];

    const code = fs.read(resolved);
    if (code === null) throw new Error(`Missing library: ${resolved}`);

    const module = { exports: {} };
    const fn = new Function('OS', 'HW', 'module', 'exports', `"use strict";\n${code}`);
    fn(OS, HW, module, module.exports);

    this.modules[resolved] = module.exports;
    return module.exports;
  },

  resolvePath(input = '') {
    if (!input) return this.cwd;
    const parts = input.startsWith('/') ? [] : this.cwd.split('/').filter(Boolean);

    for (const part of input.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') parts.pop();
      else parts.push(part);
    }
    return '/' + parts.join('/');
  },

  pollKey() {
    return HW.pollKey();
  },

  nextFrame() {
    return new Promise((resolve) => frameWaiters.push(resolve));
  },

  async exec(path, args = [], env = {}) {
    const code = fs.read(path);
    if (code === null) {
      throw new Error(`OS.exec: File not found: ${path}`);
    }
    const program = new AsyncFunction('OS', 'args', 'env', 'HW', `"use strict";\n${code}`);
    return await program(OS, args, { ...env }, HW);
  },
};

// --- 3. KERNEL BOOT SEQUENCE ---

(async function boot() {
  OS.log('KERNEL: OS.fs & OS.exec online.');

  await OS.exec('/sys/gfx.js');
  await OS.exec('/sys/tty.js');
  await OS.exec('/bin/shell.js');
})();