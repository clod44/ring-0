// 8x8 Bitmap Font (ASCII 32..126) — each char is 8 rows of 8-bit hex
const RAW_FONT = {
  ' ': '0000000000000000', '!': '183C3C1818001800', '"': '3636000000000000',
  '#': '36367F367F363600', '$': '0C3E031E301F0C00', '%': '006333180C666300',
  '&': '1C361C6E3B336E00', "'": '0606030000000000', '(': '180C0606060C1800',
  ')': '060C1818180C0600', '*': '00663CFF3C660000', '+': '000C0C3F0C0C0000',
  ',': '00000000000C0C06', '-': '0000003F00000000', '.': '00000000000C0C00',
  '/': '6030180C06030100', '0': '3E63737B6F673E00', '1': '0C0E0C0C0C0C3F00',
  '2': '1E33301C06333F00', '3': '1E33301C30331E00', '4': '383C36337F307800',
  '5': '3F031F3030331E00', '6': '1C06031F33331E00', '7': '3F3330180C0C0C00',
  '8': '1E33331E33331E00', '9': '1E33333E30180E00', ':': '000C0C00000C0C00',
  ';': '000C0C00000C0C06', '<': '180C0603060C1800', '=': '00003F00003F0000',
  '>': '060C1830180C0600', '?': '1E3330180C000C00', '@': '3E637B7B7B031E00',
  'A': '0C1E33333F333300', 'B': '3F66663E66663F00', 'C': '3C66030303663C00',
  'D': '1F36666666361F00', 'E': '7F46161E16467F00', 'F': '7F46161E16060F00',
  'G': '3C66030373667C00', 'H': '3333333F33333300', 'I': '1E0C0C0C0C0C1E00',
  'J': '7830303033331E00', 'K': '6766361E36666700', 'L': '0F06060646667F00',
  'M': '63777F7F6B636300', 'N': '63676F7B73636300', 'O': '1C36636363361C00',
  'P': '3F66663E06060F00', 'Q': '1E3333333B1E3800', 'R': '3F66663E36666700',
  'S': '1E33070E38331E00', 'T': '3F2D0C0C0C0C1E00', 'U': '3333333333333F00',
  'V': '33333333331E0C00', 'W': '6363636B7F776300', 'X': '6363361C1C366300',
  'Y': '3333331E0C0C1E00', 'Z': '7F6331184C667F00', '[': '1E06060606061E00',
  '\\': '03060C1830604000', ']': '1E18181818181E00', '^': '081C366300000000',
  '_': '00000000000000FF', '`': '0C0C180000000000', 'a': '00001E303E336E00',
  'b': '0706063E66663B00', 'c': '00001E3303331E00', 'd': '3830303E33336E00',
  'e': '00001E333F031E00', 'f': '1C36060F06060F00', 'g': '00006E33333E301F',
  'h': '0706366E66666700', 'i': '0C000E0C0C0C1E00', 'j': '300030303033331E',
  'k': '070666361E366700', 'l': '0E0C0C0C0C0C1E00', 'm': '0000337F7F6B6300',
  'n': '00001F3333333300', 'o': '00001E3333331E00', 'p': '00003B66663E060F',
  'q': '00006E33333E3078', 'r': '00003B6E66060F00', 's': '00003E031E301F00',
  't': '080C3E0C0C2C1800', 'u': '0000333333336E00', 'v': '00003333331E0C00',
  'w': '0000636B7F7F3600', 'x': '000063361C366300', 'y': '00003333333E301F',
  'z': '00003F190C263F00', '{': '380C0C070C0C3800', '|': '1818180018181800',
  '}': '070C0C380C0C0700', '~': '6E3B000000000000',
};

// Pre-decode hex glyphs into Uint8Array(8) once at boot
const FONT = {};
for (const [ch, hex] of Object.entries(RAW_FONT)) {
  const rows = new Uint8Array(8);
  for (let r = 0; r < 8; r++) {
    rows[r] = parseInt(hex.slice(r * 2, r * 2 + 2), 16);
  }
  FONT[ch] = rows;
}

const W = OS.width;
const H = OS.height;
const vram = OS.vram;

const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];
const toCube = (v) => (v < 48 ? 0 : v < 115 ? 1 : Math.min(5, ((v - 35) / 40) | 0));

function hline(x0, x1, y, color) {
  if (y < 0 || y >= H) return;
  const start = Math.max(0, x0 | 0);
  const end = Math.min(W - 1, x1 | 0);
  if (start > end) return;
  vram.fill(color, y * W + start, y * W + end + 1);
}

OS.gfx = {
  clear(color = 0) {
    vram.fill(color);
  },

  pixel(x, y, color) {
    x = x | 0;
    y = y | 0;
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    vram[y * W + x] = color;
  },

  rect(x, y, w, h, color, fill = true) {
    x = x | 0;
    y = y | 0;
    w = w | 0;
    h = h | 0;
    if (w <= 0 || h <= 0) return;

    if (fill) {
      const x0 = Math.max(0, x);
      const y0 = Math.max(0, y);
      const x1 = Math.min(W, x + w);
      const y1 = Math.min(H, y + h);
      for (let row = y0; row < y1; row++) {
        vram.fill(color, row * W + x0, row * W + x1);
      }
    } else {
      hline(x, x + w - 1, y, color);
      hline(x, x + w - 1, y + h - 1, color);
      this.line(x, y, x, y + h - 1, color);
      this.line(x + w - 1, y, x + w - 1, y + h - 1, color);
    }
  },

  // Bresenham's integer line algorithm
  line(x0, y0, x1, y1, color) {
    x0 = x0 | 0; y0 = y0 | 0;
    x1 = x1 | 0; y1 = y1 | 0;

    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    while (true) {
      this.pixel(x0, y0, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx)  { err += dx; y0 += sy; }
    }
  },

  // Midpoint circle algorithm (wireframe or filled)
  circle(cx, cy, r, color, fill = false) {
    cx = cx | 0; cy = cy | 0; r = r | 0;
    let x = r;
    let y = 0;
    let err = 1 - x;

    while (x >= y) {
      if (fill) {
        hline(cx - x, cx + x, cy + y, color);
        hline(cx - x, cx + x, cy - y, color);
        hline(cx - y, cx + y, cy + x, color);
        hline(cx - y, cx + y, cy - x, color);
      } else {
        this.pixel(cx + x, cy + y, color);
        this.pixel(cx + y, cy + x, color);
        this.pixel(cx - y, cy + x, color);
        this.pixel(cx - x, cy + y, color);
        this.pixel(cx - x, cy - y, color);
        this.pixel(cx - y, cy - x, color);
        this.pixel(cx + y, cy - x, color);
        this.pixel(cx + x, cy - y, color);
      }
      y++;
      if (err < 0) {
        err += 2 * y + 1;
      } else {
        x--;
        err += 2 * (y - x + 1);
      }
    }
  },

  drawChar(ch, x, y, fg = 15, bg = -1) {
    const glyph = FONT[ch] || FONT['?'];
    for (let row = 0; row < 8; row++) {
      const py = y + row;
      if (py < 0 || py >= H) continue;
      const bits = glyph[row];
      const rowOffset = py * W;

      for (let col = 0; col < 8; col++) {
        const px = x + col;
        if (px < 0 || px >= W) continue;
        if ((bits >> col) & 1) {
          vram[rowOffset + px] = fg;
        } else if (bg >= 0) {
          vram[rowOffset + px] = bg;
        }
      }
    }
  },

  drawText(text, x, y, fg = 15, bg = -1) {
    let cx = x;
    for (let i = 0; i < text.length; i++) {
      this.drawChar(text[i], cx, y, fg, bg);
      cx += 8;
    }
  },

  // Maps any (0..255) RGB triplet to the nearest xterm-256 index
  rgb(r, g, b) {
    const cr = toCube(r);
    const cg = toCube(g);
    const cb = toCube(b);
    const cubeIdx = 16 + 36 * cr + 6 * cg + cb;

    const dr = r - CUBE_LEVELS[cr];
    const dg = g - CUBE_LEVELS[cg];
    const db = b - CUBE_LEVELS[cb];
    const cubeDist = dr * dr + dg * dg + db * db;

    const avg = (r + g + b) / 3;
    const gi = Math.max(0, Math.min(23, Math.round((avg - 8) / 10)));
    const gv = 8 + gi * 10;
    const grayDist = (r - gv) ** 2 + (g - gv) ** 2 + (b - gv) ** 2;

    return grayDist < cubeDist ? 232 + gi : cubeIdx;
  },
};