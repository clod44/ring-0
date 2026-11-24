import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

interface BunRuntime {
  spawnSync(cmd: string[]): { stdout: Uint8Array; exitCode: number };
  env?: Record<string, string | undefined>;
}

const bun = (globalThis as { Bun?: BunRuntime }).Bun;
const proc =
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process;

function runGit(args: string[]): string | null {
  if (!bun?.spawnSync) return null;
  try {
    const out = bun.spawnSync(["git", ...args]);
    if (out.exitCode !== 0) return null;
    const text = new TextDecoder().decode(out.stdout).trim();
    return text || null;
  } catch {
    return null;
  }
}

const env = bun?.env ?? proc?.env;

const sha = runGit(["rev-parse", "--short", "HEAD"]) ??
  env?.COMMIT_REF?.slice(0, 7) ??
  "local";

const msg = runGit(["log", "-1", "--pretty=%s"]) ??
  env?.BRANCH ??
  "dev build";

export default defineConfig({
  define: {
    __BUILD_SHA__: JSON.stringify(sha),
    __BUILD_MSG__: JSON.stringify(msg),
  },
  plugins: [tailwindcss()],
});
