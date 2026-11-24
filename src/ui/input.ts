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
    ctrlBtn?.classList.toggle('border-emerald-500', stickyCtrl);
    ctrlBtn?.classList.toggle('text-emerald-400', stickyCtrl);
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
  screenEl.addEventListener('click', () => {
    focusInput();
  });

  ctrlBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    setStickyCtrl(!stickyCtrl);
    focusInput();
  });

  mobileKeysEl?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-key]');
    if (!btn) return;
    e.preventDefault();
    onKey(btn.dataset.key!);
    focusInput();
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Unidentified' || e.key === 'Process') return;

    if (stickyCtrl && e.key.length === 1) {
      e.preventDefault();
      onKey(e.key, { ctrl: true });
      setStickyCtrl(false);
      return;
    }

    const targetIsProxy = e.target === kbdProxy;
    const isModified = e.ctrlKey || e.metaKey || e.altKey;
    if (!targetIsProxy || e.key.length > 1 || isModified) {
      e.preventDefault();
      onKey(e.key, { ctrl: e.ctrlKey });
    }
  };

  kbdProxy?.addEventListener('keydown', handleKeyDown);
  screenEl.addEventListener('keydown', handleKeyDown);

  kbdProxy?.addEventListener('input', () => {
    if (!kbdProxy) return;
    const val = kbdProxy.value;
    kbdProxy.value = '';

    for (const ch of val) {
      onKey(ch, { ctrl: stickyCtrl });
      if (stickyCtrl) {
        setStickyCtrl(false);
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