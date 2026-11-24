import './style.css';
import { Display } from './hw/display';
import { createFactoryDisk } from './bios/packer';
import { initDiskInspector } from './ui/diskInspector';

const display = new Display('screen');
const screenEl = document.getElementById('screen') as HTMLCanvasElement;
const kbdProxy = document.getElementById('kbd-proxy') as HTMLInputElement | null;
const ctrlBtn = document.getElementById('ctrl-toggle') as HTMLButtonElement | null;
const mobileKeysEl = document.getElementById('mobile-keys');
const resetBtn = document.getElementById('reset-btn')!;
const rebootBtn = document.getElementById('reboot-btn')!;

let worker: Worker | null = null;
let stickyCtrl = false;

// Initialize inspector ONCE
const inspector = initDiskInspector(createFactoryDisk(), () => {
  worker?.postMessage({ type: 'GET_DISK' });
});

function setStickyCtrl(active: boolean) {
  stickyCtrl = active;
  ctrlBtn?.classList.toggle('border-emerald-500', stickyCtrl);
  ctrlBtn?.classList.toggle('text-emerald-400', stickyCtrl);
}

function sendKey(key: string, opts?: { ctrl?: boolean }) {
  if (!worker) return;
  if (opts?.ctrl) {
    worker.postMessage({ type: 'KEY', key, ctrl: true });
    setStickyCtrl(false);
  } else {
    worker.postMessage({ type: 'KEY', key });
  }
}

function focusInput() {
  if (kbdProxy) {
    kbdProxy.focus({ preventScroll: true });
  } else {
    screenEl.focus({ preventScroll: true });
  }
}

function bootMachine(existingDisk?: Uint8Array) {
  if (worker) {
    worker.terminate();
  }

  setStickyCtrl(false);

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

  focusInput();
}

// Tapping the canvas focuses the hidden input so mobile keyboards open
screenEl.addEventListener('pointerdown', () => {
  focusInput();
});

// Sticky CTRL toggle for mobile touch workflows
ctrlBtn?.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  setStickyCtrl(!stickyCtrl);
  focusInput();
});

// Mobile touch helper keys (ESC, TAB, arrows)
mobileKeysEl?.addEventListener('pointerdown', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-key]');
  if (!btn) return;
  e.preventDefault();
  sendKey(btn.dataset.key!);
  focusInput();
});

// Handle keys from either #kbd-proxy or #screen
const handleKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Unidentified' || e.key === 'Process') return;

  if (stickyCtrl && e.key.length === 1) {
    e.preventDefault();
    sendKey(e.key, { ctrl: true });
    return;
  }

  // Let printable characters on #kbd-proxy flow through 'input' so mobile IMEs/autocorrect don't double-fire
  const targetIsProxy = e.target === kbdProxy;
  const isModified = e.ctrlKey || e.metaKey || e.altKey;
  if (!targetIsProxy || e.key.length > 1 || isModified) {
    e.preventDefault();
    sendKey(e.key, { ctrl: e.ctrlKey });
  }
};

kbdProxy?.addEventListener('keydown', handleKeyDown);
screenEl.addEventListener('keydown', handleKeyDown);

// Mobile virtual keyboard character input
kbdProxy?.addEventListener('input', () => {
  if (!kbdProxy) return;
  const val = kbdProxy.value;
  kbdProxy.value = '';

  for (const ch of val) {
    sendKey(ch, { ctrl: stickyCtrl });
  }
});

resetBtn.addEventListener('click', () => bootMachine());
rebootBtn.addEventListener('click', () => {
  worker?.postMessage({ type: 'REQUEST_REBOOT' });
});

bootMachine();