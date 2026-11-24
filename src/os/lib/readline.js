// GNU Readline-style line editor & history library

function createHistory(filePath, limit = 100) {
  const raw = OS.fs.read(filePath);
  const items = raw ? raw.split('\n').filter(Boolean) : [];

  return {
    items,
    add(line) {
      if (!line || items[items.length - 1] === line) return;
      items.push(line);
      if (items.length > limit) items.shift();
      OS.fs.write(filePath, items.join('\n'));
    },
  };
}

function longestCommonPrefix(list) {
  if (list.length === 0) return '';
  let prefix = list[0];
  for (let i = 1; i < list.length; i++) {
    while (!list[i].startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
      if (!prefix) return '';
    }
  }
  return prefix;
}

async function readLine({
  prompt = '',
  history = [],
  complete = null,
  fg = 15,
  bg = 0,
  promptColor = 214,
  dimColor = 8,
} = {}) {
  const COLS = OS.tty.cols;
  const ROWS = OS.tty.rows;

  OS.tty.print(prompt, promptColor, bg);
  let { x: startX, y: startY } = OS.tty.getCursor();

  const state = {
    buffer: '',
    pos: 0,
    prevLen: 0,
    draft: '',
    histIdx: history.length,
  };

  const moveTo = (offset) => {
    const total = startX + offset;
    OS.tty.setCursor(total % COLS, startY + Math.floor(total / COLS));
  };

  const redraw = () => {
    const maxLen = Math.max(state.buffer.length, state.prevLen);
    const endRow = startY + Math.floor((startX + maxLen) / COLS);
    const overflow = Math.max(0, endRow - (ROWS - 1));

    OS.tty.setCursor(startX, startY);
    OS.tty.print(state.buffer, fg, bg);

    if (state.prevLen > state.buffer.length) {
      OS.tty.print(' '.repeat(state.prevLen - state.buffer.length), fg, bg);
    }

    if (overflow > 0) startY = Math.max(0, startY - overflow);

    state.prevLen = state.buffer.length;
    moveTo(state.pos);
  };

  const setBuffer = (text) => {
    state.buffer = text;
    state.pos = text.length;
    redraw();
  };

  const replaceRange = (from, to, text) => {
    state.buffer = state.buffer.slice(0, from) + text + state.buffer.slice(to);
    state.pos = from + text.length;
    redraw();
  };

  // Readline keymap
  const keymap = {
    ArrowLeft() {
      if (state.pos > 0) moveTo(--state.pos);
    },
    ArrowRight() {
      if (state.pos < state.buffer.length) moveTo(++state.pos);
    },
    Home() {
      state.pos = 0;
      moveTo(0);
    },
    End() {
      state.pos = state.buffer.length;
      moveTo(state.pos);
    },
    Backspace() {
      if (state.pos > 0) replaceRange(state.pos - 1, state.pos, '');
    },
    Delete() {
      if (state.pos < state.buffer.length) {
        state.buffer = state.buffer.slice(0, state.pos) + state.buffer.slice(state.pos + 1);
        redraw();
      }
    },
    ArrowUp() {
      if (state.histIdx > 0) {
        if (state.histIdx === history.length) state.draft = state.buffer;
        setBuffer(history[--state.histIdx]);
      }
    },
    ArrowDown() {
      if (state.histIdx < history.length) {
        state.histIdx++;
        setBuffer(state.histIdx === history.length ? state.draft : history[state.histIdx]);
      }
    },
    Tab() {
      if (!complete) return;
      const { wordStart, word, matches, isDir } = complete(state.buffer, state.pos);
      if (matches.length === 0) return;

      if (matches.length === 1) {
        const suffix = isDir && isDir(matches[0]) ? '' : ' ';
        replaceRange(wordStart, state.pos, matches[0] + suffix);
        return;
      }

      const common = longestCommonPrefix(matches);
      if (common.length > word.length) {
        replaceRange(wordStart, state.pos, common);
        return;
      }

      // List all candidates below and reprint prompt
      moveTo(state.buffer.length);
      OS.tty.putChar('\n', fg, bg);
      OS.tty.println(matches.join('  '), dimColor, bg);
      OS.tty.print(prompt, promptColor, bg);
      ({ x: startX, y: startY } = OS.tty.getCursor());
      state.prevLen = 0;
      redraw();
    },
  };

  let frame = 0;
  let cursorVisible = true;
  OS.tty.drawCursor(true);

  while (true) {
    let key;
    while ((key = OS.pollKey()) !== null) {
      OS.tty.drawCursor(false);
      frame = 0;
      cursorVisible = true;

      if (key === 'Enter') {
        moveTo(state.buffer.length);
        OS.tty.putChar('\n', fg, bg);
        return state.buffer;
      }

      if (keymap[key]) {
        keymap[key]();
      } else if (key.length === 1) {
        replaceRange(state.pos, state.pos, key);
      }

      OS.tty.drawCursor(true);
    }

    frame++;
    if (frame % 30 === 0) {
      cursorVisible = !cursorVisible;
      OS.tty.drawCursor(cursorVisible);
    }

    await OS.nextFrame();
  }
}

module.exports = { createHistory, readLine };