import type { UsageCoreState } from "./types.ts";

export const USAGE_CORE_READY_EVENT = "usage-core:ready";
export const USAGE_CORE_UPDATE_CURRENT_EVENT = "usage-core:update-current";
export const USAGE_CORE_REQUEST_EVENT = "usage-core:request";

export interface UsageCorePayload {
  state: UsageCoreState;
}

export interface UsageCoreCurrentRequest {
  type: "current";
  reply(payload: UsageCorePayload): void;
}
