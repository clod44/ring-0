import { SCREEN_HEIGHT, SCREEN_WIDTH, VRAM_SIZE } from "./config.ts";

export class Display {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private imageData: ImageData;
    private rgba32: Uint32Array;

    // 256-color palette stored as ABGR 32-bit integers for fast blitting
    public palette = new Uint32Array(256);

    constructor(canvasId: string) {
        const el = document.getElementById(canvasId);
        if (!(el instanceof HTMLCanvasElement)) {
            throw new Error(`Canvas #${canvasId} not found`);
        }

        this.canvas = el;
        // Lock the internal buffer resolution
        this.canvas.width = SCREEN_WIDTH;
        this.canvas.height = SCREEN_HEIGHT;

        const ctx = this.canvas.getContext("2d", { alpha: false });
        if (!ctx) throw new Error("Could not initialize 2D context");
        this.ctx = ctx;

        this.imageData = this.ctx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
        // View the underlying RGBA buffer as 32-bit integers (1 write per pixel!)
        this.rgba32 = new Uint32Array(this.imageData.data.buffer);

        this.initDefaultPalette();
        this.canvas.focus();
    }

    private initDefaultPalette() {
        // 0-15: Standard 16 ANSI colors
        const ansi: [number, number, number][] = [
            [0, 0, 0], // 0:  Black
            [128, 0, 0], // 1:  Maroon (Dark Red)
            [0, 128, 0], // 2:  Green
            [128, 128, 0], // 3:  Olive (Dark Yellow)
            [0, 0, 128], // 4:  Navy (Dark Blue)
            [128, 0, 128], // 5:  Purple
            [0, 128, 128], // 6:  Teal
            [192, 192, 192], // 7:  Silver (Light Gray)
            [128, 128, 128], // 8:  Gray (Dark Gray)
            [255, 0, 0], // 9:  Bright Red
            [0, 255, 0], // 10: Bright Green
            [255, 255, 0], // 11: Yellow
            [0, 0, 255], // 12: Bright Blue
            [255, 0, 255], // 13: Magenta
            [0, 255, 255], // 14: Cyan
            [255, 255, 255], // 15: White
        ];

        for (let i = 0; i < 16; i++) {
            this.setColor(i, ansi[i][0], ansi[i][1], ansi[i][2]);
        }

        // 16-231: 6x6x6 RGB color cube (standard xterm levels)
        const levels = [0, 95, 135, 175, 215, 255];
        let idx = 16;
        for (let r = 0; r < 6; r++) {
            for (let g = 0; g < 6; g++) {
                for (let b = 0; b < 6; b++) {
                    this.setColor(idx++, levels[r], levels[g], levels[b]);
                }
            }
        }

        // 232-255: 24-step grayscale ramp (8..238)
        for (let i = 0; i < 24; i++) {
            const v = 8 + i * 10;
            this.setColor(232 + i, v, v, v);
        }
    }

    public setColor(index: number, r: number, g: number, b: number) {
        // Little-endian ABGR layout: 0xAABBGGRR
        this.palette[index & 0xff] = (255 << 24) | (b << 16) | (g << 8) | r;
    }

    // Blits a raw 76,800-byte indexed VRAM buffer onto the canvas
    public render(vram: Uint8Array) {
        for (let i = 0; i < VRAM_SIZE; i++) {
            this.rgba32[i] = this.palette[vram[i]];
        }
        this.ctx.putImageData(this.imageData, 0, 0);
    }
}
