export function detectProviderFromModel(
	model: { provider?: string; id?: string; name?: string } | undefined,
):
	| "openai-codex"
	| "minimax"
	| "stepfun"
	| "opencode-go"
	| "command-code"
	| "openrouter"
	| undefined {
	if (!model) return undefined;
	const p = (model.provider ?? "").trim().toLowerCase();
	if (p === "openai-codex") return "openai-codex";
	if (p === "minimax" || p === "minimax-openai") return "minimax";
	if (p === "stepfun") return "stepfun";
	if (p === "opencode-go") return "opencode-go";
	if (p === "command-code" || p === "commandcode") return "command-code";
	if (p === "openrouter") return "openrouter";
	if (p) return undefined;
	const n = (model.id ?? model.name ?? "").toLowerCase();
	if (n.includes("codex")) return "openai-codex";
	if (n.includes("minimax")) return "minimax";
	if (n.includes("stepfun")) return "stepfun";
	if (n.includes("opencode-go")) return "opencode-go";
	if (n.includes("command-code") || n.includes("commandcode")) {
		return "command-code";
	}
	return undefined;
}
