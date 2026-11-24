export interface DiskIoOptions {
  expectedSize: number;
  downloadBtn: HTMLButtonElement | null;
  uploadBtn: HTMLButtonElement | null;
  fileInput: HTMLInputElement | null;
  requestSnapshot: () => void;
  onImportDisk: (disk: Uint8Array) => void;
}

export function initDiskIo(opts: DiskIoOptions) {
  const {
    expectedSize,
    downloadBtn,
    uploadBtn,
    fileInput,
    requestSnapshot,
    onImportDisk,
  } = opts;

  let currentDisk = new Uint8Array(expectedSize);
  let pendingDownload = false;

  function triggerDownload(bytes: Uint8Array) {
    const copy = new Uint8Array(bytes);
    const blob = new Blob([copy], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'ring0-hd0.img';
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  downloadBtn?.addEventListener('click', () => {
    pendingDownload = true;
    requestSnapshot();
  });

  uploadBtn?.addEventListener('click', () => {
    fileInput?.click();
  });

  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;

    const uploaded = new Uint8Array(await file.arrayBuffer());
    if (uploaded.byteLength !== currentDisk.byteLength) {
      console.warn(
        `Disk size mismatch: got ${uploaded.byteLength} bytes, expected ${currentDisk.byteLength}`
      );
      return;
    }

    currentDisk = uploaded;
    onImportDisk(uploaded);
  });

  return {
    setDisk(disk: Uint8Array) {
      currentDisk = new Uint8Array(disk);
      if (pendingDownload) {
        pendingDownload = false;
        triggerDownload(currentDisk);
      }
    },
    exportNow() {
      triggerDownload(currentDisk);
    },
  };
}