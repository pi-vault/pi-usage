import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createUsageCore, type UsageCore } from "../src/core/usage-core.ts";
import { createDefaultDeps } from "../src/shared/deps.ts";
import {
	USAGE_CORE_READY_EVENT,
	USAGE_CORE_UPDATE_CURRENT_EVENT,
	type UsageCorePayload,
} from "../src/shared/events.ts";
import type { UsageCoreState } from "../src/shared/types.ts";

function mkTmp(): string {
	return mkdtempSync(join(tmpdir(), "pi-usage-core-"));
}

function createTestDeps(
	root: string,
	overrides?: Partial<ReturnType<typeof createDefaultDeps>>,
) {
	return {
		...createDefaultDeps(),
		agentDir: () => root,
		now: () => Date.parse("2026-06-01T12:00:00Z"),
		fetch: vi.fn(async () => {
			throw new Error("network unavailable");
		}) as never,
		...overrides,
	};
}

describe("UsageCore", () => {
	it("getState returns projected state after construction", () => {
		const root = mkTmp();
		const core = createUsageCore({
			deps: createTestDeps(root),
			onEmit: () => {},
		});
		const s = core.getState();
		expect(s.currentProviderId).toBeNull();
		expect(s.currentProviderSnapshot).toBeNull();
		expect(s.compatibility.currentLiveProviderId).toBeNull();
		expect(s.providers).toEqual([]);
		expect(s.loading).toBe(false);
		rmSync(root, { recursive: true, force: true });
	});

	it("updateModel sets currentProviderId", () => {
		const root = mkTmp();
		const core = createUsageCore({
			deps: createTestDeps(root),
			onEmit: () => {},
		});
		core.updateModel({ provider: "openai-codex", id: "gpt-5" });
		expect(core.getState().currentProviderId).toBe("openai-codex");
		rmSync(root, { recursive: true, force: true });
	});

	it("updateModel sets currentModelLabel from id", () => {
		const root = mkTmp();
		const core = createUsageCore({
			deps: createTestDeps(root),
			onEmit: () => {},
		});
		core.updateModel({ provider: "minimax", id: "minimax-pro" });
		expect(core.getState().currentModelLabel).toBe("minimax-pro");
		rmSync(root, { recursive: true, force: true });
	});

	it("updateModel falls back to name for label", () => {
		const root = mkTmp();
		const core = createUsageCore({
			deps: createTestDeps(root),
			onEmit: () => {},
		});
		core.updateModel({ provider: "stepfun", name: "StepFun Pro" });
		expect(core.getState().currentModelLabel).toBe("StepFun Pro");
		rmSync(root, { recursive: true, force: true });
	});

	it("isLiveProvider returns true for api-strategy providers", () => {
		const root = mkTmp();
		const core = createUsageCore({
			deps: createTestDeps(root),
			onEmit: () => {},
		});
		expect(core.isLiveProvider("openai-codex")).toBe(true);
		expect(core.isLiveProvider("minimax")).toBe(true);
		expect(core.isLiveProvider("offline")).toBe(false);
		expect(core.isLiveProvider(null)).toBe(false);
		rmSync(root, { recursive: true, force: true });
	});

	it("bootstrap emits READY event with diagnostics set", async () => {
		const root = mkTmp();
		mkdirSync(join(root, "sessions"), { recursive: true });
		const emitted: Array<{ name: string }> = [];
		const core = createUsageCore({
			deps: createTestDeps(root),
			onEmit: (name) => emitted.push({ name }),
		});
		await core.bootstrap();
		expect(emitted.some((e) => e.name === USAGE_CORE_READY_EVENT)).toBe(
			true,
		);
		expect(core.getState().diagnostics).toContain("live runtime ready");
		rmSync(root, { recursive: true, force: true });
	});

	it("bootstrap populates providers array", async () => {
		const root = mkTmp();
		mkdirSync(join(root, "sessions"), { recursive: true });
		const core = createUsageCore({
			deps: createTestDeps(root),
			onEmit: () => {},
		});
		await core.bootstrap();
		expect(core.getState().providers.length).toBeGreaterThan(0);
		rmSync(root, { recursive: true, force: true });
	});

	it("refreshOffline scans sessions and emits state updates", async () => {
		const root = mkTmp();
		const sessions = join(root, "sessions");
		mkdirSync(sessions, { recursive: true });
		writeFileSync(
			join(sessions, "s.jsonl"),
			`${JSON.stringify({
				type: "message",
				id: "m1",
				timestamp: "2026-06-01T11:00:00Z",
				message: {
					role: "assistant",
					provider: "openai-codex",
					model: "gpt-5-codex",
					usage: {
						input: 100,
						output: 50,
						cacheRead: 0,
						cacheWrite: 0,
						cost: 0.01,
					},
				},
			})}\n`,
		);
		const emitted: string[] = [];
		const core = createUsageCore({
			deps: createTestDeps(root),
			onEmit: (name) => emitted.push(name),
		});
		await core.refreshOffline(true);
		expect(core.getState().offline.messageCount).toBe(1);
		expect(core.getState().offline.periods.length).toBeGreaterThan(0);
		expect(core.getState().loading).toBe(false);
		expect(
			emitted.filter((e) => e === USAGE_CORE_UPDATE_CURRENT_EVENT).length,
		).toBeGreaterThanOrEqual(2);
		rmSync(root, { recursive: true, force: true });
	});

	it("refreshOffline respects scan token cancellation", async () => {
		const root = mkTmp();
		mkdirSync(join(root, "sessions"), { recursive: true });
		const core = createUsageCore({
			deps: createTestDeps(root),
			onEmit: () => {},
		});
		const token = { cancelled: true };
		await core.refreshOffline(true, token);
		expect(core.getState().offline.messageCount).toBe(0);
		expect(core.getState().loading).toBe(false);
		rmSync(root, { recursive: true, force: true });
	});

	it("populateProviders fills state.providers", async () => {
		const root = mkTmp();
		const core = createUsageCore({
			deps: createTestDeps(root),
			onEmit: () => {},
		});
		await core.populateProviders(true);
		expect(core.getState().providers.length).toBeGreaterThan(0);
		rmSync(root, { recursive: true, force: true });
	});

	it("shutdown stops polling timer", () => {
		const root = mkTmp();
		const clearInterval = vi.fn();
		const core = createUsageCore({
			deps: createTestDeps(root, {
				setInterval: vi.fn(
					() => ({}) as unknown as NodeJS.Timeout,
				),
				clearInterval,
				unrefTimer: vi.fn(),
				mkdir: vi.fn(async () => undefined) as never,
				watch: vi.fn(() => ({ close() {} })),
			}),
			onEmit: () => {},
		});
		core.startLiveRuntime();
		core.shutdown();
		expect(clearInterval).toHaveBeenCalled();
		rmSync(root, { recursive: true, force: true });
	});

	it("shutdown closes cache watcher", async () => {
		const root = mkTmp();
		const close = vi.fn();
		const core = createUsageCore({
			deps: createTestDeps(root, {
				setInterval: vi.fn(
					() => ({}) as unknown as NodeJS.Timeout,
				),
				clearInterval: vi.fn(),
				unrefTimer: vi.fn(),
				mkdir: vi.fn(async () => undefined) as never,
				watch: vi.fn(() => ({ close })),
			}),
			onEmit: () => {},
		});
		core.startLiveRuntime();
		// wait for async mkdir().then() to resolve
		await new Promise((r) => setTimeout(r, 10));
		core.shutdown();
		expect(close).toHaveBeenCalled();
		rmSync(root, { recursive: true, force: true });
	});

	it("prepareUsageDashboard with refresh sets refreshRequested", async () => {
		const root = mkTmp();
		mkdirSync(join(root, "sessions"), { recursive: true });
		const emitted: string[] = [];
		const core = createUsageCore({
			deps: createTestDeps(root),
			onEmit: (name) => emitted.push(name),
		});
		const { cancelScan, scan } =
			await core.prepareUsageDashboard(true);
		expect(core.getState().refreshRequested).toBe(true);
		expect(core.getState().diagnostics).toContain("refresh requested");
		cancelScan();
		if (scan) await scan;
		rmSync(root, { recursive: true, force: true });
	});

	it("prepareUsageDashboard without refresh skips scan if periods exist", async () => {
		const root = mkTmp();
		const sessions = join(root, "sessions");
		mkdirSync(sessions, { recursive: true });
		writeFileSync(
			join(sessions, "s.jsonl"),
			`${JSON.stringify({
				type: "message",
				id: "m1",
				timestamp: "2026-06-01T11:00:00Z",
				message: {
					role: "assistant",
					provider: "openai-codex",
					model: "gpt-5",
					usage: {
						input: 1,
						output: 1,
						cacheRead: 0,
						cacheWrite: 0,
						cost: 0.001,
					},
				},
			})}\n`,
		);
		const core = createUsageCore({
			deps: createTestDeps(root),
			onEmit: () => {},
		});
		// First populate offline data
		await core.refreshOffline(true);
		expect(core.getState().offline.periods.length).toBeGreaterThan(0);

		// Now prepareUsageDashboard(false) should skip scan
		const { scan } = await core.prepareUsageDashboard(false);
		expect(scan).toBeUndefined();
		rmSync(root, { recursive: true, force: true });
	});

	it("emitProviderUpdate calls populateProviders and emits", async () => {
		const root = mkTmp();
		const emitted: string[] = [];
		const core = createUsageCore({
			deps: createTestDeps(root),
			onEmit: (name) => emitted.push(name),
		});
		await core.emitProviderUpdate(true);
		expect(
			emitted.includes(USAGE_CORE_UPDATE_CURRENT_EVENT),
		).toBe(true);
		expect(core.getState().providers.length).toBeGreaterThan(0);
		rmSync(root, { recursive: true, force: true });
	});

	it("startLiveRuntime sets up periodic interval with unref", () => {
		const root = mkTmp();
		const setInterval = vi.fn(
			() => ({ unref() {} }) as unknown as NodeJS.Timeout,
		);
		const unrefTimer = vi.fn();
		const core = createUsageCore({
			deps: createTestDeps(root, {
				setInterval,
				unrefTimer,
				mkdir: vi.fn(async () => undefined) as never,
				watch: vi.fn(() => ({ close() {} })),
			}),
			onEmit: () => {},
		});
		core.startLiveRuntime();
		expect(setInterval).toHaveBeenCalledWith(
			expect.any(Function),
			1_800_000,
		);
		expect(unrefTimer).toHaveBeenCalled();
		rmSync(root, { recursive: true, force: true });
	});

	it("startLiveRuntime is idempotent", () => {
		const root = mkTmp();
		const setInterval = vi.fn(
			() => ({}) as unknown as NodeJS.Timeout,
		);
		const core = createUsageCore({
			deps: createTestDeps(root, {
				setInterval,
				unrefTimer: vi.fn(),
				mkdir: vi.fn(async () => undefined) as never,
				watch: vi.fn(() => ({ close() {} })),
			}),
			onEmit: () => {},
		});
		core.startLiveRuntime();
		core.startLiveRuntime();
		expect(setInterval).toHaveBeenCalledTimes(1);
		rmSync(root, { recursive: true, force: true });
	});
});
