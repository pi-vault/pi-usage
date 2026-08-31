import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createDefaultDeps, type UsageDeps } from "../src/shared/deps.ts";
import { detectProviderFromModel } from "../src/index.ts";
import { createProviderRegistry } from "../src/providers/index.ts";

function mkTmp(): string {
  return mkdtempSync(join(tmpdir(), "pi-usage-live-"));
}

function createLiveDeps(
  root: string,
  now: () => number,
  fetchImpl: UsageDeps["fetch"],
  env?: Record<string, string>,
): UsageDeps {
  const deps = createDefaultDeps();
  return {
    ...deps,
    agentDir: () => root,
    now,
    fetch: fetchImpl,
    env: { ...env },
  };
}

describe("provider detection", () => {
  it("prefers explicit providers and only falls back when provider is empty", () => {
    expect(
      detectProviderFromModel({ provider: "openai-codex", id: "anything" }),
    ).toBe("openai-codex");
    expect(
      detectProviderFromModel({ provider: "openrouter", id: "anything" }),
    ).toBe("openrouter");
    expect(
      detectProviderFromModel({ provider: "minimax", id: "anything" }),
    ).toBe("minimax");
    expect(
      detectProviderFromModel({
        provider: "minimax-openai",
        id: "MiniMax-M3",
      }),
    ).toBe("minimax");
    expect(
      detectProviderFromModel({
        provider: "custom-proxy",
        id: "MiniMax-M3",
      }),
    ).toBeUndefined();
    expect(
      detectProviderFromModel({ provider: "opencode-go", id: "anything" }),
    ).toBe("opencode-go");
    expect(
      detectProviderFromModel({ provider: "stepfun", id: "anything" }),
    ).toBe("stepfun");
    expect(
      detectProviderFromModel({
        provider: "amazon-bedrock",
        id: "openai-codex-proxy",
      }),
    ).toBeUndefined();
    expect(detectProviderFromModel({ provider: "", id: "gpt-5-codex" })).toBe(
      "openai-codex",
    );
    expect(detectProviderFromModel({ provider: "", id: "minimax-m2" })).toBe(
      "minimax",
    );
    expect(detectProviderFromModel({ provider: "", id: "stepfun-pro" })).toBe(
      "stepfun",
    );
    expect(
      detectProviderFromModel({ provider: "", id: "opencode-go/glm-5" }),
    ).toBe("opencode-go");
    expect(
      detectProviderFromModel({ provider: "command-code", id: "anything" }),
    ).toBe("command-code");
    expect(
      detectProviderFromModel({ provider: "commandcode", id: "anything" }),
    ).toBe("command-code");
    // OpenRouter should only be detected from provider field, not id/name
    expect(
      detectProviderFromModel({ provider: "", id: "openrouter-model" }),
    ).toBeUndefined();
    expect(
      detectProviderFromModel({
        provider: "amazon-bedrock",
        id: "opencode-go-proxy",
      }),
    ).toBeUndefined();
  });
});

describe("provider registry", () => {
  it("keeps provider order and strategies aligned with phase 8", () => {
    const root = mkTmp();
    const providers = createProviderRegistry(
      createLiveDeps(root, () => 1_000, vi.fn(), {}),
    );

    expect(
      providers.map((provider) => ({
        id: provider.id,
        label: provider.label,
        strategy: provider.strategy,
      })),
    ).toEqual([
      { id: "offline", label: "Offline", strategy: "offline" },
      {
        id: "openai-codex",
        label: "OpenAI/Codex",
        strategy: "api",
      },
      { id: "minimax", label: "MiniMax", strategy: "api" },
      { id: "stepfun", label: "StepFun", strategy: "api" },
      { id: "opencode-go", label: "OpenCode Go", strategy: "api" },
      { id: "command-code", label: "Command Code", strategy: "api" },
      { id: "openrouter", label: "OpenRouter", strategy: "api" },
    ]);
    rmSync(root, { recursive: true, force: true });
  });
});
