import "./style.css";
import { Display } from "./hw/display";
import { createFactoryDisk } from "./bios/packer";
import { initDiskInspector } from "./ui/diskInspector";
import { initInputBridge } from "./ui/input";
import { initDiskIo } from "./ui/diskIo";

const buildLabel = `${__BUILD_SHA__} · ${__BUILD_MSG__}`;
document.title = `RING-0 // ${__BUILD_SHA__}`;

const buildEl = document.getElementById("build-info");
if (buildEl) {
  buildEl.textContent = buildLabel;
  buildEl.title = buildLabel;
}

const display = new Display("screen");
const screenEl = document.getElementById("screen") as HTMLCanvasElement;
const resetBtn = document.getElementById("reset-btn")!;
const rebootBtn = document.getElementById("reboot-btn")!;

let worker: Worker | null = null;
const initialDisk = createFactoryDisk();

const inspector = initDiskInspector(initialDisk, () => {
  worker?.postMessage({ type: "GET_DISK" });
});

const diskIo = initDiskIo({
  expectedSize: initialDisk.byteLength,
  downloadBtn: document.getElementById("download-disk-btn") as
    | HTMLButtonElement
    | null,
  uploadBtn: document.getElementById("upload-disk-btn") as
    | HTMLButtonElement
    | null,
  fileInput: document.getElementById("disk-file-input") as
    | HTMLInputElement
    | null,
  requestSnapshot: () => worker?.postMessage({ type: "GET_DISK" }),
  onImportDisk: (disk) => bootMachine(disk),
});

const input = initInputBridge({
  screenEl,
  kbdProxy: document.getElementById("kbd-proxy") as HTMLInputElement | null,
  ctrlBtn: document.getElementById("ctrl-toggle") as HTMLButtonElement | null,
  mobileKeysEl: document.getElementById("mobile-keys"),
  onKey: (key, opts) => {
    if (!worker) return;
    worker.postMessage(
      opts?.ctrl ? { type: "KEY", key, ctrl: true } : { type: "KEY", key },
    );
  },
});

function bootMachine(existingDisk?: Uint8Array) {
  worker?.terminate();
  input.resetModifiers();

  worker = new Worker(new URL("./bios/worker.ts", import.meta.url), {
    type: "module",
  });

  worker.onmessage = (e: MessageEvent) => {
    if (e.data.type === "FRAME") {
      display.render(e.data.vram);
    } else if (e.data.type === "DISK_SNAPSHOT") {
      inspector.updateDisk(e.data.disk);
      diskIo.setDisk(e.data.disk);
    } else if (e.data.type === "REBOOT") {
      bootMachine(e.data.disk);
    }
  };

  const disk = existingDisk ?? createFactoryDisk();
  inspector.updateDisk(disk);
  diskIo.setDisk(disk);
  worker.postMessage({ type: "BOOT", disk });

  input.focusInput();
}

resetBtn.addEventListener("click", () => bootMachine());
rebootBtn.addEventListener("click", () => {
  worker?.postMessage({ type: "REQUEST_REBOOT" });
});

bootMachine(initialDisk);
