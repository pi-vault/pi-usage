import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDefaultDeps } from "../src/shared/deps.ts";
import {
  collectSqliteRows,
  resolveOpencodeDbPath,
} from "../src/providers/opencode-go/sqlite-reader.ts";

function mkTmp(): string {
  return mkdtempSync(join(tmpdir(), "pi-usage-sqlite-"));
}

describe("sqlite-reader", () => {
  describe("resolveOpencodeDbPath", () => {
    it("returns override path from OPENCODE_DB env", async () => {
      const deps = createDefaultDeps();
      deps.env = { OPENCODE_DB: "/custom/path.db" };
      const result = await resolveOpencodeDbPath(deps);
      expect(result.path).toBe("/custom/path.db");
    });

    it("returns diagnostic for :memory:", async () => {
      const deps = createDefaultDeps();
      deps.env = { OPENCODE_DB: ":memory:" };
      const result = await resolveOpencodeDbPath(deps);
      expect(result.diagnostic).toContain("unsupported");
      expect(result.path).toBeUndefined();
    });

    it("returns diagnostic when DB not found", async () => {
      const root = mkTmp();
      const deps = createDefaultDeps();
      deps.env = { XDG_DATA_HOME: root };
      deps.homeDir = () => root;
      const result = await resolveOpencodeDbPath(deps);
      expect(result.diagnostic).toContain("not found");
      rmSync(root, { recursive: true, force: true });
    });
  });

  describe("collectSqliteRows", () => {
    it("returns empty rows with diagnostic when DB unavailable", async () => {
      const deps = createDefaultDeps();
      deps.env = { OPENCODE_DB: "/nonexistent/path.db" };
      deps.openReadonlySqlite = () => {
        throw new Error("SQLITE_CANTOPEN");
      };
      const result = await collectSqliteRows(deps);
      expect(result.rows).toEqual([]);
      expect(result.diagnostic).toContain("unavailable");
    });
  });
});
