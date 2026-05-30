import { existsSync, statSync, watch as fsWatch } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";

export interface UsageDeps {
  fetch: typeof fetch;
  readFile: typeof readFile;
  writeFile: typeof writeFile;
  exists: (path: string) => boolean;
  readDir: typeof readdir;
  mkdir: typeof mkdir;
  rename: typeof rename;
  stat: typeof statSync;
  openExclusive: (path: string) => Promise<{ close: () => Promise<void> }>;
  unlink: typeof unlink;
  watch: (
    path: string,
    onChange: (filename?: string) => void,
  ) => {
    close: () => void;
  };
  agentDir: () => string;
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
  openExclusive: async (path) => {
    const fh = await open(path, "wx");
    return { close: () => fh.close() };
  },
  unlink,
  watch: (path, onChange) => {
    const watcher = fsWatch(path, { persistent: false }, (_event, filename) =>
      onChange(filename?.toString()),
    );
    watcher.on("error", () => undefined);
    return { close: () => watcher.close() };
  },
  agentDir: getAgentDir,
  homeDir: homedir,
  env: process.env,
  now: () => Date.now(),
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
  unrefTimer: (timer) => timer.unref(),
});
