import type {
	ImageResult,
	PexelsImageResult,
	PexelsVideoResult,
	PixabayImageResult,
	PixabayVideoResult,
	VideoResult,
	WikimediaImageResult,
} from "./search";

const EN_STOPWORDS = new Set([
	"the",
	"a",
	"an",
	"and",
	"or",
	"of",
	"to",
	"in",
	"on",
	"for",
	"with",
	"at",
	"from",
	"by",
	"scene",
	"footage",
	"video",
	"image",
	"photo",
	"shot",
	"screen",
]);

const KO_STOPWORDS = new Set([
	"그리고",
	"관련",
	"화면",
	"장면",
	"영상",
	"이미지",
	"사진",
	"속보",
	"보도",
	"기사",
	"현장",
]);

const BAD_IMAGE_TERMS = [
	"logo",
	"icon",
	"vector",
	"poster",
	"banner",
	"template",
	"illustration",
	"clipart",
	"cartoon",
	"meme",
	"썸네일",
	"로고",
	"아이콘",
	"일러스트",
	"포스터",
	"배너",
	"템플릿",
	"그래픽",
	"만화",
	"웹툰",
];

const BAD_VIDEO_TERMS = [
	"podcast",
	"lyrics",
	"lyric",
	"reaction",
	"vlog",
	"gameplay",
	"gaming",
	"asmr",
	"cover",
	"브이로그",
	"리액션",
	"게임",
	"노래",
	"뮤비",
	"커버",
];

const FOOTAGE_TERMS = [
	"cctv",
	"footage",
	"surveillance",
	"breaking",
	"exclusive",
	"official",
	"camera",
	"현장",
	"공개",
	"단독",
	"속보",
	"추적",
	"수색",
	"영상",
];

export interface RankedImageCandidate {
	id: string;
	provider: "naver" | "pexels" | "pixabay" | "wikimedia";
	downloadUrl: string;
	width?: number;
	height?: number;
	text?: string;
	score: number;
	relevanceScore?: number;
}

export interface RankedVideoCandidate {
	id: string;
	provider: "youtube" | "pexels" | "pixabay";
	downloadUrl?: string;
	thumbnail: string;
	title?: string;
	description?: string;
	channelTitle?: string;
	tags?: string;
	width?: number;
	height?: number;
	duration?: number;
	videoId?: string;
	score: number;
	relevanceScore?: number;
}

type MediaKind = "image" | "video";

export const MIN_IMAGE_CANDIDATE_SCORE = 18;
export const MIN_VIDEO_CANDIDATE_SCORE = 28;

function normalizeText(value?: string): string {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

function stripDateNoise(value: string): string {
	return value
		.replace(/\b(19|20)\d{2}[./-]\d{1,2}([./-]\d{1,2})?\b/g, " ")
		.replace(/\b(19|20)\d{2}년\s*\d{1,2}월(\s*\d{1,2}일)?\b/g, " ")
		.replace(/\b\d{1,2}월\s*\d{1,2}일\b/g, " ")
		.replace(/\b\d{4}\b/g, " ");
}

function tokenize(value: string): string[] {
	return normalizeText(value)
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]+/gu, " ")
		.split(/\s+/)
		.filter(Boolean);
}

export function compactSearchQuery(value: string, maxTokens = 6): string {
	const tokens = tokenize(stripDateNoise(value));
	const compact = tokens.filter((token) => {
		if (token.length <= 1) return false;
		return /[a-z]/i.test(token)
			? !EN_STOPWORDS.has(token)
			: !KO_STOPWORDS.has(token);
	});
	return compact.slice(0, maxTokens).join(" ");
}

export function buildSearchVariants(
	primary: string,
	secondary?: string,
	maxVariants = 4,
): string[] {
	const variants = [
		normalizeText(primary),
		normalizeText(stripDateNoise(primary)),
		compactSearchQuery(primary),
		normalizeText(secondary),
		secondary ? normalizeText(stripDateNoise(secondary)) : "",
		secondary ? compactSearchQuery(secondary) : "",
	].filter(Boolean);

	return [...new Set(variants)].slice(0, maxVariants);
}

function inferCueSet(value: string): Set<string> {
	const text = normalizeText(value).toLowerCase();
	const cues = new Set<string>();
	if (/cctv|surveillance|camera|블랙박스|폐쇄회로|현장 영상|공개 영상/u.test(text)) {
		cues.add("cctv");
	}
	if (/investigation|detective|police|search|수사|형사|경찰|추적|검거|수색/u.test(text)) {
		cues.add("investigation");
	}
	if (/evidence|forensic|document|record|call|memo|증거|포렌식|문건|기록|녹취|통화/u.test(text)) {
		cues.add("evidence");
	}
	if (/witness|interview|statement|portrait|목격|증언|진술|인터뷰|인물/u.test(text)) {
		cues.add("witness");
	}
	if (/timeline|archive|past|당시|이후|직후|기록|연표|타임라인/u.test(text)) {
		cues.add("archive");
	}
	return cues;
}

function pushVariant(list: string[], value: string) {
	const normalized = normalizeText(value);
	if (!normalized) return;
	list.push(normalized);
}

export function buildMediaSearchVariants(
	primary: string,
	secondary: string | undefined,
	options: {
		media: MediaKind;
		locale: "ko" | "en";
		maxVariants?: number;
	},
): string[] {
	const base = buildSearchVariants(primary, secondary, 6);
	const compactPrimary = compactSearchQuery(primary);
	const compactSecondary = secondary ? compactSearchQuery(secondary) : "";
	const compact = compactPrimary || compactSecondary;
	const cues = inferCueSet(`${primary} ${secondary ?? ""}`);
	const expanded = [...base];
	const maxVariants = options.maxVariants ?? 6;

	if (options.locale === "en") {
		if (options.media === "video") {
			pushVariant(expanded, `${compact} documentary footage`);
			pushVariant(expanded, `${compact} archive footage`);
			pushVariant(expanded, `${compact} news footage`);
			if (cues.has("cctv")) {
				pushVariant(expanded, `${compact} cctv footage`);
				pushVariant(expanded, `${compact} surveillance camera footage`);
			}
			if (cues.has("investigation")) {
				pushVariant(expanded, `${compact} police investigation footage`);
				pushVariant(expanded, `${compact} detective search footage`);
			}
			if (cues.has("witness")) {
				pushVariant(expanded, `${compact} interview footage`);
			}
		} else {
			pushVariant(expanded, `${compact} documentary photo`);
			pushVariant(expanded, `${compact} archive photo`);
			pushVariant(expanded, `${compact} news photo`);
			if (cues.has("evidence")) {
				pushVariant(expanded, `${compact} forensic evidence close up`);
				pushVariant(expanded, `${compact} document evidence photo`);
			}
			if (cues.has("witness")) {
				pushVariant(expanded, `${compact} portrait photo`);
			}
		}
	} else {
		if (options.media === "video") {
			pushVariant(expanded, `${compact} 현장 영상`);
			pushVariant(expanded, `${compact} 뉴스 영상`);
			pushVariant(expanded, `${compact} 기록 영상`);
			if (cues.has("cctv")) {
				pushVariant(expanded, `${compact} CCTV 영상`);
				pushVariant(expanded, `${compact} 감시카메라 영상`);
			}
			if (cues.has("investigation")) {
				pushVariant(expanded, `${compact} 수사 현장`);
				pushVariant(expanded, `${compact} 추적 현장 영상`);
			}
			if (cues.has("witness")) {
				pushVariant(expanded, `${compact} 인터뷰 영상`);
			}
		} else {
			pushVariant(expanded, `${compact} 기록 사진`);
			pushVariant(expanded, `${compact} 뉴스 사진`);
			pushVariant(expanded, `${compact} 현장 사진`);
			if (cues.has("evidence")) {
				pushVariant(expanded, `${compact} 포렌식 증거`);
				pushVariant(expanded, `${compact} 증거 자료 사진`);
			}
			if (cues.has("witness")) {
				pushVariant(expanded, `${compact} 인물 사진`);
			}
		}
	}

	return [...new Set(expanded.filter(Boolean))].slice(0, maxVariants);
}

function textOverlapScore(queries: string[], text?: string): number {
	const haystack = tokenize(text ?? "");
	if (haystack.length === 0) return 0;
	const haystackSet = new Set(haystack);
	let best = 0;
	for (const query of queries) {
		const tokens = tokenize(query).filter((token) => token.length > 1);
		if (tokens.length === 0) continue;
		const overlap = tokens.filter((token) => haystackSet.has(token)).length;
		const tokenScore = (overlap / tokens.length) * 34;
		const phraseScore = normalizeText(text)
			.toLowerCase()
			.includes(normalizeText(query).toLowerCase())
			? 10
			: 0;
		best = Math.max(best, tokenScore + phraseScore);
	}
	return best;
}

function containsAny(text: string, terms: string[]): boolean {
	const normalized = text.toLowerCase();
	return terms.some((term) => normalized.includes(term));
}

function stockRelevancePenalty(
	provider: string,
	relevanceScore: number,
	kind: MediaKind,
): number {
	if (provider !== "pexels" && provider !== "pixabay") {
		return relevanceScore <= 0 ? 10 : 0;
	}
	if (relevanceScore >= 6) return 0;
	if (relevanceScore > 0) return kind === "video" ? 20 : 16;
	return kind === "video" ? 72 : 56;
}

function scoreVerticalFraming(width?: number, height?: number): number {
	if (!width || !height) return 0;
	const ratio = width / height;
	const verticalTarget = 9 / 16;
	const landscapeTarget = 16 / 9;
	const verticalCloseness = Math.max(0, 1 - Math.abs(ratio - verticalTarget) / 1.3);
	const landscapeCloseness = Math.max(
		0,
		1 - Math.abs(ratio - landscapeTarget) / 1.5,
	);
	const verticalBias = height > width ? 16 : 0;
	return Math.max(verticalCloseness * 18 + verticalBias, landscapeCloseness * 10);
}

function scoreResolution(width?: number, height?: number): number {
	if (!width || !height) return 0;
	const area = width * height;
	return Math.min(area / (1280 * 720), 4) * 8;
}

function scoreDuration(duration: number | undefined, maxDuration: number): number {
	if (!duration || duration <= 0) return 4;
	const ideal = Math.min(Math.max(maxDuration - 4, 6), 14);
	return Math.max(0, 22 - Math.abs(duration - ideal) * 1.5);
}

export function isAcceptableImageCandidate(
	candidate: Pick<RankedImageCandidate, "score"> &
		Partial<Pick<RankedImageCandidate, "provider" | "relevanceScore">>,
	minScore = MIN_IMAGE_CANDIDATE_SCORE,
	minRelevance = 4,
): boolean {
	if (candidate.score < minScore) return false;
	if (
		(candidate.provider === "pexels" || candidate.provider === "pixabay") &&
		typeof candidate.relevanceScore === "number" &&
		candidate.relevanceScore < minRelevance
	) {
		return false;
	}
	return true;
}

export function isAcceptableVideoCandidate(
	candidate: Pick<RankedVideoCandidate, "score"> &
		Partial<Pick<RankedVideoCandidate, "provider" | "relevanceScore">>,
	minScore = MIN_VIDEO_CANDIDATE_SCORE,
	minRelevance = 4,
): boolean {
	if (candidate.score < minScore) return false;
	if (
		(candidate.provider === "pexels" || candidate.provider === "pixabay") &&
		typeof candidate.relevanceScore === "number" &&
		candidate.relevanceScore < minRelevance
	) {
		return false;
	}
	return true;
}

export function rankImageCandidates(
	candidates: Array<{
		provider: "naver" | "pexels" | "pixabay" | "wikimedia";
		item:
			| ImageResult
			| PexelsImageResult
			| PixabayImageResult
			| WikimediaImageResult;
	}>,
	queries: string[],
	locale: "ko" | "en",
): RankedImageCandidate[] {
	return candidates
		.map((entry, index) => {
			const provider = entry.provider;
			const providerBias =
				locale === "ko"
					? provider === "naver"
						? 8
						: provider === "wikimedia"
							? 7
						: provider === "pixabay"
							? 6
						: 5
					: provider === "pexels"
						? 8
						: provider === "wikimedia"
							? 7
						: provider === "pixabay"
							? 6
						: 4;
			if (provider === "naver") {
				const item = entry.item as ImageResult;
				const text = `${item.title ?? ""} ${item.link ?? ""}`;
				const width = Number(item.sizewidth) || 0;
				const height = Number(item.sizeheight) || 0;
				const relevanceScore = textOverlapScore(queries, text);
				const penalty =
					(containsAny(text, BAD_IMAGE_TERMS) ? 26 : 0) +
					stockRelevancePenalty(provider, relevanceScore, "image");
				const score =
					relevanceScore +
					scoreVerticalFraming(width, height) +
					scoreResolution(width, height) +
					providerBias -
					penalty -
					index * 0.25;
				return {
					id: `naver-${item.link}`,
					provider,
					downloadUrl: item.link,
					width,
					height,
					text,
					score,
					relevanceScore,
				} satisfies RankedImageCandidate;
			}
			if (provider === "pixabay") {
				const item = entry.item as PixabayImageResult;
				const text = `${item.tags ?? ""} ${item.user ?? ""}`;
				const width = item.width || 0;
				const height = item.height || 0;
				const relevanceScore = textOverlapScore(queries, text);
				const penalty =
					(containsAny(text, BAD_IMAGE_TERMS) ? 26 : 0) +
					stockRelevancePenalty(provider, relevanceScore, "image");
				const score =
					relevanceScore +
					scoreVerticalFraming(width, height) +
					scoreResolution(width, height) +
					providerBias -
					penalty -
					index * 0.25;
				return {
					id: `pixabay-${String(item.id)}`,
					provider,
					downloadUrl: item.downloadUrl ?? item.thumbnail ?? "",
					width,
					height,
					text,
					score,
					relevanceScore,
				} satisfies RankedImageCandidate;
			}
			if (provider === "wikimedia") {
				const item = entry.item as WikimediaImageResult;
				const text = `${item.title ?? ""} ${item.license ?? ""} ${item.artist ?? ""}`;
				const width = item.width || 0;
				const height = item.height || 0;
				const relevanceScore = textOverlapScore(queries, text);
				const penalty =
					(containsAny(text, BAD_IMAGE_TERMS) ? 26 : 0) +
					stockRelevancePenalty(provider, relevanceScore, "image");
				const sourceBonus = item.license ? 4 : 0;
				const score =
					relevanceScore +
					scoreVerticalFraming(width, height) +
					scoreResolution(width, height) +
					providerBias +
					sourceBonus -
					penalty -
					index * 0.25;
				return {
					id: `wikimedia-${String(item.id)}`,
					provider,
					downloadUrl: item.downloadUrl,
					width,
					height,
					text,
					score,
					relevanceScore,
				} satisfies RankedImageCandidate;
			}
			const item = entry.item as PexelsImageResult;
			const text = `${item.photographer ?? ""} ${item.url ?? ""}`;
			const width = item.width || 0;
			const height = item.height || 0;
			const relevanceScore = textOverlapScore(queries, text);
			const penalty =
				(containsAny(text, BAD_IMAGE_TERMS) ? 26 : 0) +
				stockRelevancePenalty(provider, relevanceScore, "image");
			const score =
				relevanceScore +
				scoreVerticalFraming(width, height) +
				scoreResolution(width, height) +
				providerBias -
				penalty -
				index * 0.25;
			return {
				id: `pexels-${String(item.id)}`,
				provider,
				downloadUrl: item.downloadUrl ?? item.thumbnail ?? "",
				width,
				height,
				text,
				score,
				relevanceScore,
			};
		})
		.filter((candidate) => Boolean(candidate.downloadUrl))
		.sort((a, b) => b.score - a.score);
}

export function rankVideoCandidates(
	candidates: Array<
		| { provider: "youtube"; item: VideoResult }
		| { provider: "pexels"; item: PexelsVideoResult }
		| { provider: "pixabay"; item: PixabayVideoResult }
	>,
	queries: string[],
	maxDuration: number,
	locale: "ko" | "en",
): RankedVideoCandidate[] {
	return candidates
		.map((entry, index) => {
			const provider = entry.provider;
			const providerBias =
				locale === "ko"
					? provider === "youtube"
						? 16
						: provider === "pexels"
							? 9
							: 7
					: provider === "pexels"
						? 14
					: provider === "pixabay"
							? 10
							: 6;
			if (provider === "youtube") {
				const item = entry.item as VideoResult;
				const text = `${item.title ?? ""} ${item.description ?? ""} ${item.channelTitle ?? ""}`;
				const relevanceScore = textOverlapScore(queries, text);
				const penalty =
					(containsAny(text, BAD_VIDEO_TERMS) ? 30 : 0) +
					stockRelevancePenalty(provider, relevanceScore, "video");
				const footageBonus = containsAny(text, FOOTAGE_TERMS) ? 14 : 0;
				const score =
					relevanceScore +
					scoreDuration(undefined, maxDuration) +
					providerBias +
					footageBonus -
					penalty -
					index * 0.25;
				return {
					id: `yt-${item.videoId}`,
					provider,
					videoId: item.videoId,
					thumbnail: item.thumbnail ?? "",
					title: item.title,
					description: item.description,
					channelTitle: item.channelTitle,
					score,
					relevanceScore,
				} satisfies RankedVideoCandidate;
			}

			if (provider === "pexels") {
				const item = entry.item as PexelsVideoResult;
				const text = item.url ?? "";
				const relevanceScore = textOverlapScore(queries, text);
				const penalty =
					(containsAny(text, BAD_VIDEO_TERMS) ? 30 : 0) +
					stockRelevancePenalty(provider, relevanceScore, "video");
				const footageBonus = containsAny(text, FOOTAGE_TERMS) ? 14 : 0;
				const score =
					relevanceScore +
					scoreVerticalFraming(item.width, item.height) +
					scoreResolution(item.width, item.height) +
					scoreDuration(item.duration, maxDuration) +
					providerBias +
					footageBonus -
					penalty -
					index * 0.25;
				return {
					id: `pexels-${item.id}`,
					provider,
					downloadUrl: item.downloadUrl,
					thumbnail: item.thumbnail ?? "",
					width: item.width,
					height: item.height,
					duration: item.duration,
					score,
					relevanceScore,
				} satisfies RankedVideoCandidate;
			}

			const item = entry.item as PixabayVideoResult;
			const text = item.tags ?? "";
			const relevanceScore = textOverlapScore(queries, text);
			const penalty =
				(containsAny(text, BAD_VIDEO_TERMS) ? 30 : 0) +
				stockRelevancePenalty(provider, relevanceScore, "video");
			const footageBonus = containsAny(text, FOOTAGE_TERMS) ? 14 : 0;
			const score =
				relevanceScore +
				scoreDuration(item.duration, maxDuration) +
				providerBias +
				footageBonus -
				penalty -
				index * 0.25;
			return {
				id: `pixabay-${item.id}`,
				provider,
				downloadUrl: item.downloadUrl,
				thumbnail: item.thumbnail ?? "",
				duration: item.duration,
				tags: item.tags,
				score,
				relevanceScore,
			} satisfies RankedVideoCandidate;
		})
		.filter((candidate) => Boolean(candidate.downloadUrl || candidate.videoId))
		.sort((a, b) => b.score - a.score);
}
