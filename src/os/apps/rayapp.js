// Raytracer DE Window App

const BAYER = [
    -0.5, 0.0, -0.375, 0.125, 0.25, -0.25, 0.375, -0.125, -0.3125, 0.1875, -0.4375, 0.0625, 0.4375,
    -0.0625, 0.3125, -0.1875,
];

const CAMERAS = [
    { name: 'FRONT', ox: 0.0, oy: 1.2, oz: -3.2, pitch: -0.12 },
    { name: 'HIGH', ox: 0.0, oy: 2.35, oz: -3.4, pitch: -0.42 },
    { name: 'LOW', ox: 0.0, oy: 0.45, oz: -2.9, pitch: 0.08 },
];

const TOOLBAR_H = 14;

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

    if (hitType === 0) {
        const sky = Math.max(0, 1 - dy * 1.4);
        return [sky * 0.05, sky * 0.08, sky * 0.22];
    }

    const hx = ox + dx * minT;
    const hy = oy + dy * minT;
    const hz = oz + dz * minT;

    let nx = 0;
    let ny = 1;
    let nz = 0;
    let cr = 0;
    let cg = 0;
    let cb = 0;
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
            cr = 0.85;
            cg = 0.85;
            cb = 0.85;
        } else {
            cr = 0.15;
            cg = 0.2;
            cb = 0.28;
        }
        reflect = 0.28;
    }

    let lx = light.x - hx;
    let ly = light.y - hy;
    let lz = light.z - hz;
    const lDist = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1;
    lx /= lDist;
    ly /= lDist;
    lz /= lDist;

    let inShadow = false;
    for (let i = 0; i < spheres.length; i++) {
        const s = spheres[i];
        const st = hitSphere(
            hx + nx * 0.002,
            hy + ny * 0.002,
            hz + nz * 0.002,
            lx,
            ly,
            lz,
            s.x,
            s.y,
            s.z,
            s.r,
        );
        if (st > 0 && st < lDist) {
            inShadow = true;
            break;
        }
    }

    const diff = inShadow ? 0 : Math.max(0, nx * lx + ny * ly + nz * lz);

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

    if (reflect > 0 && depth > 0) {
        const dot = dx * nx + dy * ny + dz * nz;
        const rdx = dx - 2 * dot * nx;
        const rdy = dy - 2 * dot * ny;
        const rdz = dz - 2 * dot * nz;
        const [rr, rg, rb] = trace(
            hx + nx * 0.002,
            hy + ny * 0.002,
            hz + nz * 0.002,
            rdx,
            rdy,
            rdz,
            spheres,
            light,
            depth - 1,
        );
        r = r * (1 - reflect) + rr * reflect;
        g = g * (1 - reflect) + rg * reflect;
        b = b * (1 - reflect) + rb * reflect;
    }

    if (hitType === 2) {
        const fog = Math.max(0, 1 - minT / 15);
        r *= fog;
        g *= fog;
        b *= fog;
    }

    return [r, g, b];
}

function buildSpheres(t) {
    return [
        {
            x: Math.sin(t * 0.7) * 0.45,
            y: 0.75 + Math.abs(Math.sin(t * 1.8)) * 0.5,
            z: 0.2,
            r: 0.7,
            rgb: [1.0, 0.7, 0.15],
            reflect: 0.45,
        },
        {
            x: Math.cos(t * 1.1) * 1.5,
            y: 0.42,
            z: 0.5 + Math.sin(t * 1.1) * 1.1,
            r: 0.4,
            rgb: [0.95, 0.18, 0.25],
            reflect: 0.25,
        },
        {
            x: Math.cos(t * 1.1 + Math.PI) * 1.35,
            y: 0.35,
            z: 0.5 + Math.sin(t * 1.1 + Math.PI) * 1.0,
            r: 0.32,
            rgb: [0.15, 0.85, 0.95],
            reflect: 0.35,
        },
    ];
}

function createApp(win) {
    let step = 2;
    let t = 0;
    let paused = false;
    let camIdx = 0;
    let buttons = [];

    function getButtons(w) {
        const pauseLabel = paused ? 'PLAY' : 'PAUSE';
        const resLabel = `${step}X`;
        const camLabel = CAMERAS[camIdx].name;

        const defs = [
            { id: 'pause', label: pauseLabel, bg: paused ? 2 : 1 },
            { id: 'res', label: resLabel, bg: 1 },
            { id: 'cam', label: camLabel, bg: 1 },
        ];

        const list = [];
        let x = 3;
        const y = 2;
        const h = 10;

        for (const d of defs) {
            const bw = d.label.length * 8 + 6;
            if (x + bw > w.w - 2) break;
            list.push({ id: d.id, label: d.label, x, y, w: bw, h, bg: d.bg });
            x += bw + 4;
        }
        return list;
    }

    function drawToolbar(w, gfx) {
        gfx.rect(0, 0, w.w, TOOLBAR_H, 0, true);
        gfx.line(0, TOOLBAR_H - 1, w.w - 1, TOOLBAR_H - 1, 8);

        buttons = getButtons(w);
        for (const b of buttons) {
            gfx.rect(b.x, b.y, b.w, b.h, b.bg, true);
            gfx.rect(b.x, b.y, b.w, b.h, 15, false);
            gfx.drawText(b.label, b.x + 3, b.y + 1, 15, -1);
        }
    }

    return {
        init(w) {
            w.invalidate();
        },

        onResize(w) {
            w.invalidate();
        },

        onMouse(ev, w) {
            if (ev.action !== 'down') return false;

            for (const b of buttons) {
                if (ev.x >= b.x && ev.x < b.x + b.w && ev.y >= b.y && ev.y < b.y + b.h) {
                    if (b.id === 'pause') {
                        paused = !paused;
                    } else if (b.id === 'res') {
                        step = step === 2 ? 1 : step === 1 ? 4 : 2;
                    } else if (b.id === 'cam') {
                        camIdx = (camIdx + 1) % CAMERAS.length;
                    }
                    w.invalidate();
                    return true;
                }
            }
            return false;
        },

        update(dt, w) {
            if (!paused) {
                t += Math.min(0.15, dt * 2.2);
                w.invalidate();
            }
        },

        render(w, api) {
            const gfx = (api && api.gfx) || OS.gfx;
            if (!gfx) return;

            const viewW = Math.max(1, w.w | 0);
            const viewH = Math.max(1, w.h | 0);
            const sceneTop = Math.min(viewH, TOOLBAR_H);
            const sceneH = Math.max(0, viewH - sceneTop);
            const aspect = viewW / Math.max(1, sceneH);
            const cam = CAMERAS[camIdx];

            gfx.clear(0);

            if (sceneH > 0) {
                const spheres = buildSpheres(t);
                const light = {
                    x: Math.cos(t * 0.5) * 3.5,
                    y: 4.0,
                    z: Math.sin(t * 0.5) * 3.5 - 1.0,
                };

                for (let py = 0; py < sceneH; py += step) {
                    const v = 1 - ((py + 0.5) / sceneH) * 2;
                    for (let px = 0; px < viewW; px += step) {
                        const u = (((px + 0.5) / viewW) * 2 - 1) * aspect;

                        let dx = u;
                        let dy = v + cam.pitch;
                        let dz = 1.6;
                        const invLen = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
                        dx *= invLen;
                        dy *= invLen;
                        dz *= invLen;

                        const [r, g, b] = trace(
                            cam.ox,
                            cam.oy,
                            cam.oz,
                            dx,
                            dy,
                            dz,
                            spheres,
                            light,
                            1,
                        );
                        const col = rgbToXterm(
                            r,
                            g,
                            b,
                            Math.floor(px / step),
                            Math.floor(py / step),
                        );

                        if (step === 1) {
                            gfx.pixel(px, sceneTop + py, col);
                        } else {
                            const bw = Math.min(step, viewW - px);
                            const bh = Math.min(step, sceneH - py);
                            gfx.rect(px, sceneTop + py, bw, bh, col, true);
                        }
                    }
                }
            }

            drawToolbar(w, gfx);
        },

        destroy() {
            buttons = [];
        },
    };
}

module.exports = { createApp };
