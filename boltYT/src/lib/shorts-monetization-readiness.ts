import type { ClipRemixPolicyReport } from "./clip-remix-policy";

export type ShortsUploadVerdict = "upload_ready" | "needs_review" | "blocked";

export type NarrationTrackKind =
	| "human"
	| "premium_tts"
	| "basic_tts"
	| "none";

export type AudioLicenseBasis =
	| "owned"
	| "licensed"
	| "youtube_audio_library"
	| "pixabay_content_license"
	| "creative_commons"
	| "public_domain"
	| "unknown";

export type ThirdPartyLogoUse = "none" | "incidental" | "branding" | "unclear";

export interface ShortsMonetizationReadinessInput {
	durationSeconds: number;
	sceneCount: number;
	captions: string[];
	clipPolicy: ClipRemixPolicyReport;
	narration: {
		kind: NarrationTrackKind;
		hasOriginalScript: boolean;
	};
	audio: {
		bgmLicenseBasis: AudioLicenseBasis;
		hasBgmAttribution: boolean;
		hasSoundDesign: boolean;
		integratedLufs?: number;
		truePeakDb?: number;
	};
	brandSafety: {
		thirdPartyLogoUse: ThirdPartyLogoUse;
		impliesThirdPartyEndorsement: boolean;
		hasNoEndorsementDisclaimer: boolean;
	};
	metadata: {
		hasSourceCreditInDescription: boolean;
		hasSyntheticOrAlteredDisclosure: boolean;
	};
}

export interface ShortsMonetizationReadinessReport {
	verdict: ShortsUploadVerdict;
	score: number;
	blockers: string[];
	warnings: string[];
	requiredActions: string[];
	breakdown: {
		rights: number;
		transformation: number;
		captionTone: number;
		audio: number;
		metadata: number;
	};
	sourceClipRatio: number;
}

const CLEAR_AUDIO_LICENSES: AudioLicenseBasis[] = [
	"owned",
	"licensed",
	"youtube_audio_library",
	"pixabay_content_license",
	"creative_commons",
	"public_domain",
];

const META_CAPTION_TERMS = [
	"리믹스",
	"샘플",
	"출처표기",
	"타임라인",
	"구성",
	"포맷",
	"제작 방식",
	"설명 영상",
];

function addUnique(items: string[], item: string) {
	if (!items.includes(item)) items.push(item);
}

function clampScore(value: number): number {
	return Math.max(0, Math.min(100, Math.round(value)));
}

function averageCaptionLength(captions: string[]): number {
	const visibleLines = captions
		.flatMap((caption) => caption.split("\n"))
		.map((line) => line.trim())
		.filter(Boolean);
	if (visibleLines.length === 0) return 0;
	return (
		visibleLines.reduce((sum, line) => sum + line.length, 0) /
		visibleLines.length
	);
}

function captionToneScore(captions: string[], warnings: string[]): number {
	if (captions.length === 0) {
		warnings.push("Captions are missing; Shorts viewers need a readable story layer.");
		return 0;
	}

	let score = 100;
	const maxLineLength = Math.max(
		...captions.flatMap((caption) => caption.split("\n").map((line) => line.trim().length)),
	);
	const avgLineLength = averageCaptionLength(captions);
	const joined = captions.join(" ");

	if (maxLineLength > 28) {
		score -= 18;
		warnings.push("Some caption lines are too long for fast mobile reading.");
	}
	if (avgLineLength > 20) {
		score -= 12;
		warnings.push("Caption wording still reads closer to explanation than Shorts pacing.");
	}
	if (META_CAPTION_TERMS.some((term) => joined.includes(term))) {
		score -= 25;
		warnings.push("Captions include production-meta wording instead of viewer-facing story.");
	}
	if (!captions[0] || captions[0].length > 34) {
		score -= 10;
		warnings.push("The first caption should be a short hook, not a setup paragraph.");
	}

	return clampScore(score);
}

function audioScore(
	input: ShortsMonetizationReadinessInput,
	blockers: string[],
	warnings: string[],
	requiredActions: string[],
): number {
	let score = 100;

	if (!CLEAR_AUDIO_LICENSES.includes(input.audio.bgmLicenseBasis)) {
		score -= 45;
		blockers.push("BGM license is not cleared for monetized upload.");
		addUnique(requiredActions, "Use owned, licensed, YouTube Audio Library, Pixabay Content License, Creative Commons, or public-domain BGM.");
	}

	if (
		input.audio.bgmLicenseBasis === "pixabay_content_license" &&
		!input.audio.hasBgmAttribution
	) {
		warnings.push("Pixabay attribution is not required by default, but storing track attribution improves auditability.");
		addUnique(requiredActions, "Store BGM title, creator, URL, and license basis with the render.");
	}

	if (!input.audio.hasSoundDesign) {
		score -= 10;
		warnings.push("No sound-design layer is present; the edit may feel flat in Shorts.");
	}

	if (input.audio.truePeakDb !== undefined && input.audio.truePeakDb > -1) {
		score -= 20;
		blockers.push("Audio true peak is too hot for upload-safe mastering.");
		addUnique(requiredActions, "Lower final master so true peak stays at or below -1 dBFS.");
	}

	if (input.audio.integratedLufs !== undefined) {
		if (input.audio.integratedLufs > -12) {
			score -= 16;
			warnings.push("Integrated loudness is aggressive and may sound crushed on mobile.");
		}
		if (input.audio.integratedLufs < -18) {
			score -= 14;
			warnings.push("Integrated loudness is low for a Shorts-style upload.");
		}
	}

	return clampScore(score);
}

export function evaluateShortsMonetizationReadiness(
	input: ShortsMonetizationReadinessInput,
): ShortsMonetizationReadinessReport {
	const blockers: string[] = [];
	const warnings: string[] = [];
	const requiredActions: string[] = [];

	if (input.clipPolicy.verdict === "blocked") {
		blockers.push("Clip remix policy is blocked.");
		addUnique(requiredActions, "Clear source rights or change to a permitted source before upload.");
	}
	if (input.clipPolicy.verdict === "review_required") {
		warnings.push("Clip remix policy requires manual review.");
		addUnique(requiredActions, "Complete manual source-rights review before public upload.");
	}
	if (!input.metadata.hasSourceCreditInDescription) {
		blockers.push("Description source credit is missing.");
		addUnique(requiredActions, "Add source title, creator, URL, and license/rights basis to the description.");
	}

	let rights = input.clipPolicy.verdict === "cleared" ? 100 : 55;
	if (input.clipPolicy.verdict === "blocked") rights = 0;

	let transformation = input.clipPolicy.transformationScore;
	const sourceRatio = input.clipPolicy.sourceClipRatio;
	if (sourceRatio > 0.55) {
		transformation -= 20;
		warnings.push("Source footage dominates the short; add more original narration or restructuring.");
		addUnique(requiredActions, "Keep third-party source footage at or below 55% for automatic upload readiness.");
	}
	if (input.narration.kind === "none") {
		transformation -= 18;
		warnings.push("No narration track is present; caption-only commentary needs stronger originality review.");
		addUnique(requiredActions, "Add human or premium-TTS narration for a stronger monetization case.");
	}
	if (input.narration.kind === "basic_tts") {
		transformation -= 12;
		warnings.push("Basic TTS can make the video feel mass-produced.");
		addUnique(requiredActions, "Replace basic TTS with human voice or premium TTS.");
	}
	if (!input.narration.hasOriginalScript) {
		transformation -= 25;
		blockers.push("Narration/script is not clearly original.");
		addUnique(requiredActions, "Write original commentary rather than paraphrasing the source.");
	}
	transformation = clampScore(transformation);

	const captionTone = captionToneScore(input.captions, warnings);
	const audio = audioScore(input, blockers, warnings, requiredActions);

	let metadata = 100;
	if (!input.metadata.hasSyntheticOrAlteredDisclosure) {
		metadata -= 12;
		warnings.push("Synthetic/altered-content disclosure has not been recorded.");
		addUnique(requiredActions, "Record whether the upload needs YouTube altered-content disclosure.");
	}
	if (input.brandSafety.impliesThirdPartyEndorsement) {
		metadata -= 45;
		blockers.push("Third-party branding implies endorsement.");
		addUnique(requiredActions, "Remove endorsement implication or obtain explicit brand permission.");
	}
	if (
		input.brandSafety.thirdPartyLogoUse === "branding" ||
		input.brandSafety.thirdPartyLogoUse === "unclear"
	) {
		metadata -= 25;
		blockers.push("Third-party logo use is not incidental.");
		addUnique(requiredActions, "Avoid using third-party logos as your own branding.");
	}
	if (
		input.brandSafety.thirdPartyLogoUse === "incidental" &&
		!input.brandSafety.hasNoEndorsementDisclaimer
	) {
		metadata -= 10;
		warnings.push("Incidental third-party logo use should carry a no-endorsement disclaimer.");
		addUnique(requiredActions, "Add a no-endorsement disclaimer when official logos appear incidentally.");
	}
	metadata = clampScore(metadata);

	const avgSceneSeconds =
		input.sceneCount > 0 ? input.durationSeconds / input.sceneCount : input.durationSeconds;
	if (avgSceneSeconds > 4) {
		warnings.push("Average scene duration is slow for Shorts; tighten cuts or add movement.");
	}

	const score = clampScore(
		rights * 0.25 +
			transformation * 0.25 +
			captionTone * 0.2 +
			audio * 0.2 +
			metadata * 0.1,
	);

	const verdict: ShortsUploadVerdict =
		blockers.length > 0
			? "blocked"
			: sourceRatio > 0.55
				? "needs_review"
			: input.narration.kind === "none" || input.narration.kind === "basic_tts"
				? "needs_review"
				: score >= 82 && warnings.length <= 3
				? "upload_ready"
				: "needs_review";

	return {
		verdict,
		score,
		blockers,
		warnings,
		requiredActions,
		breakdown: {
			rights: clampScore(rights),
			transformation,
			captionTone,
			audio,
			metadata,
		},
		sourceClipRatio: sourceRatio,
	};
}
