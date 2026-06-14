/**
 * Map items through an async function with bounded concurrency.
 * Workers pull from a shared queue — at most `limit` run simultaneously.
 * Results preserve input order.
 */
export async function mapWithLimit<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let idx = 0;

	async function worker(): Promise<void> {
		while (idx < items.length) {
			const i = idx++;
			results[i] = await fn(items[i]);
		}
	}

	const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
		worker(),
	);
	await Promise.all(workers);
	return results;
}
