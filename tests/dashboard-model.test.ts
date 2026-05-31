import { describe, expect, it } from "vitest";
import { buildPeriods } from "../src/ui/dashboard-model.ts";

describe("dashboard-model", () => {
  it("maps cache fields and preserves token/input semantics", () => {
    const sessions = new Set(["s1"]);
    const result = {
      periods: {
        today: {
          total: {
            sessions,
            messages: 1,
            input: 10,
            output: 20,
            cacheRead: 7,
            cacheWrite: 3,
            tokens: 33,
            cost: 1,
          },
          providers: new Map([
            [
              "openai-codex",
              {
                sessions,
                messages: 1,
                input: 10,
                output: 20,
                cacheRead: 7,
                cacheWrite: 3,
                tokens: 33,
                cost: 1,
              },
            ],
          ]),
          modelsByProvider: new Map([
            [
              "openai-codex",
              new Map([
                [
                  "gpt-5",
                  {
                    sessions,
                    messages: 1,
                    input: 10,
                    output: 20,
                    cacheRead: 7,
                    cacheWrite: 3,
                    tokens: 33,
                    cost: 1,
                  },
                ],
              ]),
            ],
          ]),
        },
        thisWeek: { total: { sessions: new Set(), messages: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tokens: 0, cost: 0 }, providers: new Map(), modelsByProvider: new Map() },
        lastWeek: { total: { sessions: new Set(), messages: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tokens: 0, cost: 0 }, providers: new Map(), modelsByProvider: new Map() },
        allTime: { total: { sessions: new Set(), messages: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tokens: 0, cost: 0 }, providers: new Map(), modelsByProvider: new Map() },
      },
    } as never;

    const periods = buildPeriods(result);
    const row = periods[0].providers[0];
    expect(row.cacheRead).toBe(7);
    expect(row.cacheWrite).toBe(3);
    expect(row.cache).toBe(10);
    expect(row.tokens).toBe(33);
    expect(row.input).toBe(10);
  });
});
