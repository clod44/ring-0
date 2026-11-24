import './style.css';
import { Display } from './hw/display';
import { createFactoryDisk } from './bios/packer';
import { initDiskInspector } from './ui/diskInspector.ts';

const display = new Display('screen');
const screenEl = document.getElementById('screen')!;
const resetBtn = document.getElementById('reset-btn')!;
const rebootBtn = document.getElementById('reboot-btn')!;

let worker: Worker | null = null;

// Initialize inspector ONCE
const inspector = initDiskInspector(createFactoryDisk(), () => {
  worker?.postMessage({ type: 'GET_DISK' });
});



function bootMachine(existingDisk?: Uint8Array) {
  if (worker) {
    worker.terminate();
  }

  worker = new Worker(new URL('./bios/worker.ts', import.meta.url), {
    type: 'module',
  });

  worker.onmessage = (e: MessageEvent) => {
    if (e.data.type === 'FRAME') {
      display.render(e.data.vram);
    } else if (e.data.type === 'DISK_SNAPSHOT') {
      inspector.updateDisk(e.data.disk);
    } else if (e.data.type === 'REBOOT') {
      bootMachine(e.data.disk);
    }
  };

  const disk = existingDisk ?? createFactoryDisk();
  inspector.updateDisk(disk);
  worker.postMessage({ type: 'BOOT', disk });

  screenEl.focus();
}

screenEl.addEventListener('keydown', (e) => {
  e.preventDefault();
  worker?.postMessage({ type: 'KEY', key: e.key });
});

resetBtn.addEventListener('click', () => bootMachine());
rebootBtn.addEventListener('click', () => {
  worker?.postMessage({ type: 'REQUEST_REBOOT' });
});

bootMachine();




