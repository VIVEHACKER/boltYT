import {
	buildClipRemixAttribution,
	evaluateClipRemixPlan,
	type ClipRemixIntent,
	type ClipRemixPolicyReport,
	type ClipRemixRightsBasis,
} from "./clip-remix-policy";

export type ClipRemixBeatKind =
	| "hook"
	| "source_context"
	| "evidence_clip"
	| "commentary"
	| "takeaway"
	| "attribution";

export interface ClipRemixRecipeInput {
	sourceUrl: string;
	sourceTitle: string;
	sourceCreator: string;
	topic: string;
	targetDurationSeconds?: number;
	sourceClipSeconds?: number;
	rightsBasis: ClipRemixRightsBasis;
	intent?: ClipRemixIntent;
}

export interface ClipRemixBeat {
	kind: ClipRemixBeatKind;
	start: number;
	end: number;
	purpose: string;
	visualDirection: string;
	narrationDirection: string;
}

export interface ClipRemixRecipe {
	format: "source_commentary_short";
	targetDurationSeconds: number;
	sourceClipSeconds: number;
	sourceClipRatio: number;
	policy: ClipRemixPolicyReport;
	beats: ClipRemixBeat[];
	renderRules: {
		aspectRatio: "9:16";
		reframe: "vertical_fill_blur" | "crop_subject_center";
		originalAudioUsage: "muted" | "ducked";
		requireLowerThirdAttribution: boolean;
		requireDescriptionCredit: boolean;
	};
	descriptionCredit: string;
}

function roundTime(value: number): number {
	return Math.round(value * 10) / 10;
}

function clampDuration(value: number | undefined): number {
	if (!Number.isFinite(value)) return 35;
	return Math.max(25, Math.min(60, Number(value)));
}

function clampSourceClipSeconds(value: number | undefined, duration: number): number {
	if (!Number.isFinite(value)) return Math.min(14, duration * 0.4);
	return Math.max(3, Math.min(Number(value), duration));
}

function beat(
	kind: ClipRemixBeatKind,
	start: number,
	end: number,
	purpose: string,
	visualDirection: string,
	narrationDirection: string,
): ClipRemixBeat {
	return {
		kind,
		start: roundTime(start),
		end: roundTime(end),
		purpose,
		visualDirection,
		narrationDirection,
	};
}

export function buildSourceCommentaryShortRecipe(
	input: ClipRemixRecipeInput,
): ClipRemixRecipe {
	const targetDurationSeconds = clampDuration(input.targetDurationSeconds);
	const sourceClipSeconds = clampSourceClipSeconds(
		input.sourceClipSeconds,
		targetDurationSeconds,
	);
	const attribution = buildClipRemixAttribution({
		url: input.sourceUrl,
		title: input.sourceTitle,
		creator: input.sourceCreator,
		rightsBasis: input.rightsBasis,
	});
	const policy = evaluateClipRemixPlan({
		intent: input.intent ?? "commentary",
		source: {
			url: input.sourceUrl,
			title: input.sourceTitle,
			creator: input.sourceCreator,
			rightsBasis: input.rightsBasis,
		},
		totalShortSeconds: targetDurationSeconds,
		sourceClipSeconds,
		keepsOriginalSequence: false,
		hasNewNarration: true,
		hasOriginalCommentary: true,
		hasAttribution: true,
		hasSourceDisclosure: true,
		addsCaptionsOrGraphics: true,
		originalAudioUsage: "ducked",
	});

	const d = targetDurationSeconds;
	const beats: ClipRemixBeat[] = [
		beat(
			"hook",
			0,
			Math.min(3.2, d * 0.1),
			"Open with the surprising claim before naming the source.",
			"Use a fast title card plus the strongest 0.5-1s visual moment as a blurred background.",
			`Frame ${input.topic} as a one-sentence curiosity hook.`,
		),
		beat(
			"source_context",
			Math.min(3.2, d * 0.1),
			Math.min(7.2, d * 0.2),
			"Explain who made the original material and why it matters.",
			"Show lower-third attribution and a short source-card overlay.",
			`Name the source creator and summarize the premise without copying the original wording.`,
		),
		beat(
			"evidence_clip",
			Math.min(7.2, d * 0.2),
			Math.min(18, d * 0.52),
			"Use short source snippets as evidence, not as the whole video.",
			"Cut 2-3 micro excerpts, duck original audio, and keep branded attribution visible.",
			"Describe what viewers are seeing and why the moment is unusual.",
		),
		beat(
			"commentary",
			Math.min(18, d * 0.52),
			Math.min(28, d * 0.78),
			"Add the creator's own interpretation so the remix has new value.",
			"Switch to motion graphics, zoom callouts, arrows, or recreated diagrams.",
			"Connect the source clip to the broader takeaway.",
		),
		beat(
			"takeaway",
			Math.min(28, d * 0.78),
			Math.min(d - 2.5, d * 0.93),
			"Close the story with a clean conclusion.",
			"Use a checklist or punchline card instead of another raw source clip.",
			"State the lesson, implication, or reason the source clip matters.",
		),
		beat(
			"attribution",
			Math.min(d - 2.5, d * 0.93),
			d,
			"End with clear source credit.",
			"Show source title, creator, and credit line in the lower third or end card.",
			"Credit the original source and direct viewers to the full source where appropriate.",
		),
	];

	return {
		format: "source_commentary_short",
		targetDurationSeconds,
		sourceClipSeconds,
		sourceClipRatio: Number((sourceClipSeconds / targetDurationSeconds).toFixed(3)),
		policy,
		beats,
		renderRules: {
			aspectRatio: "9:16",
			reframe: "vertical_fill_blur",
			originalAudioUsage: "ducked",
			requireLowerThirdAttribution: true,
			requireDescriptionCredit: true,
		},
		descriptionCredit: `${attribution}\nOriginal URL: ${input.sourceUrl}`,
	};
}
