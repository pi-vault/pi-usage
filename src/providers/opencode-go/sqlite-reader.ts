import { join, resolve } from "node:path";
import type { UsageDeps } from "../../shared/deps.ts";
import { parseEpochMs, toFinite } from "../runtime.ts";
import type { CostRow } from "./types.ts";

/** Resolve the path to the OpenCode SQLite database, checking env overrides and XDG paths. */
export async function resolveOpencodeDbPath(
  deps: UsageDeps,
): Promise<{ path?: string; diagnostic?: string }> {
  const dataDir = join(
    deps.env.XDG_DATA_HOME?.trim() || join(deps.homeDir(), ".local/share"),
    "opencode",
  );
  const override = deps.env.OPENCODE_DB?.trim();
  if (override) {
    if (override === ":memory:") {
      return { diagnostic: "OpenCode Go: OPENCODE_DB=:memory: is unsupported." };
    }
    return {
      path: override.startsWith("/") ? override : resolve(dataDir, override),
    };
  }
  const stable = join(dataDir, "opencode.db");
  if (deps.exists(stable)) return { path: stable };
  let files: string[] = [];
  try {
    const entries = (await deps.readDir(dataDir, {
      withFileTypes: true,
    } as never)) as unknown as Array<{ name: string; isFile: () => boolean }>;
    files = entries
      .filter((e) => e.isFile() && /^opencode-.*\.db$/.test(e.name))
      .map((e) => join(dataDir, e.name));
  } catch {
    return { diagnostic: "OpenCode Go DB not found." };
  }
  if (files.length === 1) return { path: files[0] };
  if (files.length > 1) {
    return { diagnostic: "OpenCode Go: multiple DB files found. Set OPENCODE_DB." };
  }
  return { diagnostic: "OpenCode Go DB not found." };
}

/** Read cost rows from the OpenCode SQLite database, handling both current and legacy schemas. */
export async function collectSqliteRows(
  deps: UsageDeps,
): Promise<{ rows: CostRow[]; diagnostic?: string }> {
  const resolved = await resolveOpencodeDbPath(deps);
  if (!resolved.path) return { rows: [], diagnostic: resolved.diagnostic };
  let db: ReturnType<UsageDeps["openReadonlySqlite"]> | undefined;
  try {
    db = deps.openReadonlySqlite(resolved.path);
    const hasTable = (name: string) =>
      Boolean(
        db
          ?.prepare(
            "select name from sqlite_master where type='table' and name=?",
          )
          .get(name),
      );
    const parseData = (value: unknown): Record<string, unknown> | undefined => {
      if (typeof value !== "string") return undefined;
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object"
          ? (parsed as Record<string, unknown>)
          : undefined;
      } catch {
        return undefined;
      }
    };
    let malformed = false;

    if (hasTable("session_message")) {
      const current = db
        .prepare(
          "select data, time_created from session_message where type='assistant'",
        )
        .all() as Array<Record<string, unknown>>;
      const rows: CostRow[] = [];
      for (const row of current) {
        const data = parseData(row.data);
        if (!data) {
          malformed = true;
          continue;
        }
        const model = data.model as Record<string, unknown> | undefined;
        const cost = toFinite(data.cost);
        const time = data.time as Record<string, unknown> | undefined;
        const ts = parseEpochMs(time?.created ?? row.time_created);
        if (model?.providerID === "opencode-go" && cost && cost > 0 && ts) {
          rows.push({ ts, cost });
        }
      }
      if (rows.length > 0) {
        return {
          rows,
          diagnostic: malformed
            ? "Skipped malformed OpenCode SQLite rows."
            : undefined,
        };
      }
    }

    if (!hasTable("message")) {
      return { rows: [], diagnostic: "OpenCode Go SQLite schema unsupported." };
    }
    const legacy = db
      .prepare("select id, data, time_created from message")
      .all() as Array<Record<string, unknown>>;
    const direct: CostRow[] = [];
    const partFallback = new Map<string, CostRow>();
    for (const row of legacy) {
      const data = parseData(row.data);
      if (!data) {
        malformed = true;
        continue;
      }
      const time = data.time as Record<string, unknown> | undefined;
      const ts = parseEpochMs(time?.created ?? row.time_created);
      if (
        data.role !== "assistant" ||
        data.providerID !== "opencode-go" ||
        !ts
      ) {
        continue;
      }
      const cost = toFinite(data.cost);
      if (cost && cost > 0) {
        direct.push({ ts, cost });
      } else if (typeof row.id === "string") {
        partFallback.set(row.id, { ts, cost: 0 });
      }
    }
    if (partFallback.size > 0 && hasTable("part")) {
      const parts = db
        .prepare("select message_id, data from part")
        .all() as Array<Record<string, unknown>>;
      for (const row of parts) {
        if (
          typeof row.message_id !== "string" ||
          !partFallback.has(row.message_id)
        ) {
          continue;
        }
        const data = parseData(row.data);
        if (!data) {
          malformed = true;
          continue;
        }
        const cost = toFinite(data.cost);
        if (data.type === "step-finish" && cost && cost > 0) {
          const fallback = partFallback.get(row.message_id);
          if (fallback) fallback.cost += cost;
        }
      }
    }
    const rows = [
      ...direct,
      ...[...partFallback.values()].filter((row) => row.cost > 0),
    ];
    return {
      rows,
      diagnostic:
        malformed && rows.length > 0
          ? "Skipped malformed OpenCode SQLite rows."
          : undefined,
    };
  } catch {
    return { rows: [], diagnostic: "OpenCode Go SQLite unavailable." };
  } finally {
    db?.close();
  }
}
