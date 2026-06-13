import { describe, expect, it } from "vitest";
import {
	clampWords,
	buildHistoricalChapters,
	buildHistoricalThumbnail,
	buildHistoricalTitle,
	buildPovVisualPrompt,
	findEra,
	HISTORICAL_ERAS,
	HISTORICAL_VLOG_STRUCTURE_ROLES,
	type HistoricalEra,
	POV_DIRECTIVE_EN,
	resolveEra,
	suggestHistoricalEras,
} from "./historical-vlog-format";

describe("HISTORICAL_ERAS", () => {
	it("큐레이션 시대 풀이 비어있지 않고 id 가 고유하다", () => {
		expect(HISTORICAL_ERAS.length).toBeGreaterThanOrEqual(6);
		const ids = HISTORICAL_ERAS.map((era) => era.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("모든 시대가 필수 필드를 갖춘다", () => {
		for (const era of HISTORICAL_ERAS) {
			expect(era.subjectKo.length).toBeGreaterThan(0);
			expect(era.subjectEn.length).toBeGreaterThan(0);
			expect(era.thumbnailBigText.length).toBeGreaterThan(0);
			expect(era.settingKeywords.length).toBeGreaterThan(0);
			expect(era.wardrobeKeywords.length).toBeGreaterThan(0);
		}
	});
});

describe("buildHistoricalTitle — 검증된 제목 공식 + 한국어 조사", () => {
	it("받침 없는 주어는 '로' (고대 로마 → 로마로)", () => {
		expect(buildHistoricalTitle("ancient-rome-44ad", "ko")).toBe(
			"저는 시간 여행을 통해 고대 로마로 갔어요! (브이로그)",
		);
	});

	it("받침 있는 주어는 '으로' (런던 → 런던으로)", () => {
		expect(buildHistoricalTitle("tudor-london-1536", "ko")).toBe(
			"저는 시간 여행을 통해 1536년 튜더 시대 런던으로 갔어요! (브이로그)",
		);
	});

	it("받침 없는 '호'로 끝나면 '로' (타이타닉호 → 타이타닉호로)", () => {
		expect(buildHistoricalTitle("titanic-1912", "ko")).toBe(
			"저는 시간 여행을 통해 1912년 타이타닉호로 갔어요! (브이로그)",
		);
	});

	it("받침 ㄹ 예외는 '로' (이스탄불 → 이스탄불로)", () => {
		// 불(jong=8, ㄹ) → 예외적으로 '으로' 가 아니라 '로'
		expect(buildHistoricalTitle("이스탄불", "ko")).toBe(
			"저는 시간 여행을 통해 이스탄불로 갔어요! (브이로그)",
		);
	});

	it("받침 ㄹ 이외는 '으로' (베를린 → 베를린으로)", () => {
		// 린(jong=4, ㄴ) → '으로'
		expect(buildHistoricalTitle("베를린", "ko")).toBe(
			"저는 시간 여행을 통해 베를린으로 갔어요! (브이로그)",
		);
	});

	it("영어 제목 공식", () => {
		expect(buildHistoricalTitle("ancient-rome-44ad", "en")).toBe(
			"I Time Traveled to Ancient Rome! (POV Vlog)",
		);
	});

	it("커스텀 시대(풀에 없음)도 제목을 만든다", () => {
		const title = buildHistoricalTitle("바이킹 시대", "ko");
		expect(title).toContain("바이킹 시대");
		expect(title).toContain("갔어요! (브이로그)");
	});
});

describe("buildHistoricalThumbnail — 거대 텍스트 + 놀란 셀카", () => {
	it("생존 훅 시대는 'scared', 아니면 'shocked'", () => {
		expect(buildHistoricalThumbnail("ice-age").expression).toBe("scared");
		expect(buildHistoricalThumbnail("ancient-rome-44ad").expression).toBe(
			"shocked",
		);
	});

	it("거대 텍스트가 시대의 thumbnailBigText", () => {
		expect(buildHistoricalThumbnail("titanic-1912").bigText).toBe("TITANIC");
	});

	it("구도 설명에 표정과 셀카가 포함된다", () => {
		const plan = buildHistoricalThumbnail("ancient-rome-44ad", "en");
		expect(plan.composition).toContain("selfie");
		expect(plan.composition).toContain("44 AD");
	});
});

describe("buildHistoricalChapters — 6비트 구조", () => {
	it("6개 역할 순서가 고정되어 있다", () => {
		const chapters = buildHistoricalChapters("ancient-rome-44ad");
		expect(chapters.map((c) => c.role)).toEqual([
			...HISTORICAL_VLOG_STRUCTURE_ROLES,
		]);
	});

	it("생존 훅 시대의 conflict 노트는 생존 각도를 언급", () => {
		const chapters = buildHistoricalChapters("ice-age", "en");
		const conflict = chapters.find((c) => c.role === "conflict");
		expect(conflict?.note.toLowerCase()).toContain("survival");
	});
});

describe("buildPovVisualPrompt — POV + 시대 + 의상 주입", () => {
	it("POV 지시문과 시대 배경/의상이 모두 들어간다", () => {
		const prompt = buildPovVisualPrompt("a busy street", "ancient-rome-44ad", {
			shocked: true,
		});
		expect(prompt).toContain("a busy street");
		expect(prompt).toContain(POV_DIRECTIVE_EN);
		expect(prompt).toContain("ancient Roman");
		expect(prompt).toContain("toga");
		expect(prompt).toContain("shocked");
	});

	it("결정론적 — 같은 입력은 같은 출력", () => {
		const a = buildPovVisualPrompt("x", "titanic-1912");
		const b = buildPovVisualPrompt("x", "titanic-1912");
		expect(a).toBe(b);
	});

	it("1400자를 넘지 않는다", () => {
		const huge = "x ".repeat(2000);
		expect(buildPovVisualPrompt(huge, "ice-age").length).toBeLessThanOrEqual(
			1400,
		);
	});
});

describe("findEra / resolveEra", () => {
	it("id, 한국어/영어 라벨로 찾는다", () => {
		expect(findEra("titanic-1912")?.id).toBe("titanic-1912");
		expect(findEra("고대 로마")?.id).toBe("ancient-rome-44ad");
		expect(findEra("Ancient Egypt")?.id).toBe("ancient-egypt");
	});

	it("매칭 실패 시 undefined", () => {
		expect(findEra("zzz존재하지않는zzz")).toBeUndefined();
	});

	it("resolveEra 는 풀에 없는 입력을 커스텀 시대로 합성", () => {
		const era = resolveEra("청동기 시대");
		expect(era.subjectKo).toBe("청동기 시대");
		expect(era.id.length).toBeGreaterThan(0);
	});

	it("resolveEra 는 HistoricalEra 객체를 그대로 통과시킨다", () => {
		const custom: HistoricalEra = HISTORICAL_ERAS[0];
		expect(resolveEra(custom)).toBe(custom);
	});
});

describe("clampWords — 단어 경계 보존 잘라내기", () => {
	it("max 이하면 그대로", () => {
		expect(clampWords("short text", 100)).toBe("short text");
	});

	it("초과 시 단어 중간이 아니라 공백에서 끊는다", () => {
		const out = clampWords("alpha beta gamma delta epsilon", 18);
		expect(out.length).toBeLessThanOrEqual(18);
		// 마지막 토큰이 잘린 조각이 아니어야 함
		expect(out.endsWith("-")).toBe(false);
		expect(out.split(" ").every((w) => w.length > 0)).toBe(true);
		// 온전한 단어들로만 구성
		for (const w of out.split(" ")) {
			expect("alpha beta gamma delta epsilon".split(" ")).toContain(w);
		}
	});

	it("공백이 너무 앞이면 하드 슬라이스(과도 손실 방지)", () => {
		const out = clampWords("supercalifragilisticexpialidocious tail", 20);
		expect(out.length).toBeLessThanOrEqual(20);
	});
});

describe("suggestHistoricalEras", () => {
	it("요청 개수만큼 반환(상한은 풀 크기)", () => {
		expect(suggestHistoricalEras(3)).toHaveLength(3);
		expect(suggestHistoricalEras(999).length).toBe(HISTORICAL_ERAS.length);
		expect(suggestHistoricalEras(0)).toHaveLength(0);
	});
});
