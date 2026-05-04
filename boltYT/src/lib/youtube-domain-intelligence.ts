export type DomainFormat = "shorts" | "longform";

export interface EnforcementMetric {
	id: string;
	label: string;
	value: number;
	displayValue: string;
	source: string;
	implication: string;
}

export interface TrendCluster {
	id: string;
	label: string;
	score: number;
	risk: "low" | "medium" | "high";
	signals: string[];
	examples: string[];
	bestFormats: DomainFormat[];
	recommendedAngles: string[];
	source: string;
}

export interface DurationBand {
	id: string;
	label: string;
	format: DomainFormat;
	minSeconds: number;
	maxSeconds: number;
	sweetSpotSeconds: number;
	contentPlan: string[];
	bestFor: string[];
	riskControls: string[];
}

export interface DomainRecommendation {
	categoryId: string;
	format: DomainFormat;
	trendClusters: TrendCluster[];
	durationBands: DurationBand[];
	enforcementMetrics: EnforcementMetric[];
	riskSignals: string[];
	safeActions: string[];
	productionRules: string[];
}

export interface EnforcementSignalResult {
	score: number;
	issues: Array<{
		code: string;
		severity: "critical" | "warning" | "info";
		message: string;
	}>;
	requiredActions: string[];
}

const ENFORCEMENT_METRICS: EnforcementMetric[] = [
	{
		id: "terminated-q1-2025",
		label: "2025 Q1 채널 삭제",
		value: 2_897_659,
		displayValue: "2,897,659",
		source: "Google Transparency Report 기반 공개 집계",
		implication: "스팸/정책 위반 채널은 영상 단위가 아니라 채널 단위로 정리됩니다.",
	},
	{
		id: "terminated-q2-2025",
		label: "2025 Q2 채널 삭제",
		value: 2_105_778,
		displayValue: "2,105,778",
		source: "Google Transparency Report 기반 공개 집계",
		implication: "2025년 2분기부터 기만 행위 일부가 스팸/사기 범주로 재분류됐습니다.",
	},
	{
		id: "terminated-q3-2025",
		label: "2025 Q3 채널 삭제",
		value: 7_456_811,
		displayValue: "7,456,811",
		source: "Google Transparency Report 기반 공개 집계",
		implication: "Q3 급증은 금융 사기/기만 네트워크와 자동 집행 강화의 영향을 받은 것으로 공개 보도됐습니다.",
	},
	{
		id: "terminated-jan-sep-2025",
		label: "2025 1-9월 합계",
		value: 12_460_248,
		displayValue: "12.46M",
		source: "Google Transparency Report 기반 공개 집계",
		implication: "동일 템플릿 대량 업로드, 오프사이트 유도, 사기성 소재는 채널 생존 리스크입니다.",
	},
	{
		id: "q3-spam-share",
		label: "Q3 스팸/기만/사기 비중",
		value: 92.7,
		displayValue: "약 92.7%",
		source: "Q3 2025 공개 집계: 6,914,112 / 7,456,811",
		implication: "삭제 사유의 핵심은 AI 여부가 아니라 스팸·기만·사기성 운영 패턴입니다.",
	},
	{
		id: "q3-auto-flag-video",
		label: "Q3 개별 영상 자동 탐지 비중",
		value: 97.9,
		displayValue: "약 97.9%",
		source: "Q3 2025 공개 집계: 11,885,088 / 12,139,839",
		implication: "제목, 설명, 썸네일, 링크, 반복 패턴은 업로드 직후 자동 신호로 먼저 걸립니다.",
	},
];

const TREND_CLUSTERS: TrendCluster[] = [
	{
		id: "fandom-world-expansion",
		label: "팬덤 세계관 확장",
		score: 92,
		risk: "medium",
		signals: ["공식 IP 이후 해설/복선/리액션 확장", "캐릭터·세계관을 팬이 재해석", "짧은 클립과 긴 해설 동시 소비"],
		examples: ["Squid Game", "KPop Demon Hunters", "Blue Lock", "Cookie Run: Kingdom", "Katseye"],
		bestFormats: ["shorts", "longform"],
		recommendedAngles: [
			"공식 장면을 길게 쓰지 말고 복선/관계/설정 해설 중심으로 변환",
			"쇼츠는 한 장면의 의문, 롱폼은 세계관/관계도 회수로 분리",
		],
		source: "YouTube 2025 Culture & Trends",
	},
	{
		id: "ugc-gaming-worlds",
		label: "UGC 게임/플레이 세계",
		score: 90,
		risk: "low",
		signals: ["Roblox 제작자 경험", "플레이어가 만든 룰", "게임 안 밈이 외부 영상으로 확산"],
		examples: ["Grow a Garden", "Dandy’s World", "Forsaken", "Steal a Brainrot", "Nintendo Switch 2"],
		bestFormats: ["shorts", "longform"],
		recommendedAngles: [
			"게임 내 룰·경제·업데이트를 초보자도 이해하는 해설로 전환",
			"첫 10초에 결과/보상/실패 장면을 먼저 보여줌",
		],
		source: "YouTube 2025 Culture & Trends",
	},
	{
		id: "brainrot-meme-remix",
		label: "브레인롯/밈 리믹스",
		score: 82,
		risk: "high",
		signals: ["짧은 반복 밈", "음원/문구/캐릭터 변주", "조회수는 빠르지만 반복 양산 리스크 큼"],
		examples: ["Brainrot", "Labubu", "Shorts trending audio"],
		bestFormats: ["shorts"],
		recommendedAngles: [
			"밈 자체 복제보다 왜 유행했는지 설명하거나 새 캐릭터/새 상황으로 변환",
			"반복 업로드 시 템플릿 차이가 아니라 내용 차이를 명확히 남김",
		],
		source: "YouTube 2025 Culture & Trends + monetization policy risk",
	},
	{
		id: "issue-commentary",
		label: "이슈/논쟁/사회 해설",
		score: 78,
		risk: "high",
		signals: ["정치·사회 쟁점", "댓글 대립", "뉴스 제목과 맥락 차이"],
		examples: ["Charlie Kirk", "public controversy explainers", "news timeline recaps"],
		bestFormats: ["shorts", "longform"],
		recommendedAngles: [
			"사실/의견/추정 라벨을 분리하고 출처 카드 70% 이상",
			"쇼츠는 쟁점 1개, 롱폼은 타임라인과 양쪽 논리 비교",
		],
		source: "YouTube 2025 Culture & Trends + spam/deceptive policy",
	},
	{
		id: "podcast-truecrime-deepdive",
		label: "팟캐스트/트루크라임/딥다이브",
		score: 86,
		risk: "medium",
		signals: ["긴 대화/사건 설명", "챕터형 소비", "짧은 훅 클립이 롱폼 입구 역할"],
		examples: ["The Joe Rogan Experience", "Rotten Mango", "48 Hours", "Shawn Ryan Show", "The Diary Of A CEO"],
		bestFormats: ["longform", "shorts"],
		recommendedAngles: [
			"쇼츠는 한 질문/한 증거만, 롱폼은 5-9개 챕터로 근거를 누적",
			"90-150초마다 새 인물·자료·반전 컷을 넣어 이탈을 막음",
		],
		source: "YouTube 2025 Top Podcasts",
	},
];

const DURATION_BANDS: DurationBand[] = [
	{
		id: "shorts-snap",
		label: "초단기 쇼츠",
		format: "shorts",
		minSeconds: 18,
		maxSeconds: 35,
		sweetSpotSeconds: 28,
		contentPlan: [
			"0-2초: 결과/이상한 장면 먼저",
			"2-8초: 왜 이상한지 한 문장",
			"8-22초: 증거 2개",
			"22-35초: 결론 대신 다음 질문",
		],
		bestFor: ["밈", "한 장면 반전", "댓글 유도"],
		riskControls: ["설명 없이 자극 문구만 쓰지 않기", "낚시 썸네일 금지"],
	},
	{
		id: "shorts-standard",
		label: "표준 쇼츠",
		format: "shorts",
		minSeconds: 45,
		maxSeconds: 75,
		sweetSpotSeconds: 58,
		contentPlan: [
			"0-3초: 제목 회수 훅",
			"3-15초: 배경을 한 줄로 압축",
			"15-45초: 증거/장면/반응 3비트",
			"45-75초: 열린 결말 또는 롱폼 연결",
		],
		bestFor: ["미스터리", "사회 이슈", "게임 업데이트", "복선 해설"],
		riskControls: ["한 영상 안에서 질문을 회수", "Part 쪼개기 남발 금지"],
	},
	{
		id: "shorts-deep",
		label: "3분 이하 미니 해설",
		format: "shorts",
		minSeconds: 90,
		maxSeconds: 180,
		sweetSpotSeconds: 135,
		contentPlan: [
			"0-5초: 핵심 주장",
			"5-35초: 사건/작품/게임 맥락",
			"35-120초: 증거 4-6개",
			"120-180초: 해석과 다음 편 예고",
		],
		bestFor: ["스토리형 쇼츠", "미니 다큐", "복잡한 이슈 요약"],
		riskControls: ["세로/정방형이면 Shorts로 분류됨", "커스텀 썸네일 대신 첫 프레임을 썸네일처럼 설계"],
	},
	{
		id: "longform-focus",
		label: "집중형 롱폼",
		format: "longform",
		minSeconds: 480,
		maxSeconds: 720,
		sweetSpotSeconds: 600,
		contentPlan: [
			"0-15초: 시청 보상과 미스터리 제시",
			"15-60초: 최소 배경",
			"1-6분: 증거/장면/반응을 3막으로 누적",
			"6-10분: 가장 강한 해석과 반론",
			"마지막 30초: 다음 영상으로 이어지는 질문",
		],
		bestFor: ["신규 채널 롱폼", "미스터리/이슈 해설", "작품 복선 분석"],
		riskControls: ["자료 출처 70% 이상", "스크롤 텍스트/슬라이드쇼 단독 금지"],
	},
	{
		id: "longform-deep",
		label: "딥다이브 롱폼",
		format: "longform",
		minSeconds: 720,
		maxSeconds: 1200,
		sweetSpotSeconds: 960,
		contentPlan: [
			"0-20초: 결론을 암시하는 강한 장면",
			"20-90초: 전체 지도/타임라인",
			"90-720초: 5-9개 챕터, 90-150초마다 새 자료",
			"720-1080초: 반론/대안 가설",
			"마지막 60초: 결론, 남은 의문, 시리즈 연결",
		],
		bestFor: ["트루크라임", "팟캐스트 요약", "드라마/영화 리캡", "비즈니스 사례 분석"],
		riskControls: ["20분 초과 금지", "원본 영상 장면 길게 재사용 금지", "챕터별 고유 자료 필요"],
	},
];

const DECEPTIVE_TERMS = [
	"free money",
	"make money fast",
	"get rich quick",
	"crypto giveaway",
	"airdrop",
	"telegram",
	"whatsapp",
	"수익 보장",
	"무조건 돈",
	"공짜 돈",
	"코인 에어드랍",
	"텔레그램 입장",
	"카톡방 입장",
	"원본 풀영상",
	"full movie",
	"download now",
];

export function getYouTubeDomainIntelligence(input: {
	categoryId?: string;
	format?: DomainFormat;
} = {}): DomainRecommendation {
	const categoryId = input.categoryId ?? "mystery_doc";
	const format = input.format ?? "longform";
	const trendClusters = rankTrendClusters(categoryId, format);
	const durationBands = DURATION_BANDS.filter((band) => band.format === format);
	const riskSignals = [
		"동일 템플릿에 주제명만 바꾼 대량 업로드",
		"제목/썸네일이 약속한 장면이 본문에 없음",
		"출처 없는 AI 재구성을 실제 영상처럼 표현",
		"빠른 수익, 코인, 외부 링크, 텔레그램/카톡방 유도",
		"스크롤 텍스트/이미지 슬라이드쇼에 해설 가치가 거의 없음",
	];
	const safeActions = [
		"각 영상마다 고유 타임라인, 해석, 출처, 결론을 4개 이상 남긴다.",
		"썸네일 문구는 제목 반복이 아니라 증거/감정 역할로 분리한다.",
		"근거형 씬 70% 이상에 기사, 지도, 공식 문서, 원본 자료 앵커를 붙인다.",
		"쇼츠는 첫 프레임을 썸네일처럼 설계하고, 롱폼은 1280x720 커스텀 썸네일을 만든다.",
		"성과 판단은 조회수만 보지 말고 노출 CTR, 평균 시청시간, 시청시간 점유율을 함께 본다.",
	];
	const productionRules = [
		"첫 3-5초 안에 제목의 약속을 회수한다.",
		"첫 10초 최소 3컷, 첫 30초 최소 8컷을 기준선으로 둔다.",
		"롱폼은 90-150초마다 새 증거, 인물, 장면, 반론 중 하나를 투입한다.",
		"같은 카테고리는 10개 파일럿 후 상위 2개 포맷만 증폭한다.",
		"정책 민감 소재는 사실/의견/추정 문장을 분리하고 단정 표현을 낮춘다.",
	];

	return {
		categoryId,
		format,
		trendClusters,
		durationBands,
		enforcementMetrics: ENFORCEMENT_METRICS,
		riskSignals,
		safeActions,
		productionRules,
	};
}

export function recommendDurationBand(input: {
	categoryId?: string;
	format: DomainFormat;
	goal?: "new_viewers" | "subscriber_conversion" | "returning_viewers";
}): DurationBand {
	const bands = DURATION_BANDS.filter((band) => band.format === input.format);
	if (input.format === "shorts") {
		if (input.goal === "new_viewers") return bands[0] ?? DURATION_BANDS[0];
		if (input.categoryId === "social_clip" || input.categoryId === "mystery_doc") {
			return bands[1] ?? DURATION_BANDS[1];
		}
		return bands[2] ?? DURATION_BANDS[2];
	}
	if (input.categoryId === "drama_recap" || input.categoryId === "podcast") {
		return bands[1] ?? DURATION_BANDS[4];
	}
	return bands[0] ?? DURATION_BANDS[3];
}

export function formatDurationRange(band: DurationBand): string {
	return `${formatSeconds(band.minSeconds)}-${formatSeconds(band.maxSeconds)} / 목표 ${formatSeconds(band.sweetSpotSeconds)}`;
}

export function assessEnforcementSignals(input: {
	title?: string | null;
	description?: string | null;
	sceneCount?: number;
	repetitionRatio?: number;
	sourceAnchorRatio?: number;
	hasSyntheticRealClaim?: boolean;
}): EnforcementSignalResult {
	const text = `${input.title ?? ""} ${input.description ?? ""}`.toLowerCase();
	const issues: EnforcementSignalResult["issues"] = [];
	const requiredActions: string[] = [];
	let score = 100;

	if (DECEPTIVE_TERMS.some((term) => text.includes(term.toLowerCase()))) {
		issues.push({
			code: "deceptive_spam_language",
			severity: "critical",
			message:
				"외부 유도, 빠른 수익, 원본 풀영상 등 스팸/기만 정책에 가까운 문구가 감지됐습니다.",
		});
		requiredActions.push("수익 보장, 외부 링크 유도, 원본 풀영상 약속 문구를 제거하세요.");
		score -= 36;
	}
	if ((input.repetitionRatio ?? 0) >= 0.3) {
		issues.push({
			code: "channel_repetitive_pattern",
			severity: "warning",
			message: "영상 구조가 반복 양산형으로 보일 수 있습니다.",
		});
		requiredActions.push("각 영상마다 고유 출처, 해석, 결론, 반론을 추가하세요.");
		score -= 14;
	}
	if ((input.sourceAnchorRatio ?? 1) < 0.5 && (input.sceneCount ?? 0) >= 6) {
		issues.push({
			code: "weak_source_anchor_policy_signal",
			severity: "warning",
			message: "근거 앵커가 부족해 AI 슬라이드쇼/재사용 콘텐츠처럼 보일 수 있습니다.",
		});
		requiredActions.push("근거형 씬 70% 이상에 출처 앵커를 붙이세요.");
		score -= 12;
	}
	if (input.hasSyntheticRealClaim) {
		issues.push({
			code: "synthetic_real_claim_channel_signal",
			severity: "critical",
			message: "AI/재구성 장면을 실제 영상처럼 약속하는 채널 리스크가 있습니다.",
		});
		requiredActions.push("실제 영상, CCTV, 단독 영상 표현은 검증된 원본이 있을 때만 쓰세요.");
		score -= 36;
	}

	return {
		score: Math.max(0, score),
		issues,
		requiredActions: [...new Set(requiredActions)],
	};
}

export function buildDomainKnowledgePrompt(input: {
	categoryId?: string;
	format?: DomainFormat;
} = {}): string {
	const intel = getYouTubeDomainIntelligence(input);
	const primaryBand =
		intel.durationBands[0] ??
		recommendDurationBand({ categoryId: intel.categoryId, format: intel.format });
	return [
		`YouTube 도메인 지식(${intel.categoryId}/${intel.format})`,
		`삭제/제재 핵심: ${intel.riskSignals.slice(0, 3).join(" / ")}`,
		`추천 길이: ${primaryBand.label} ${formatDurationRange(primaryBand)}`,
		"트렌드 클러스터:",
		...intel.trendClusters
			.slice(0, 3)
			.map((cluster) => `- ${cluster.label} S${cluster.score}: ${cluster.recommendedAngles[0]}`),
		"제작 규칙:",
		...intel.productionRules.map((rule) => `- ${rule}`),
	].join("\n");
}

function rankTrendClusters(categoryId: string, format: DomainFormat): TrendCluster[] {
	return [...TREND_CLUSTERS]
		.map((cluster) => ({
			...cluster,
			score: Math.min(99, cluster.score + categoryTrendBoost(cluster.id, categoryId, format)),
		}))
		.sort((a, b) => b.score - a.score)
		.slice(0, 4);
}

function categoryTrendBoost(
	clusterId: string,
	categoryId: string,
	format: DomainFormat,
): number {
	if (categoryId === "drama_recap" && clusterId === "fandom-world-expansion") return 7;
	if (categoryId === "mystery_doc" && clusterId === "podcast-truecrime-deepdive") return 6;
	if (categoryId === "social_clip" && clusterId === "issue-commentary") return 8;
	if (categoryId === "animation" && clusterId === "brainrot-meme-remix") return 7;
	if (categoryId === "business" && clusterId === "podcast-truecrime-deepdive") return 3;
	if (format === "shorts" && clusterId === "brainrot-meme-remix") return 4;
	if (format === "longform" && clusterId === "podcast-truecrime-deepdive") return 5;
	return 0;
}

function formatSeconds(seconds: number): string {
	if (seconds >= 60) {
		const minutes = Math.floor(seconds / 60);
		const rest = seconds % 60;
		return rest ? `${minutes}분 ${rest}초` : `${minutes}분`;
	}
	return `${seconds}초`;
}
