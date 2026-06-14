import type { UsageDeps } from "../shared/deps.ts";
import type {
	ProviderId,
	UsageCoreState,
} from "../shared/types.ts";
import {
	USAGE_CORE_READY_EVENT,
	USAGE_CORE_UPDATE_CURRENT_EVENT,
	type UsageCorePayload,
} from "../shared/events.ts";
import { type InternalState, projectState } from "./state-projections.ts";
import {
	createProviderRegistry,
	providerCacheDir,
} from "../providers/index.ts";
import { detectProviderFromModel } from "../shared/provider-detection.ts";
import { mapWithLimit } from "../shared/concurrency.ts";
import { buildInsights, scanOfflineUsage } from "./offline.ts";
import { buildPeriods } from "../tui/dashboard-model.ts";

export type ScanToken = { cancelled: boolean };

export interface UsageCoreOptions {
	deps: UsageDeps;
	onEmit: (eventName: string, payload: UsageCorePayload) => void;
}

export interface UsageCore {
	bootstrap(): Promise<void>;
	populateProviders(force?: boolean, signal?: AbortSignal): Promise<void>;
	refreshOffline(refresh: boolean, token?: ScanToken): Promise<void>;
	prepareUsageDashboard(refresh: boolean): Promise<{
		cancelScan: () => void;
		scan: Promise<void> | undefined;
	}>;
	updateModel(
		model:
			| { provider?: string; id?: string; name?: string }
			| undefined,
	): void;
	emitProviderUpdate(force?: boolean, signal?: AbortSignal): Promise<void>;
	getState(): UsageCoreState;
	isLiveProvider(id: ProviderId | null): boolean;
	startLiveRuntime(): void;
	shutdown(): void;
}

export function createUsageCore(options: UsageCoreOptions): UsageCore {
	const { deps, onEmit } = options;

	// --- Provider registry (created once, reused) ---
	const providers = createProviderRegistry(deps);
	const liveProviderIds = new Set(
		providers.filter((p) => p.strategy === "api").map((p) => p.id),
	);
	const liveProviderSnapshotFiles = new Set(
		[...liveProviderIds].map((id) => `${id}.json`),
	);

	// --- State ---
	const state: InternalState = {
		refreshRequested: false,
		generatedAt: 0,
		loading: false,
		offline: {
			providerId: "offline",
			totals: [],
			periods: [],
			scannedFiles: 0,
			messageCount: 0,
		},
		insights: [],
		currentProviderId: null,
		providers: [],
		diagnostics: [],
	};

	// --- Internal variables ---
	let providerRefresh: Promise<void> | null = null;
	let providerForcePending = false;
	let periodicRefresh: NodeJS.Timeout | undefined;
	let cacheWatcher: { close: () => void } | undefined;
	let localCommandCodeCost = 0;

	// --- Helpers ---
	function emit(eventName: string): void {
		onEmit(eventName, { state: structuredClone(projectState(state)) });
	}

	function getState(): UsageCoreState {
		return structuredClone(projectState(state));
	}

	function isLiveProvider(id: ProviderId | null): boolean {
		return id !== null && liveProviderIds.has(id);
	}

	function applyCommandCodeLocalFallback(): void {
		const ccIndex = state.providers.findIndex(
			(p) => p.providerId === "command-code",
		);
		if (
			ccIndex < 0 ||
			localCommandCodeCost <= 0 ||
			state.providers[ccIndex].available
		) {
			return;
		}
		state.providers[ccIndex] = {
			...state.providers[ccIndex],
			available: true,
			status: "local",
			sourceKind: "local",
			sourceLabel: "Local Pi sessions",
			diagnostic: "Live unavailable; showing local Pi session history.",
			diagnostics: [
				"Snapshot reflects only local Pi session history.",
				...state.providers[ccIndex].diagnostics,
			],
			windows: [],
			balances: [
				{
					label: "Local Pi session total",
					remaining: localCommandCodeCost,
					unit: "USD",
				},
			],
		};
	}

	// --- Core methods ---
	async function populateProviders(
		force = false,
		signal?: AbortSignal,
	): Promise<void> {
		if (providerRefresh) {
			if (force) providerForcePending = true;
			await providerRefresh;
			if (force && providerForcePending) {
				providerForcePending = false;
				await populateProviders(true, signal);
			}
			return;
		}

		providerRefresh = mapWithLimit(
			providers,
			3,
			async (provider) =>
				(
					await provider.fetch({
						force,
						signal,
					})
				).snapshot,
		)
			.then((snapshots) => {
				state.providers = snapshots;
				applyCommandCodeLocalFallback();
			})
			.finally(() => {
				providerRefresh = null;
			});
		return providerRefresh;
	}

	async function refreshOffline(
		refresh: boolean,
		token?: ScanToken,
	): Promise<void> {
		state.loading = true;
		emit(USAGE_CORE_UPDATE_CURRENT_EVENT);
		const result = await scanOfflineUsage(deps, {
			refresh,
			shouldCancel: () => token?.cancelled === true,
		});
		if (token?.cancelled) {
			state.loading = false;
			emit(USAGE_CORE_UPDATE_CURRENT_EVENT);
			return;
		}
		state.offline.periods = buildPeriods(result);
		state.offline.scannedFiles = result.scannedFiles;
		state.offline.messageCount = result.turns.length;
		state.insights = buildInsights(result.turns);
		localCommandCodeCost = result.turns
			.filter(
				(turn) =>
					(turn.provider === "command-code" ||
						turn.provider === "commandcode") &&
					turn.cost > 0,
			)
			.reduce((sum, turn) => sum + turn.cost, 0);

		applyCommandCodeLocalFallback();

		state.generatedAt = deps.now();
		state.loading = false;
		emit(USAGE_CORE_UPDATE_CURRENT_EVENT);
	}

	async function bootstrap(): Promise<void> {
		await Promise.all([populateProviders(false), refreshOffline(false)]);
		state.diagnostics = ["live runtime ready"];
		emit(USAGE_CORE_READY_EVENT);
	}

	function updateModel(
		model:
			| { provider?: string; id?: string; name?: string }
			| undefined,
	): void {
		state.currentProviderId = detectProviderFromModel(model) ?? null;
		state.currentModelLabel = model?.id ?? model?.name;
	}

	async function emitProviderUpdate(
		force = false,
		signal?: AbortSignal,
	): Promise<void> {
		await populateProviders(force, signal);
		emit(USAGE_CORE_UPDATE_CURRENT_EVENT);
	}

	async function prepareUsageDashboard(refresh: boolean): Promise<{
		cancelScan: () => void;
		scan: Promise<void> | undefined;
	}> {
		if (refresh) {
			state.refreshRequested = true;
			state.diagnostics = [...state.diagnostics, "refresh requested"];
			emit(USAGE_CORE_UPDATE_CURRENT_EVENT);
		}

		await populateProviders(refresh);
		const scanToken: ScanToken = { cancelled: false };
		const shouldScan =
			refresh || (state.offline.periods.length === 0 && !state.loading);
		const scan = shouldScan
			? refreshOffline(refresh, scanToken)
			: undefined;
		return {
			cancelScan: () => {
				scanToken.cancelled = true;
			},
			scan,
		};
	}

	function startLiveRuntime(): void {
		if (!periodicRefresh) {
			periodicRefresh = deps.setInterval(() => {
				void emitProviderUpdate(false).catch(() => undefined);
			}, 1_800_000);
			deps.unrefTimer(periodicRefresh);
		}
		if (!cacheWatcher) {
			void deps
				.mkdir(providerCacheDir(deps), { recursive: true })
				.then(() => {
					cacheWatcher = deps.watch(
						providerCacheDir(deps),
						(filename) => {
							if (
								!filename ||
								!liveProviderSnapshotFiles.has(filename)
							)
								return;
							void emitProviderUpdate(false).catch(
								() => undefined,
							);
						},
					);
				})
				.catch(() => undefined);
		}
	}

	function shutdown(): void {
		if (periodicRefresh) deps.clearInterval(periodicRefresh);
		periodicRefresh = undefined;
		cacheWatcher?.close();
		cacheWatcher = undefined;
	}

	return {
		bootstrap,
		populateProviders,
		refreshOffline,
		prepareUsageDashboard,
		updateModel,
		emitProviderUpdate,
		getState,
		isLiveProvider,
		startLiveRuntime,
		shutdown,
	};
}
