export type MouseAction = "down" | "move" | "up";

export interface MouseEventPayload {
    action: MouseAction;
    x: number;
    y: number;
    button: number;
    buttons: number;
}

export interface InputBridgeOptions {
    screenEl: HTMLCanvasElement;
    kbdProxy: HTMLInputElement | null;
    ctrlBtn: HTMLButtonElement | null;
    mobileKeysEl: HTMLElement | null;
    onKey: (key: string, opts?: { ctrl?: boolean }) => void;
    onMouse?: (ev: MouseEventPayload) => void;
}

export function initInputBridge(opts: InputBridgeOptions) {
    const { screenEl, kbdProxy, ctrlBtn, mobileKeysEl, onKey, onMouse } = opts;
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

    function toScreenCoords(e: PointerEvent): { x: number; y: number } {
        const rect = screenEl.getBoundingClientRect();
        const w = screenEl.width || rect.width || 1;
        const h = screenEl.height || rect.height || 1;

        const scaleX = rect.width > 0 ? w / rect.width : 1;
        const scaleY = rect.height > 0 ? h / rect.height : 1;

        const rawX = (e.clientX - rect.left) * scaleX;
        const rawY = (e.clientY - rect.top) * scaleY;

        return {
            x: Math.max(0, Math.min(w - 1, Math.floor(rawX))),
            y: Math.max(0, Math.min(h - 1, Math.floor(rawY))),
        };
    }

    // Use 'click' (a complete tap gesture) rather than 'pointerdown' so mobile keyboards stay open
    screenEl.addEventListener("click", () => {
        focusInput();
    });

    screenEl.addEventListener("pointerdown", (e: PointerEvent) => {
        if (!onMouse) return;
        try {
            screenEl.setPointerCapture(e.pointerId);
        } catch {
            // Ignore if pointer capture isn't supported for this event source
        }
        const { x, y } = toScreenCoords(e);
        onMouse({
            action: "down",
            x,
            y,
            button: e.button,
            buttons: e.buttons,
        });
    });

    screenEl.addEventListener("pointermove", (e: PointerEvent) => {
        if (!onMouse) return;
        const { x, y } = toScreenCoords(e);
        onMouse({
            action: "move",
            x,
            y,
            button: e.button,
            buttons: e.buttons,
        });
    });

    const handlePointerUp = (e: PointerEvent) => {
        if (screenEl.hasPointerCapture?.(e.pointerId)) {
            screenEl.releasePointerCapture(e.pointerId);
        }
        if (!onMouse) return;
        const { x, y } = toScreenCoords(e);
        onMouse({
            action: "up",
            x,
            y,
            button: e.button,
            buttons: e.buttons,
        });
    };

    screenEl.addEventListener("pointerup", handlePointerUp);
    screenEl.addEventListener("pointercancel", handlePointerUp);

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
