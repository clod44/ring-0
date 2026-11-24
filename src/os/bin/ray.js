const W = OS.width || 320;
const H = OS.height || 240;
const vram = OS.vram;
const aspect = W / H;

// 4x4 Bayer matrix (-0.5..+0.5) for subtle color-cube dithering
const BAYER = [
  -0.50,  0.00, -0.375,  0.125,
   0.25, -0.25,  0.375, -0.125,
  -0.3125, 0.1875, -0.4375, 0.0625,
   0.4375, -0.0625, 0.3125, -0.1875,
];

// Fast RGB (0..1) -> xterm-256 6x6x6 cube index with subtle dithering
function rgbToXterm(r, g, b, x, y) {
  const d = BAYER[((y & 3) << 2) | (x & 3)] * 0.12;
  const cr = Math.max(0, Math.min(5, Math.round((r + d) * 5)));
  const cg = Math.max(0, Math.min(5, Math.round((g + d) * 5)));
  const cb = Math.max(0, Math.min(5, Math.round((b + d) * 5)));
  return 16 + 36 * cr + 6 * cg + cb;
}

function hitSphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = ox - cx;
  const ly = oy - cy;
  const lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t > 0.001 ? t : -1;
}

function trace(ox, oy, oz, dx, dy, dz, spheres, light, depth) {
  let minT = 1e9;
  let hitType = 0; // 0 = sky, 1 = sphere, 2 = floor
  let hitIdx = -1;

  for (let i = 0; i < spheres.length; i++) {
    const s = spheres[i];
    const t = hitSphere(ox, oy, oz, dx, dy, dz, s.x, s.y, s.z, s.r);
    if (t > 0 && t < minT) {
      minT = t;
      hitType = 1;
      hitIdx = i;
    }
  }

  if (dy < -0.0001) {
    const t = -oy / dy;
    if (t > 0.001 && t < minT) {
      minT = t;
      hitType = 2;
    }
  }

  // Deep midnight-blue sky gradient
  if (hitType === 0) {
    const sky = Math.max(0, 1 - dy * 1.4);
    return [sky * 0.05, sky * 0.08, sky * 0.22];
  }

  const hx = ox + dx * minT;
  const hy = oy + dy * minT;
  const hz = oz + dz * minT;

  let nx = 0, ny = 1, nz = 0;
  let cr = 0, cg = 0, cb = 0;
  let reflect = 0;

  if (hitType === 1) {
    const s = spheres[hitIdx];
    nx = (hx - s.x) / s.r;
    ny = (hy - s.y) / s.r;
    nz = (hz - s.z) / s.r;
    [cr, cg, cb] = s.rgb;
    reflect = s.reflect;
  } else {
    const checker = (Math.floor(hx * 1.4) + Math.floor(hz * 1.4)) & 1;
    if (checker) {
      cr = 0.85; cg = 0.85; cb = 0.85;
    } else {
      cr = 0.15; cg = 0.20; cb = 0.28;
    }
    reflect = 0.28;
  }

  // Vector to light
  let lx = light.x - hx;
  let ly = light.y - hy;
  let lz = light.z - hz;
  const lDist = Math.sqrt(lx * lx + ly * ly + lz * lz);
  lx /= lDist;
  ly /= lDist;
  lz /= lDist;

  // Hard shadow check
  let inShadow = false;
  for (let i = 0; i < spheres.length; i++) {
    const s = spheres[i];
    const st = hitSphere(
      hx + nx * 0.002, hy + ny * 0.002, hz + nz * 0.002,
      lx, ly, lz,
      s.x, s.y, s.z, s.r
    );
    if (st > 0 && st < lDist) {
      inShadow = true;
      break;
    }
  }

  const diff = inShadow ? 0 : Math.max(0, nx * lx + ny * ly + nz * lz);

  // White specular highlight
  let spec = 0;
  if (!inShadow && hitType === 1) {
    const rDot = 2 * (nx * lx + ny * ly + nz * lz);
    const rx = rDot * nx - lx;
    const ry = rDot * ny - ly;
    const rz = rDot * nz - lz;
    const sDot = Math.max(0, -(rx * dx + ry * dy + rz * dz));
    spec = Math.pow(sDot, 20) * 0.85;
  }

  const shade = 0.18 + diff * 0.82;
  let r = cr * shade + spec;
  let g = cg * shade + spec;
  let b = cb * shade + spec;

  // 1-bounce reflection
  if (reflect > 0 && depth > 0) {
    const dot = dx * nx + dy * ny + dz * nz;
    const rdx = dx - 2 * dot * nx;
    const rdy = dy - 2 * dot * ny;
    const rdz = dz - 2 * dot * nz;
    const [rr, rg, rb] = trace(
      hx + nx * 0.002, hy + ny * 0.002, hz + nz * 0.002,
      rdx, rdy, rdz,
      spheres, light, depth - 1
    );
    r = r * (1 - reflect) + rr * reflect;
    g = g * (1 - reflect) + rg * reflect;
    b = b * (1 - reflect) + rb * reflect;
  }

  // Distance fog on the floor
  if (hitType === 2) {
    const fog = Math.max(0, 1 - minT / 15);
    r *= fog;
    g *= fog;
    b *= fog;
  }

  return [r, g, b];
}

// --- Main Loop ---

let step = 2;
let t = 0;
let paused = false;

OS.gfx.clear(0);

while (true) {
  let key;
  while ((key = OS.pollKey()) !== null) {
    if (key === 'Escape' || key === 'q') {
      OS.tty.clear(0);
      return 0;
    }
    if (key === ' ') {
      step = step === 1 ? 4 : step === 4 ? 2 : 1;
    }
    if (key === 'p') {
      paused = !paused;
    }
  }

  if (!paused) t += 0.08;

  const spheres = [
    // Bouncing reflective gold/amber sphere
    {
      x: Math.sin(t * 0.7) * 0.45,
      y: 0.75 + Math.abs(Math.sin(t * 1.8)) * 0.5,
      z: 0.2,
      r: 0.7,
      rgb: [1.0, 0.7, 0.15],
      reflect: 0.45,
    },
    // Orbiting crimson sphere
    {
      x: Math.cos(t * 1.1) * 1.5,
      y: 0.42,
      z: 0.5 + Math.sin(t * 1.1) * 1.1,
      r: 0.4,
      rgb: [0.95, 0.18, 0.25],
      reflect: 0.25,
    },
    // Orbiting cyan sphere
    {
      x: Math.cos(t * 1.1 + Math.PI) * 1.35,
      y: 0.35,
      z: 0.5 + Math.sin(t * 1.1 + Math.PI) * 1.0,
      r: 0.32,
      rgb: [0.15, 0.85, 0.95],
      reflect: 0.35,
    },
  ];

  const light = {
    x: Math.cos(t * 0.5) * 3.5,
    y: 4.0,
    z: Math.sin(t * 0.5) * 3.5 - 1.0,
  };

  for (let py = 0; py < H; py += step) {
    const v = 1 - ((py + 0.5) / H) * 2;
    for (let px = 0; px < W; px += step) {
      const u = (((px + 0.5) / W) * 2 - 1) * aspect;

      let dx = u;
      let dy = v - 0.12;
      let dz = 1.6;
      const invLen = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz);
      dx *= invLen;
      dy *= invLen;
      dz *= invLen;

      const [r, g, b] = trace(0, 1.2, -3.2, dx, dy, dz, spheres, light, 1);
      const col = rgbToXterm(r, g, b, px / step, py / step);

      if (step === 1) {
        vram[py * W + px] = col;
      } else {
        for (let oy = 0; oy < step && py + oy < H; oy++) {
          const row = (py + oy) * W + px;
          for (let ox = 0; ox < step && px + ox < W; ox++) {
            vram[row + ox] = col;
          }
        }
      }
    }
  }

  OS.gfx.drawText(`RAYTRACER [${step}x${step}]  SPACE:RES  P:PAUSE  Q:EXIT`, 4, 4, 15, 0);

  await OS.nextFrame();
}