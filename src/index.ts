import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createUsageCore } from "./core/usage-core.ts";
import { createDefaultDeps, type UsageDeps } from "./shared/deps.ts";
import {
	USAGE_CORE_REQUEST_EVENT,
	USAGE_CORE_UPDATE_CURRENT_EVENT,
	type UsageCoreCurrentRequest,
} from "./shared/events.ts";
import { openDashboard } from "./tui/dashboard.ts";

export { detectProviderFromModel } from "./shared/provider-detection.ts";

const GLOBAL_KEY = "__piUsage" as const;

type GlobalUsageState = { initialized: true };

declare global {
	// eslint-disable-next-line no-var
	var __piUsage: GlobalUsageState | undefined;
}

export interface UsageExtensionOptions {
	deps?: Partial<UsageDeps>;
}

function mergeDeps(overrides?: Partial<UsageDeps>): UsageDeps {
	return { ...createDefaultDeps(), ...overrides };
}

function isCurrentRequest(value: unknown): value is UsageCoreCurrentRequest {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { type?: unknown }).type === "current" &&
		typeof (value as { reply?: unknown }).reply === "function"
	);
}

export function createUsageExtension(options?: UsageExtensionOptions) {
	const deps = mergeDeps(options?.deps);
	const injectedMode = Boolean(options?.deps);

	return function usageExtension(pi: ExtensionAPI): void {
		if (!injectedMode && globalThis[GLOBAL_KEY]) return;
		if (!injectedMode) globalThis[GLOBAL_KEY] = { initialized: true };

		const core = createUsageCore({
			deps,
			onEmit: (name, payload) => pi.events.emit(name, payload),
		});

		const dashboardBus = {
			on: (event: string, handler: (...args: unknown[]) => void) =>
				pi.events.on(event, handler as (...args: unknown[]) => void),
		};
		(globalThis as { __piUsageBus?: unknown }).__piUsageBus = dashboardBus;

		pi.on("session_start", (_event, ctx) => {
			core.updateModel(ctx.model);
			core.startLiveRuntime();
			void core.bootstrap();
		});

		pi.on("model_select", (event, ctx) => {
			core.updateModel(event.model ?? ctx.model);
			if (core.isLiveProvider(core.getState().currentProviderId)) {
				void core.emitProviderUpdate(true, ctx.signal).catch(() => undefined);
			} else {
				pi.events.emit(USAGE_CORE_UPDATE_CURRENT_EVENT, {
					state: core.getState(),
				});
			}
		});

		pi.on("turn_start", (_event, ctx) => {
			core.updateModel(ctx.model);
			pi.events.emit(USAGE_CORE_UPDATE_CURRENT_EVENT, {
				state: core.getState(),
			});
		});

		pi.on("turn_end", (_event, ctx) => {
			core.updateModel(ctx.model);
			pi.events.emit(USAGE_CORE_UPDATE_CURRENT_EVENT, {
				state: core.getState(),
			});
		});

		const rejectArgs = (args: string) => args.trim() !== "";

		pi.registerCommand("usage", {
			description: "Open the usage dashboard",
			handler: async (args, ctx) => {
				if (!ctx.hasUI) return;
				if (rejectArgs(args)) {
					ctx.ui.notify(
						"Unknown /usage arguments. Use /usage with no args, or /usage:refresh to force a refresh.",
						"warning",
					);
					return;
				}
				const { cancelScan, scan } =
					await core.prepareUsageDashboard(false);
				await openDashboard(ctx, core.getState(), cancelScan);
				await scan;
			},
		});

		pi.registerCommand("usage:refresh", {
			description: "Refresh provider usage and open the usage dashboard",
			handler: async (args, ctx) => {
				if (!ctx.hasUI) return;
				if (rejectArgs(args)) {
					ctx.ui.notify(
						"Unknown /usage:refresh arguments. /usage:refresh does not take any arguments.",
						"warning",
					);
					return;
				}
				const { cancelScan, scan } =
					await core.prepareUsageDashboard(true);
				await openDashboard(ctx, core.getState(), cancelScan);
				await scan;
			},
		});

		const unsubscribeRequestCurrent = pi.events.on(
			USAGE_CORE_REQUEST_EVENT,
			(payload: unknown) => {
				if (!isCurrentRequest(payload)) return;
				payload.reply({ state: core.getState() });
			},
		);

		pi.on("session_shutdown", () => {
			core.shutdown();
			unsubscribeRequestCurrent();
			delete globalThis[GLOBAL_KEY];
			delete (globalThis as { __piUsageBus?: unknown }).__piUsageBus;
		});
	};
}

export default createUsageExtension();
