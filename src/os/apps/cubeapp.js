// Software Triangle Rasterizer Tech Demo — Spinning Colored Cube (DE Window App)

const TOOLBAR_H = 14;
const PALETTE = [9, 10, 11, 12, 13, 14]; // distinct bright face colors

// --- CUBE GEOMETRY (8 vertices, 6 quad faces -> 12 triangles) ---
const VERTS = [
    [-1, -1, -1], // 0
    [1, -1, -1], // 1
    [1, 1, -1], // 2
    [-1, 1, -1], // 3
    [-1, -1, 1], // 4
    [1, -1, 1], // 5
    [1, 1, 1], // 6
    [-1, 1, 1], // 7
];

const FACES = [
    { idx: [0, 3, 2, 1], color: PALETTE[0], shade: 1.0 }, // front  (-Z)
    { idx: [5, 6, 7, 4], color: PALETTE[1], shade: 0.92 }, // back   (+Z)
    { idx: [4, 7, 3, 0], color: PALETTE[2], shade: 0.85 }, // left   (-X)
    { idx: [1, 2, 6, 5], color: PALETTE[3], shade: 0.95 }, // right  (+X)
    { idx: [3, 7, 6, 2], color: PALETTE[4], shade: 1.05 }, // top    (+Y)
    { idx: [4, 0, 1, 5], color: PALETTE[5], shade: 0.72 }, // bottom (-Y)
];

// --- 3D ROTATION & PROJECTION ---
function rotateXYZ(x, y, z, rx, ry, rz) {
    // Rotate X
    const cx = Math.cos(rx),
        sx = Math.sin(rx);
    let y1 = y * cx - z * sx;
    let z1 = y * sx + z * cx;
    let x1 = x;

    // Rotate Y
    const cy = Math.cos(ry),
        sy = Math.sin(ry);
    let x2 = x1 * cy + z1 * sy;
    let z2 = -x1 * sy + z1 * cy;
    let y2 = y1;

    // Rotate Z
    const cz = Math.cos(rz),
        sz = Math.sin(rz);
    let x3 = x2 * cz - y2 * sz;
    let y3 = x2 * sz + y2 * cz;

    return [x3, y3, z2];
}

function projectVert(v, rx, ry, rz, viewW, viewH, sceneTop) {
    const [wx, wy, wz] = rotateXYZ(v[0], v[1], v[2], rx, ry, rz);
    const camZ = 4.2;
    const pz = wz + camZ;
    if (pz <= 0.25) return null;

    const plotH = Math.max(1, viewH - sceneTop);
    const fov = Math.min(viewW, plotH) * 1.15;
    return {
        x: viewW * 0.5 + (wx / pz) * fov,
        y: sceneTop + plotH * 0.5 - (wy / pz) * fov,
        z: pz,
    };
}

// --- SOFTWARE TRIANGLE RASTERIZER WITH Z-BUFFER ---
function edgeFn(ax, ay, bx, by, cx, cy) {
    return (cx - ax) * (by - ay) - (cy - ay) * (bx - ax);
}

function rasterTriangle(gfx, zbuf, viewW, topY, botY, p0, p1, p2, color) {
    const minX = Math.max(0, Math.floor(Math.min(p0.x, p1.x, p2.x)));
    const maxX = Math.min(viewW - 1, Math.ceil(Math.max(p0.x, p1.x, p2.x)));
    const minY = Math.max(topY, Math.floor(Math.min(p0.y, p1.y, p2.y)));
    const maxY = Math.min(botY - 1, Math.ceil(Math.max(p0.y, p1.y, p2.y)));
    if (minX > maxX || minY > maxY) return;

    const area = edgeFn(p0.x, p0.y, p1.x, p1.y, p2.x, p2.y);
    if (Math.abs(area) < 1e-5) return;
    const invArea = 1 / area;

    for (let y = minY; y <= maxY; y++) {
        const py = y + 0.5;
        for (let x = minX; x <= maxX; x++) {
            const px = x + 0.5;
            const w0 = edgeFn(p1.x, p1.y, p2.x, p2.y, px, py) * invArea;
            const w1 = edgeFn(p2.x, p2.y, p0.x, p0.y, px, py) * invArea;
            const w2 = edgeFn(p0.x, p0.y, p1.x, p1.y, px, py) * invArea;

            if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
                const depth = w0 * p0.z + w1 * p1.z + w2 * p2.z;
                const idx = y * viewW + x;
                if (depth < zbuf[idx]) {
                    zbuf[idx] = depth;
                    gfx.pixel(x, y, color);
                }
            }
        }
    }
}

function drawWireTri(gfx, p0, p1, p2, color) {
    gfx.line(Math.round(p0.x), Math.round(p0.y), Math.round(p1.x), Math.round(p1.y), color);
    gfx.line(Math.round(p1.x), Math.round(p1.y), Math.round(p2.x), Math.round(p2.y), color);
    gfx.line(Math.round(p2.x), Math.round(p2.y), Math.round(p0.x), Math.round(p0.y), color);
}

// --- DEMO STATE & SCENE ---
function randomSpinVel() {
    const sign = () => (Math.random() < 0.5 ? -1 : 1);
    return {
        vx: sign() * (0.7 + Math.random() * 1.4),
        vy: sign() * (0.9 + Math.random() * 1.6),
        vz: sign() * (0.4 + Math.random() * 1.1),
    };
}

function createDemoState() {
    const vel = randomSpinVel();
    return {
        rx: Math.random() * Math.PI * 2,
        ry: Math.random() * Math.PI * 2,
        rz: Math.random() * Math.PI * 2,
        vx: vel.vx,
        vy: vel.vy,
        vz: vel.vz,
        speedMult: 1,
        wireframe: false,
        dragging: false,
        lastMouseX: 0,
        lastMouseY: 0,
    };
}

function renderCube(gfx, w, state) {
    const viewW = Math.max(1, w.w | 0);
    const viewH = Math.max(1, w.h | 0);
    const sceneTop = Math.min(viewH, TOOLBAR_H);
    if (viewH <= sceneTop) return;

    const proj = VERTS.map((v) =>
        projectVert(v, state.rx, state.ry, state.rz, viewW, viewH, sceneTop),
    );
    if (proj.some((p) => !p)) return;

    const zbuf = new Float32Array(viewW * viewH).fill(1e9);

    for (const face of FACES) {
        const [i0, i1, i2, i3] = face.idx;
        const a = proj[i0],
            b = proj[i1],
            c = proj[i2],
            d = proj[i3];

        // Backface cull in 2D screen space
        const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        if (cross <= 0) continue;

        if (state.wireframe) {
            drawWireTri(gfx, a, b, c, face.color);
            drawWireTri(gfx, a, c, d, face.color);
        } else {
            rasterTriangle(gfx, zbuf, viewW, sceneTop, viewH, a, b, c, face.color);
            rasterTriangle(gfx, zbuf, viewW, sceneTop, viewH, a, c, d, face.color);
        }
    }
}

// --- TOOLBAR & HUD ---
function buildToolbar(w, state) {
    const speedLabel = state.speedMult === 0 ? '0X' : `${state.speedMult}X`;
    const defs = [
        { id: 'spd', label: speedLabel, bg: state.speedMult === 0 ? 2 : 1 },
        { id: 'rnd', label: 'RND', bg: 1 },
        { id: 'wire', label: state.wireframe ? 'SOLID' : 'WIRE', bg: state.wireframe ? 4 : 1 },
    ];
    const buttons = [];
    let x = 3;
    for (const d of defs) {
        const bw = d.label.length * 8 + 6;
        if (x + bw > w.w - 2) break;
        buttons.push({ ...d, x, y: 2, w: bw, h: 10 });
        x += bw + 4;
    }
    return buttons;
}

function drawHud(gfx, w, buttons) {
    gfx.rect(0, 0, w.w, TOOLBAR_H, 0, true);
    gfx.line(0, TOOLBAR_H - 1, w.w - 1, TOOLBAR_H - 1, 8);
    for (const b of buttons) {
        gfx.rect(b.x, b.y, b.w, b.h, b.bg, true);
        gfx.rect(b.x, b.y, b.w, b.h, 15, false);
        gfx.drawText(b.label, b.x + 3, b.y + 1, 15, -1);
    }
}

// --- APP ENTRYPOINT ---
function createApp(win) {
    let state = createDemoState();
    let buttons = [];

    function applyAction(id, w) {
        if (id === 'spd') {
            state.speedMult = state.speedMult === 1 ? 2 : state.speedMult === 2 ? 0 : 1;
        } else if (id === 'rnd') {
            const next = randomSpinVel();
            state.vx = next.vx;
            state.vy = next.vy;
            state.vz = next.vz;
        } else if (id === 'wire') {
            state.wireframe = !state.wireframe;
        }
        w.invalidate();
    }

    return {
        init(w) {
            w.invalidate();
        },
        onResize(w) {
            w.invalidate();
        },

        onKey(key, w) {
            if (typeof key !== 'string') return false;
            if (key === ' ') {
                applyAction('spd', w);
                return true;
            }
            if (key === 'r' || key === 'R') {
                applyAction('rnd', w);
                return true;
            }
            if (key === 'w' || key === 'W') {
                applyAction('wire', w);
                return true;
            }
            return false;
        },

        onMouse(ev, w) {
            if (ev.action === 'down') {
                for (const b of buttons) {
                    if (ev.x >= b.x && ev.x < b.x + b.w && ev.y >= b.y && ev.y < b.y + b.h) {
                        applyAction(b.id, w);
                        return true;
                    }
                }
                if (ev.y >= TOOLBAR_H) {
                    state.dragging = true;
                    state.lastMouseX = ev.x;
                    state.lastMouseY = ev.y;
                    return true;
                }
            } else if (ev.action === 'move' && state.dragging) {
                const dx = ev.x - state.lastMouseX;
                const dy = ev.y - state.lastMouseY;
                state.lastMouseX = ev.x;
                state.lastMouseY = ev.y;
                state.ry += dx * 0.025;
                state.rx += dy * 0.025;
                w.invalidate();
                return true;
            } else if (ev.action === 'up') {
                state.dragging = false;
            }
            return false;
        },

        update(dt, w) {
            if (!state.dragging && state.speedMult > 0) {
                const step = Math.min(0.1, dt) * state.speedMult;
                state.rx += state.vx * step;
                state.ry += state.vy * step;
                state.rz += state.vz * step;
                w.invalidate();
            }
        },

        render(w, api) {
            const gfx = (api && api.gfx) || OS.gfx;
            if (!gfx) return;
            gfx.clear(0);
            renderCube(gfx, w, state);
            buttons = buildToolbar(w, state);
            drawHud(gfx, w, buttons);
        },

        destroy() {
            buttons = [];
            state.dragging = false;
        },
    };
}

module.exports = { createApp };
