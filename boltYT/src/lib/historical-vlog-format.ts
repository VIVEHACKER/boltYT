/**
 * 역사 시간여행 브이로그 포맷 팩 — 검증된 수익 공식의 결정론적 빌더.
 *
 * 근거(레퍼런스 채널 "Chloe VS History", 영상 37개 → 구독 28.4만,
 *  편당 123만~229만 조회):
 *   - 1인칭 셀카 POV 몰입형 브이로그 (셀카봉 든 팔이 프레임에 보임)
 *   - 제목 공식: "저는 시간 여행을 통해 {시대}로 갔어요! (브이로그)"
 *   - 썸네일 공식: 거대 연도 텍스트(44 AD / 1912 / TITANIC) + 놀란 표정 셀카
 *   - 9~14분 롱폼(광고 RPM) + 고정 호스트 캐릭터(시리즈 일관성)
 *
 * 순수 모듈 — DOM/네트워크 의존 없음. 같은 입력 → 같은 출력(결정론).
 * 한국어 조사(로/으로)까지 받침 기준으로 정확히 처리해 제목 어색함을 없앤다.
 */

export type VlogLocale = "ko" | "en";

export interface HistoricalEra {
	/** 안정 식별자 (kebab-case, 영구) */
	id: string;
	/** 한국어 제목에 들어갈 주어(예: "고대 로마", "1912년 타이타닉호") */
	subjectKo: string;
	/** 영어 제목에 들어갈 주어(예: "Ancient Rome", "the Titanic, 1912") */
	subjectEn: string;
	/** 썸네일 거대 텍스트 (예: "44 AD", "1912", "TITANIC") */
	thumbnailBigText: string;
	/** 영상 생성용 시대 배경 키워드 (EN, period-accurate) */
	settingKeywords: string;
	/** 호스트 의상 키워드 (EN, 시대 고증) */
	wardrobeKeywords: string;
	/** 씬 분위기 */
	mood: "warm" | "neutral" | "mystery" | "news";
	/** 생존/긴장 훅 각도 — "여기서 24시간 버틸 수 있을까?" 형태 변주 */
	survivalHook: boolean;
}

/** 1인칭 셀카 POV — 포맷의 핵심 몰입 장치 (모든 씬 프롬프트에 주입) */
export const POV_DIRECTIVE_EN =
	"first-person selfie POV vlog, the host's own arm holding the camera is visible in frame, immersive handheld documentary feel, the host looks into the camera and reacts, photorealistic, cinematic, natural lighting";

/** 역사 브이로그 6-비트 구조 (롱폼) — 훅→도착→몰입→갈등→폭로→작별 */
export const HISTORICAL_VLOG_STRUCTURE_ROLES = [
	"hook",
	"arrival",
	"immersion",
	"conflict",
	"revelation",
	"farewell",
] as const;

export type HistoricalVlogRole =
	(typeof HISTORICAL_VLOG_STRUCTURE_ROLES)[number];

/** 큐레이션된 시대 풀 — 레퍼런스 채널이 검증한 "사람들이 궁금해하는 시대" */
export const HISTORICAL_ERAS: readonly HistoricalEra[] = [
	{
		id: "ancient-rome-44ad",
		subjectKo: "고대 로마",
		subjectEn: "Ancient Rome",
		thumbnailBigText: "44 AD",
		settingKeywords:
			"ancient Roman forum, marble columns, togas, bustling Roman marketplace, 1st century Rome, period-accurate architecture",
		wardrobeKeywords: "simple Roman tunic and toga, leather sandals",
		mood: "warm",
		survivalHook: false,
	},
	{
		id: "ancient-egypt",
		subjectKo: "고대 이집트",
		subjectEn: "Ancient Egypt",
		thumbnailBigText: "EGYPT",
		settingKeywords:
			"ancient Egypt, great pyramids under construction, Nile river, hieroglyphics, sandstone temples, scorching desert sun",
		wardrobeKeywords: "linen Egyptian garment, kohl eye makeup, simple sandals",
		mood: "neutral",
		survivalHook: false,
	},
	{
		id: "titanic-1912",
		subjectKo: "1912년 타이타닉호",
		subjectEn: "the Titanic, 1912",
		thumbnailBigText: "TITANIC",
		settingKeywords:
			"RMS Titanic 1912, grand staircase, first-class deck, ocean liner interior, Edwardian era, looming iceberg",
		wardrobeKeywords: "Edwardian 1912 formal coat and dress, period hat",
		mood: "mystery",
		survivalHook: true,
	},
	{
		id: "tudor-london-1536",
		subjectKo: "1536년 튜더 시대 런던",
		subjectEn: "Tudor London, 1536",
		thumbnailBigText: "1536",
		settingKeywords:
			"Tudor London 1536, timber-framed houses, muddy cobblestone streets, crowded market, Thames riverside, Henry VIII era",
		wardrobeKeywords: "Tudor commoner wool clothing, linen cap",
		mood: "neutral",
		survivalHook: false,
	},
	{
		id: "ice-age",
		subjectKo: "빙하기",
		subjectEn: "the Ice Age",
		thumbnailBigText: "ICE AGE",
		settingKeywords:
			"prehistoric Ice Age tundra, woolly mammoths, snow-covered plains, primitive campfire, freezing blizzard, Paleolithic era",
		wardrobeKeywords: "thick fur hide clothing, primitive boots",
		mood: "mystery",
		survivalHook: true,
	},
	{
		id: "wwii-1944",
		subjectKo: "제2차 세계대전",
		subjectEn: "World War II, 1944",
		thumbnailBigText: "1944",
		settingKeywords:
			"World War II 1944, war-torn European city, sandbag bunkers, vintage military vehicles, dramatic overcast sky, 1940s era",
		wardrobeKeywords: "1940s civilian coat, worn leather shoes",
		mood: "news",
		survivalHook: true,
	},
	{
		id: "joseon-dynasty",
		subjectKo: "조선 시대",
		subjectEn: "the Joseon Dynasty",
		thumbnailBigText: "1450",
		settingKeywords:
			"Joseon dynasty Korea, hanok village, palace courtyard, traditional market, Gyeongbokgung-style architecture, 15th century",
		wardrobeKeywords: "traditional hanbok, jeogori and chima, period hairstyle",
		mood: "warm",
		survivalHook: false,
	},
	{
		id: "wild-west-1870",
		subjectKo: "1870년 서부 개척시대",
		subjectEn: "the Wild West, 1870",
		thumbnailBigText: "1870",
		settingKeywords:
			"American Wild West 1870, dusty frontier town, wooden saloon, horses and wagons, golden desert light, gold rush era",
		wardrobeKeywords: "frontier-era cotton shirt and vest, leather boots, hat",
		mood: "neutral",
		survivalHook: false,
	},
] as const;

/**
 * 단어 경계 보존 잘라내기 — max 초과 시 마지막 공백에서 끊어 단어가 중간에 잘리지 않게 한다.
 * 공백이 너무 앞이면(60% 미만) 하드 슬라이스(과도한 손실 방지).
 */
export function clampWords(text: string, max: number): string {
	if (text.length <= max) return text;
	const head = text.slice(0, max);
	const lastSpace = head.lastIndexOf(" ");
	return (lastSpace > max * 0.6 ? head.slice(0, lastSpace) : head).trimEnd();
}

/**
 * clampWords 의 tail 보존 버전 — 앞(head)에서 자르고 끝(tail)을 남긴다.
 * 필수 지시문이 tail 에 있는 프롬프트(buildPovVisualPrompt 산출물)를 다시 감쌀 때,
 * 그 필수 suffix 가 잘리지 않도록 보존하는 데 쓴다.
 */
export function clampWordsKeepTail(text: string, max: number): string {
	if (text.length <= max) return text;
	const tail = text.slice(text.length - max);
	const firstSpace = tail.indexOf(" ");
	return (
		firstSpace >= 0 && firstSpace < max * 0.4
			? tail.slice(firstSpace + 1)
			: tail
	).trimStart();
}

/**
 * 한국어 받침 기반 조사 선택 — 로/으로.
 * 받침 없음 또는 받침이 ㄹ → "로", 그 외 → "으로".
 * 마지막 글자가 한글이 아니면(숫자/영문) 안전하게 "로".
 */
function josaRo(subject: string): "로" | "으로" {
	const trimmed = subject.trim();
	const last = trimmed.charCodeAt(trimmed.length - 1);
	if (Number.isNaN(last)) return "로";
	// 한글 음절 영역 가-힣
	if (last < 0xac00 || last > 0xd7a3) return "로";
	const jong = (last - 0xac00) % 28; // 0 = 받침 없음, 8 = ㄹ
	return jong === 0 || jong === 8 ? "로" : "으로";
}

/** 시대 id 또는 라벨로 시대를 찾는다. 매칭 실패 시 undefined. */
export function findEra(idOrLabel: string): HistoricalEra | undefined {
	const needle = idOrLabel.trim().toLowerCase();
	if (!needle) return undefined;
	return HISTORICAL_ERAS.find((era) => {
		const ko = era.subjectKo.toLowerCase();
		const en = era.subjectEn.toLowerCase();
		return (
			era.id === needle ||
			ko === needle ||
			en === needle ||
			// 양방향 포함: 짧은 라벨 검색("로마")과 전체 주제("고대 로마 시간여행 브이로그") 모두 매칭.
			ko.includes(needle) ||
			en.includes(needle) ||
			needle.includes(ko) ||
			needle.includes(en)
		);
	});
}

/**
 * 자유 입력(시대 id / 라벨 / 임의 주제)을 HistoricalEra 로 정규화한다.
 * 큐레이션 풀에 없으면 입력 텍스트로 최소 시대 객체를 합성(커스텀 시대 허용).
 */
export function resolveEra(input: string | HistoricalEra): HistoricalEra {
	if (typeof input !== "string") return input;
	const found = findEra(input);
	if (found) return found;
	const label = input.trim() || "미지의 시대";
	return {
		id:
			label
				.toLowerCase()
				.replace(/[^a-z0-9가-힣]+/g, "-")
				.replace(/^-|-$/g, "")
				.slice(0, 48) || "custom-era",
		subjectKo: label,
		subjectEn: label,
		thumbnailBigText: label.slice(0, 12).toUpperCase(),
		settingKeywords: `${label}, period-accurate historical setting, photorealistic`,
		wardrobeKeywords: "period-accurate historical clothing",
		mood: "neutral",
		survivalHook: false,
	};
}

/** 검증된 제목 공식. ko: "저는 시간 여행을 통해 {주어}{로/으로} 갔어요! (브이로그)" */
export function buildHistoricalTitle(
	input: string | HistoricalEra,
	locale: VlogLocale = "ko",
): string {
	const era = resolveEra(input);
	if (locale === "en") {
		return `I Time Traveled to ${era.subjectEn}! (POV Vlog)`;
	}
	return `저는 시간 여행을 통해 ${era.subjectKo}${josaRo(era.subjectKo)} 갔어요! (브이로그)`;
}

export interface HistoricalThumbnailPlan {
	/** 거대 텍스트 (연도/장소) — 썸네일 좌상단 큰 글씨 */
	bigText: string;
	/** 호스트 표정 — 검증된 패턴은 "충격받은" 셀카 */
	expression: "shocked" | "amazed" | "scared";
	/** 구도 설명(EN, 썸네일 생성/지시용) */
	composition: string;
	/** 보조 카피 (locale) */
	caption: string;
}

/** 썸네일 공식 — 거대 연도 텍스트 + 놀란 표정 1인칭 셀카 + 시대 배경. */
export function buildHistoricalThumbnail(
	input: string | HistoricalEra,
	locale: VlogLocale = "ko",
): HistoricalThumbnailPlan {
	const era = resolveEra(input);
	const expression: HistoricalThumbnailPlan["expression"] = era.survivalHook
		? "scared"
		: "shocked";
	return {
		bigText: era.thumbnailBigText,
		expression,
		composition: `huge bold ${era.thumbnailBigText} text top-left, the host's ${expression} face in selfie close-up on the right, ${era.settingKeywords} blurred behind, high-contrast YouTube thumbnail`,
		caption:
			locale === "en"
				? `Could you survive ${era.subjectEn}?`
				: `${era.subjectKo}에서 살아남을 수 있을까?`,
	};
}

export interface HistoricalChapter {
	role: HistoricalVlogRole;
	/** 챕터 의도(연출 가이드, locale) */
	note: string;
}

/** 6-비트 챕터 구조 — 롱폼 역사 브이로그의 검증된 전개. */
export function buildHistoricalChapters(
	input: string | HistoricalEra,
	locale: VlogLocale = "ko",
): HistoricalChapter[] {
	const era = resolveEra(input);
	const ko: Record<HistoricalVlogRole, string> = {
		hook: `"제가 방금 ${era.subjectKo}에 도착했어요" — 첫 3초 안에 시대를 시각적으로 각인`,
		arrival: "주변을 셀카로 둘러보며 시대를 처음 마주하는 놀라움",
		immersion: "당시 사람들과 상호작용 — 음식, 거리, 일상 체험",
		conflict: era.survivalHook
			? "위기/위험 발생 — 긴장 고조 (생존 각도)"
			: "예상 밖의 사건/갈등으로 몰입 강화",
		revelation: "시대의 핵심 진실/반전 공개 — 시청자가 배운다",
		farewell: "현재로 돌아오며 여운 + 다음 시대 예고(시리즈화)",
	};
	const en: Record<HistoricalVlogRole, string> = {
		hook: `"I just arrived in ${era.subjectEn}" — stamp the era visually in the first 3 seconds`,
		arrival: "selfie look-around, first awe of the era",
		immersion: "interact with locals — food, streets, daily life",
		conflict: era.survivalHook
			? "danger/crisis emerges — rising tension (survival angle)"
			: "an unexpected event/conflict deepens immersion",
		revelation:
			"reveal the era's core truth/twist — the viewer learns something",
		farewell:
			"return to the present with resonance + tease the next era (series hook)",
	};
	const notes = locale === "en" ? en : ko;
	return HISTORICAL_VLOG_STRUCTURE_ROLES.map((role) => ({
		role,
		note: notes[role],
	}));
}

/**
 * 씬 비주얼 프롬프트에 POV + 시대 배경 + 의상을 주입한다.
 * 호스트 일관성(시드/레퍼런스 시트)은 host-character 모듈이 별도로 덧붙인다.
 */
export function buildPovVisualPrompt(
	rawPrompt: string,
	input: string | HistoricalEra,
	opts: { shocked?: boolean } = {},
): string {
	const era = resolveEra(input);
	// POV/시대/의상은 이 헬퍼의 핵심 산출물이라 절대 잘리면 안 된다. clampWords 는
	// 끝에서 자르므로, rawPrompt 를 먼저 줄여 필수 suffix 공간을 확보한 뒤 붙인다.
	const required = [
		POV_DIRECTIVE_EN,
		era.settingKeywords,
		`wearing ${era.wardrobeKeywords}`,
		opts.shocked ? "shocked surprised facial expression" : "",
	].filter((part) => part && part.length > 0);
	const SEP = ", ";
	// 필수 텍스트가 그 자체로 cap 을 넘을 수 있으므로(긴 커스텀 era 키워드) 먼저 cap 으로
	// clamp — 출력은 항상 1400 이하를 보장하되 head 보다 suffix 를 우선 보존한다.
	const requiredText = clampWords(required.join(SEP), 1400);
	const headBudget = Math.max(0, 1400 - requiredText.length - SEP.length);
	const head = clampWords(rawPrompt.trim(), headBudget);
	return [head, requiredText].filter((part) => part.length > 0).join(SEP);
}

/** 시대 풀에서 n개를 결정론적으로 제안(앞에서부터). */
export function suggestHistoricalEras(n = 4): HistoricalEra[] {
	const count = Math.max(0, Math.min(HISTORICAL_ERAS.length, Math.floor(n)));
	return HISTORICAL_ERAS.slice(0, count).map((era) => ({ ...era }));
}
