import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

declare const Bun: {
  spawnSync(cmd: string[]): { stdout: Uint8Array; exitCode: number };
};

function runGit(args: string[]): string | null {
  try {
    const proc = Bun.spawnSync(['git', ...args]);
    if (proc.exitCode !== 0) return null;
    return new TextDecoder().decode(proc.stdout).trim();
  } catch {
    return null;
  }
}

const sha = runGit(['rev-parse', '--short', 'HEAD']) ?? 'local';
const msg = runGit(['log', '-1', '--pretty=%s']) ?? 'dev build';

export default defineConfig({
  define: {
    __BUILD_SHA__: JSON.stringify(sha),
    __BUILD_MSG__: JSON.stringify(msg),
  },
  plugins: [tailwindcss()],
});