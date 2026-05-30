import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface UsageDeps {
  fetch: typeof fetch;
  readFile: typeof readFile;
  writeFile: typeof writeFile;
  exists: (path: string) => boolean;
  readDir: typeof readdir;
  mkdir: typeof mkdir;
  rename: typeof rename;
  stat: typeof statSync;
  runCommand: (
    command: string,
    args?: string[],
  ) => Promise<{ stdout: string; stderr: string }>;
  homeDir: () => string;
  env: NodeJS.ProcessEnv;
  now: () => number;
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
  setInterval: typeof globalThis.setInterval;
  clearInterval: typeof globalThis.clearInterval;
  unrefTimer: (timer: NodeJS.Timeout) => void;
}

export const createDefaultDeps = (): UsageDeps => ({
  fetch,
  readFile,
  writeFile,
  exists: existsSync,
  readDir: readdir,
  mkdir,
  rename,
  stat: statSync,
  runCommand: async (command, args = []) => {
    const result = await execFileAsync(command, args, { encoding: "utf8" });
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  },
  homeDir: homedir,
  env: process.env,
  now: () => Date.now(),
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
  unrefTimer: (timer) => timer.unref(),
});
