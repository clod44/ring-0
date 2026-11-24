export interface InputBridgeOptions {
    screenEl: HTMLCanvasElement;
    kbdProxy: HTMLInputElement | null;
    ctrlBtn: HTMLButtonElement | null;
    mobileKeysEl: HTMLElement | null;
    onKey: (key: string, opts?: { ctrl?: boolean }) => void;
}

export function initInputBridge(opts: InputBridgeOptions) {
    const { screenEl, kbdProxy, ctrlBtn, mobileKeysEl, onKey } = opts;
    let stickyCtrl = false;

    function setStickyCtrl(active: boolean) {
        stickyCtrl = active;
        ctrlBtn?.classList.toggle("border-emerald-500", stickyCtrl);
        ctrlBtn?.classList.toggle("text-emerald-400", stickyCtrl);
    }

    function focusInput() {
        if (!kbdProxy) {
            screenEl.focus({ preventScroll: true });
            return;
        }
        if (document.activeElement !== kbdProxy) {
            kbdProxy.focus({ preventScroll: true });
        }
    }

    // Use 'click' (a complete tap gesture) rather than 'pointerdown' so mobile keyboards stay open
    screenEl.addEventListener("click", () => {
        focusInput();
    });

    ctrlBtn?.addEventListener("click", (e) => {
        e.preventDefault();
        setStickyCtrl(!stickyCtrl);
        focusInput();
    });

    mobileKeysEl?.addEventListener("click", (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(
            "[data-key]",
        );
        if (!btn) return;
        e.preventDefault();
        onKey(btn.dataset.key!);
        focusInput();
    });

    const handleKeyDown = (e: KeyboardEvent) => {
        if (
            e.key === "Unidentified" || e.key === "Process" ||
            e.key === "Control"
        ) {
            return;
        }

        const isCtrl = e.ctrlKey || stickyCtrl;

        if (isCtrl && e.key.length === 1) {
            e.preventDefault();
            e.stopPropagation();
            onKey(e.key.toLowerCase(), { ctrl: true });
            if (stickyCtrl) {
                setStickyCtrl(false);
            }
            return;
        }

        const targetIsProxy = e.target === kbdProxy;
        const isModified = e.ctrlKey || e.metaKey || e.altKey;
        if (!targetIsProxy || e.key.length > 1 || isModified) {
            e.preventDefault();
            onKey(e.key, { ctrl: e.ctrlKey });
        }
    };

    kbdProxy?.addEventListener("keydown", handleKeyDown, { capture: true });
    screenEl.addEventListener("keydown", handleKeyDown, { capture: true });

    kbdProxy?.addEventListener("input", () => {
        if (!kbdProxy) return;
        const val = kbdProxy.value;
        kbdProxy.value = "";

        for (const ch of val) {
            if (stickyCtrl) {
                onKey(ch.toLowerCase(), { ctrl: true });
                setStickyCtrl(false);
            } else {
                onKey(ch, { ctrl: false });
            }
        }
    });

    return {
        focusInput,
        resetModifiers() {
            setStickyCtrl(false);
        },
    };
}
