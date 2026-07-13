export type ClipRemixRightsBasis =
	| "owned"
	| "licensed"
	| "permission"
	| "creative_commons"
	| "public_domain"
	| "platform_remix_feature"
	| "fair_use_commentary"
	| "standard_youtube_license"
	| "unknown";

export type ClipRemixIntent =
	| "commentary"
	| "education"
	| "news"
	| "reaction"
	| "compilation"
	| "reupload";

export type OriginalAudioUsage = "muted" | "ducked" | "primary";

export type ClipRemixVerdict = "cleared" | "review_required" | "blocked";

export interface ClipRemixSource {
	url: string;
	title?: string;
	creator?: string;
	rightsBasis: ClipRemixRightsBasis;
}

export interface ClipRemixPlan {
	intent: ClipRemixIntent;
	source: ClipRemixSource;
	totalShortSeconds: number;
	sourceClipSeconds: number;
	keepsOriginalSequence: boolean;
	hasNewNarration: boolean;
	hasOriginalCommentary: boolean;
	hasAttribution: boolean;
	hasSourceDisclosure: boolean;
	addsCaptionsOrGraphics: boolean;
	originalAudioUsage: OriginalAudioUsage;
}

export interface ClipRemixPolicyReport {
	verdict: ClipRemixVerdict;
	canFetchSourceClip: boolean;
	canQueuePublicUpload: boolean;
	transformationScore: number;
	sourceClipRatio: number;
	blockers: string[];
	warnings: string[];
	requiredActions: string[];
	attribution: string;
}

const CLEAR_RIGHTS: ClipRemixRightsBasis[] = [
	"owned",
	"licensed",
	"permission",
	"creative_commons",
	"public_domain",
	"platform_remix_feature",
];

function clampRatio(value: number): number {
	if (!Number.isFinite(value)) return 1;
	return Math.max(0, Math.min(1, value));
}

function positiveSeconds(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, value);
}

function addUnique(items: string[], item: string) {
	if (!items.includes(item)) items.push(item);
}

export function buildClipRemixAttribution(source: ClipRemixSource): string {
	const title = source.title?.trim() || "Untitled source";
	const creator = source.creator?.trim() || "Unknown creator";
	return `Source clip: ${title} - ${creator}`;
}

export function scoreClipRemixTransformation(plan: ClipRemixPlan): number {
	let score = 0;
	if (plan.hasNewNarration) score += 28;
	if (plan.hasOriginalCommentary) score += 24;
	if (plan.addsCaptionsOrGraphics) score += 14;
	if (!plan.keepsOriginalSequence) score += 14;
	if (plan.originalAudioUsage === "muted") score += 10;
	if (plan.originalAudioUsage === "ducked") score += 6;
	if (plan.hasAttribution) score += 4;
	if (plan.hasSourceDisclosure) score += 4;
	if (plan.intent === "reupload") score -= 36;
	if (plan.intent === "compilation") score -= 12;
	if (plan.originalAudioUsage === "primary" && !plan.hasNewNarration) score -= 16;
	return Math.max(0, Math.min(100, score));
}

export function evaluateClipRemixPlan(
	plan: ClipRemixPlan,
): ClipRemixPolicyReport {
	const blockers: string[] = [];
	const warnings: string[] = [];
	const requiredActions: string[] = [];
	const sourceClipSeconds = positiveSeconds(plan.sourceClipSeconds);
	const totalShortSeconds = positiveSeconds(plan.totalShortSeconds);
	const sourceClipRatio = clampRatio(
		totalShortSeconds > 0 ? sourceClipSeconds / totalShortSeconds : 1,
	);
	const transformationScore = scoreClipRemixTransformation(plan);
	const attribution = buildClipRemixAttribution(plan.source);
	const rightsAreClear = CLEAR_RIGHTS.includes(plan.source.rightsBasis);
	const fairUseClaim = plan.source.rightsBasis === "fair_use_commentary";

	if (plan.intent === "reupload") {
		blockers.push("Direct reupload is not a remix workflow.");
	}

	if (
		plan.source.rightsBasis === "unknown" ||
		plan.source.rightsBasis === "standard_youtube_license"
	) {
		blockers.push(
			"Source rights are not cleared. Use owned, licensed, permitted, Creative Commons, public-domain, platform-remix, or manually reviewed commentary use.",
		);
	}

	if (!plan.hasAttribution) {
		blockers.push("Source attribution is required for third-party clips.");
		addUnique(requiredActions, "Add source title and creator attribution.");
	}

	if (!plan.hasSourceDisclosure) {
		warnings.push("Public uploads should disclose that third-party clips are used.");
		addUnique(requiredActions, "Add a source disclosure in the description or lower third.");
	}

	if (sourceClipSeconds > 60 && !rightsAreClear) {
		blockers.push("Uncleared third-party clips must not exceed 60 seconds.");
	}

	if (sourceClipRatio > 0.5 && !rightsAreClear) {
		blockers.push("The third-party clip dominates the short. Reduce source usage below 50% or clear rights.");
	}

	if (transformationScore < 45) {
		blockers.push(
			"Transformative layer is too weak. Add new narration, commentary, graphics, or restructuring.",
		);
	}

	if (
		plan.originalAudioUsage === "primary" &&
		!plan.hasNewNarration &&
		!plan.hasOriginalCommentary
	) {
		blockers.push("Original audio cannot be the primary track without new commentary.");
	}

	if (plan.keepsOriginalSequence && !rightsAreClear) {
		warnings.push("Keeping the original sequence increases copy risk.");
		addUnique(requiredActions, "Reorder clips around a new problem-method-result structure.");
	}

	if (fairUseClaim) {
		warnings.push(
			"Fair-use commentary is context-dependent and needs manual review before upload.",
		);
	}

	const verdict: ClipRemixVerdict =
		blockers.length > 0
			? "blocked"
			: fairUseClaim
				? "review_required"
				: "cleared";

	return {
		verdict,
		canFetchSourceClip: verdict !== "blocked",
		canQueuePublicUpload: verdict === "cleared",
		transformationScore,
		sourceClipRatio: Number(sourceClipRatio.toFixed(3)),
		blockers,
		warnings,
		requiredActions,
		attribution,
	};
}
