// Shared file-type association resolver backed by /etc/filetypes.json

const DEFAULT_ASSOCIATIONS = {
    png: '/apps/imgview.js',
    jpg: '/apps/imgview.js',
    jpeg: '/apps/imgview.js',
    webp: '/apps/imgview.js',
    gif: '/apps/imgview.js',
    bmp: '/apps/imgview.js',
};

function getExtension(filePath) {
    const base =
        String(filePath || '')
            .split('/')
            .pop() || '';
    const dot = base.lastIndexOf('.');
    if (dot <= 0 || dot === base.length - 1) return '';
    return base.slice(dot + 1).toLowerCase();
}

function loadFileAssociations(configPath = '/etc/filetypes.json') {
    const map = { ...DEFAULT_ASSOCIATIONS };
    if (!OS.fs || typeof OS.fs.read !== 'function') return map;

    try {
        const raw = OS.fs.read(configPath);
        if (!raw) return map;
        const parsed = JSON.parse(raw);
        const assoc =
            parsed && typeof parsed === 'object'
                ? parsed.associations && typeof parsed.associations === 'object'
                    ? parsed.associations
                    : parsed
                : null;

        if (!assoc) return map;

        for (const [ext, appPath] of Object.entries(assoc)) {
            const cleanExt = String(ext || '')
                .replace(/^\./, '')
                .toLowerCase()
                .trim();
            if (cleanExt && typeof appPath === 'string' && appPath.trim()) {
                map[cleanExt] = appPath.trim();
            }
        }
    } catch (err) {
        if (typeof OS.log === 'function') {
            OS.log(
                `FILETYPE: failed to load ${configPath}: ${err && err.message ? err.message : String(err)}`,
            );
        }
    }

    return map;
}

function resolveHandlerApp(filePath, associations = null) {
    const table = associations || loadFileAssociations();
    const ext = getExtension(filePath);
    if (ext && table[ext]) {
        return {
            appPath: table[ext],
            args: [filePath],
            directExec: false,
        };
    }
    if (ext === 'js') {
        return {
            appPath: filePath,
            args: [],
            directExec: true,
        };
    }
    return null;
}

module.exports = {
    DEFAULT_ASSOCIATIONS,
    getExtension,
    loadFileAssociations,
    resolveHandlerApp,
};
