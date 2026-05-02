import type { BgmMood, BgmTrack } from "./bgm";

export interface BgmQualityContext {
	mood?: BgmMood | "";
	keywords?: string[];
	tempo?: "slow" | "mid" | "fast";
}

export interface BgmQualityResult {
	score: number;
	passed: boolean;
	reasons: string[];
	warnings: string[];
}

export type ScoredBgmTrack = BgmTrack & {
	qualityScore: number;
	qualityReasons: string[];
	qualityWarnings: string[];
};

const MIN_PROFESSIONAL_BGM_SCORE = 64;

const MOOD_POSITIVE_TERMS: Record<BgmMood, string[]> = {
	dark: [
		"dark",
		"ambient",
		"horror",
		"creepy",
		"scary",
		"drone",
		"suspense",
		"mystery",
		"noir",
	],
	tense: [
		"tension",
		"tense",
		"suspense",
		"thriller",
		"pulse",
		"cinematic",
		"dark",
		"trailer",
	],
	mysterious: [
		"mystery",
		"mysterious",
		"detective",
		"investigation",
		"ambient",
		"suspense",
		"piano",
		"dark",
	],
	dramatic: [
		"dramatic",
		"cinematic",
		"documentary",
		"emotional",
		"orchestra",
		"strings",
		"serious",
		"trailer",
	],
	calm: [
		"calm",
		"soft",
		"peaceful",
		"ambient",
		"piano",
		"warm",
		"minimal",
		"gentle",
	],
	upbeat: [
		"upbeat",
		"energetic",
		"positive",
		"inspiring",
		"uplifting",
		"pop",
		"funk",
		"urban",
	],
	epic: [
		"epic",
		"cinematic",
		"trailer",
		"orchestra",
		"hero",
		"powerful",
		"battle",
		"build",
	],
	sad: [
		"sad",
		"emotional",
		"melancholy",
		"lonely",
		"piano",
		"cinematic",
		"ambient",
		"introspective",
	],
};

const MOOD_NEGATIVE_TERMS: Record<BgmMood, string[]> = {
	dark: ["happy", "funny", "comedy", "cute", "ukulele", "kids", "corporate", "christmas"],
	tense: ["happy", "funny", "comedy", "cute", "relaxing", "ukulele", "corporate", "christmas"],
	mysterious: ["happy", "funny", "comedy", "cute", "motivation", "corporate", "dance"],
	dramatic: ["funny", "comedy", "cute", "kids", "ukulele", "corporate", "jingle"],
	calm: ["horror", "scary", "aggressive", "battle", "dubstep", "metal", "trailer hit"],
	upbeat: ["horror", "creepy", "sad", "melancholy", "dark drone", "funeral"],
	epic: ["funny", "comedy", "cute", "kids", "ukulele", "lo-fi", "jingle"],
	sad: ["happy", "upbeat", "funky", "dance", "corporate", "comedy", "kids"],
};

const GLOBAL_REJECT_TERMS = [
	"jingle",
	"logo",
	"ident",
	"intro",
	"outro",
	"sting",
	"notification",
	"ringtone",
	"christmas",
	"birthday",
	"kids",
	"children",
	"cartoon",
	"comedy",
	"funny",
	"meme",
	"cute",
	"ukulele",
	"holiday",
	"meditation",
	"advertising",
	"commercial",
	"corporate",
	"corporate presentation",
];

const VOCAL_RISK_TERMS = [
	"vocal",
	"vocals",
	"lyrics",
	"song",
	"singer",
	"singing",
	"rap",
	"choir",
	"voice",
];

function normalize(value: string): string {
	return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function haystack(track: BgmTrack): string {
	return normalize(`${track.title} ${track.artist} ${track.tags.join(" ")}`);
}

function includesTerm(text: string, term: string): boolean {
	return text.includes(normalize(term));
}

function countTerms(text: string, terms: string[]): number {
	return terms.filter((term) => includesTerm(text, term)).length;
}

function pushUnique(target: string[], value: string) {
	if (!target.includes(value)) target.push(value);
}

export function assessBgmTrackQuality(
	track: BgmTrack,
	context: BgmQualityContext = {},
): BgmQualityResult {
	const text = haystack(track);
	const reasons: string[] = [];
	const warnings: string[] = [];
	let score = 50;

	const mood = context.mood || "";
	if (mood) {
		const positive = countTerms(text, MOOD_POSITIVE_TERMS[mood]);
		const negative = countTerms(text, MOOD_NEGATIVE_TERMS[mood]);
		if (positive > 0) {
			score += Math.min(34, positive * 8);
			pushUnique(reasons, `${mood} mood match`);
		} else {
			score -= 12;
			pushUnique(warnings, "mood keyword mismatch");
		}
		if (negative > 0) {
			score -= Math.min(42, negative * 18);
			pushUnique(warnings, `${mood} mood conflict`);
		}
	}

	const keywordMatches = countTerms(text, context.keywords ?? []);
	if (keywordMatches > 0) {
		score += Math.min(16, keywordMatches * 5);
		pushUnique(reasons, "reference keyword match");
	}

	const globalRejects = countTerms(text, GLOBAL_REJECT_TERMS);
	if (globalRejects > 0) {
		score -= Math.min(60, globalRejects * 24);
		pushUnique(warnings, "background-music reject term");
	}

	const vocalRisks = countTerms(text, VOCAL_RISK_TERMS);
	if (vocalRisks > 0) {
		score -= Math.min(44, vocalRisks * 22);
		pushUnique(warnings, "vocal or lyrics risk");
	}

	if (track.duration < 45) {
		score -= 30;
		pushUnique(warnings, "too short for stable background bed");
	} else if (track.duration < 60) {
		score -= 12;
		pushUnique(warnings, "short background bed");
	} else {
		score += 6;
		pushUnique(reasons, "usable duration");
	}

	if (context.tempo === "fast" && track.duration > 260) {
		score -= 5;
		pushUnique(warnings, "long track for fast pacing");
	}
	if (context.tempo === "slow" && track.duration < 90) {
		score -= 8;
		pushUnique(warnings, "short track for slow pacing");
	}

	const finalScore = Math.max(0, Math.min(100, Math.round(score)));
	return {
		score: finalScore,
		passed: finalScore >= MIN_PROFESSIONAL_BGM_SCORE,
		reasons,
		warnings,
	};
}

export function rankBgmTracks(
	tracks: BgmTrack[],
	context: BgmQualityContext = {},
): ScoredBgmTrack[] {
	return tracks
		.map((track) => {
			const quality = assessBgmTrackQuality(track, context);
			return {
				...track,
				qualityScore: quality.score,
				qualityReasons: quality.reasons,
				qualityWarnings: quality.warnings,
			};
		})
		.sort((a, b) => b.qualityScore - a.qualityScore);
}

export function pickProfessionalBgmTrack(
	tracks: BgmTrack[],
	context: BgmQualityContext = {},
): ScoredBgmTrack | null {
	return (
		rankBgmTracks(tracks, context).find(
			(track) => track.qualityScore >= MIN_PROFESSIONAL_BGM_SCORE,
		) ?? null
	);
}
