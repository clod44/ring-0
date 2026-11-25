const raw = DE.readJson('/etc/de/icons.json');
const list = Array.isArray(raw) ? raw : (raw && raw.items) || (raw && raw.apps) || [];

const BOX_W = 24;
const BOX_H = 20;
const CELL_W = 84;
const CELL_H = 40;
const MAX_LABEL = 10;

let icons = [];

function formatLabel(name) {
    const s = String(name || '');
    if (s.length <= MAX_LABEL) return s;
    return s.slice(0, MAX_LABEL - 1) + '~';
}

function layoutIcons() {
    const wa = DE.getWorkarea();
    const cols = Math.max(1, Math.floor((wa.w - 16) / CELL_W));

    icons = list
        .filter((item) => item && item.exec)
        .map((item, idx) => {
            const col = idx % cols;
            const row = Math.floor(idx / cols);
            const label = formatLabel(
                item.name || item.id || item.exec.split('/').pop().replace(/\.js$/, ''),
            );
            const labelW = label.length * 8;
            const slotW = Math.max(BOX_W, labelW);
            const cellX = wa.x + 8 + col * CELL_W;
            const cellY = wa.y + 8 + row * CELL_H;

            return {
                name: String(item.name || label),
                label,
                exec: String(item.exec),
                mode: item.mode === 'exec' ? 'exec' : 'window',
                w: Number.isFinite(Number(item.w)) ? Number(item.w) : 160,
                h: Number.isFinite(Number(item.h)) ? Number(item.h) : 95,
                x: cellX,
                y: cellY,
                slotW,
                boxX: cellX + Math.floor((slotW - BOX_W) / 2),
                labelX: cellX + Math.floor((slotW - labelW) / 2),
            };
        });
}

module.exports = {
    id: 'desktop-icons',
    layer: 'desktop',
    order: 10,
    init() {
        layoutIcons();
        DE.on('workarea:change', layoutIcons);
    },
    render(gfx) {
        for (const icon of icons) {
            gfx.rect(icon.boxX, icon.y, BOX_W, BOX_H, 15, false);
            gfx.rect(icon.boxX + 1, icon.y + 1, BOX_W - 2, BOX_H - 2, 1, true);
            const glyph = icon.name.charAt(0).toUpperCase() || '?';
            gfx.drawChar(
                glyph,
                icon.boxX + Math.floor((BOX_W - 8) / 2),
                icon.y + Math.floor((BOX_H - 8) / 2),
                11,
                -1,
            );
            gfx.drawText(icon.label, icon.labelX, icon.y + BOX_H + 2, 15, -1);
        }
    },
    onMouse(ev) {
        if (ev.action !== 'down') return false;
        for (let i = icons.length - 1; i >= 0; i--) {
            const icon = icons[i];
            const hitH = BOX_H + 10;
            if (
                ev.x >= icon.x &&
                ev.x < icon.x + icon.slotW &&
                ev.y >= icon.y &&
                ev.y < icon.y + hitH
            ) {
                if (icon.mode === 'exec') {
                    Promise.resolve()
                        .then(() => OS.exec(icon.exec, [], OS.env))
                        .then(() => {
                            if (OS.tty && typeof OS.tty.invalidate === 'function') {
                                OS.tty.invalidate();
                            }
                        })
                        .catch((err) => DE.showError(`EXEC: ${icon.name}`, err));
                } else {
                    const offset = (DE.getWindows().length * 14) % 48;
                    const wa = DE.getWorkarea();
                    DE.spawnWindow({
                        title: icon.name.toUpperCase(),
                        x: wa.x + 16 + offset,
                        y: wa.y + 16 + offset,
                        w: icon.w,
                        h: icon.h,
                        appPath: icon.exec,
                    });
                }
                return true;
            }
        }
        return false;
    },
};
