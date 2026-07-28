import { describe, expect, it } from "vitest";
import { UI_STRINGS } from "../src/shared/constants.ts";

describe("UI_STRINGS.dashboardFooters", () => {
  it("statistics footer matches expected format", () => {
    expect(UI_STRINGS.dashboardFooters.statistics).toBe(
      "[Tab/Shift-Tab] Switch tab \u2022 [Left/Right] Period \u2022 [Up/Down] Row \u2022 [Enter] Expand \u2022 [q/Esc] Close",
    );
  });

  it("current footer matches expected format", () => {
    expect(UI_STRINGS.dashboardFooters.current).toBe(
      "[Tab/Shift-Tab] Switch tab \u2022 [Left/Right] Provider \u2022 [q/Esc] Close",
    );
  });

  it("prioritizes category navigation in the insights footer", () => {
    expect(UI_STRINGS.dashboardFooters.insights).toBe(
      "[Left/Right] Category \u2022 [Tab/Shift-Tab] Switch tab \u2022 [q/Esc] Close",
    );
  });
});
