import { describe, expect, it } from "vitest";
import { mapWithLimit } from "../src/shared/concurrency.ts";

describe("mapWithLimit", () => {
	it("maps all items preserving order", async () => {
		const result = await mapWithLimit([1, 2, 3, 4], 2, async (n) => n * 10);
		expect(result).toEqual([10, 20, 30, 40]);
	});

	it("respects concurrency limit", async () => {
		let running = 0;
		let maxRunning = 0;
		await mapWithLimit([1, 2, 3, 4, 5], 2, async (n) => {
			running++;
			maxRunning = Math.max(maxRunning, running);
			await new Promise((r) => setTimeout(r, 10));
			running--;
			return n;
		});
		expect(maxRunning).toBeLessThanOrEqual(2);
	});

	it("handles empty array", async () => {
		const result = await mapWithLimit([], 3, async (n: number) => n);
		expect(result).toEqual([]);
	});

	it("propagates first error", async () => {
		await expect(
			mapWithLimit([1, 2, 3], 2, async (n) => {
				if (n === 2) throw new Error("boom");
				return n;
			}),
		).rejects.toThrow("boom");
	});

	it("handles limit greater than items length", async () => {
		const result = await mapWithLimit([1, 2], 10, async (n) => n * 2);
		expect(result).toEqual([2, 4]);
	});
});
