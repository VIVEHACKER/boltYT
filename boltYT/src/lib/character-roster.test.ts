import { describe, expect, it } from "vitest";
import {
	applyRosterToScenePrompt,
	buildCastDirective,
	buildCharacterIdentity,
	buildCharacterRoster,
	buildCharacterVisualAnchor,
	buildRosterAnchorString,
	type ChannelCharacterRoster,
	deriveCharacterSeed,
	selectRosterCharacter,
	singleHostRoster,
} from "./character-roster";
import {
	applyHostToScenePrompt,
	buildHostIdentity,
	deriveHostSeed,
	type HostCharacter,
} from "./host-character";

const CH = "channel-xyz";

function char(
	id: string,
	name: string,
	appearance = `${name} look`,
): HostCharacter {
	return {
		id,
		channelId: CH,
		name,
		appearance,
		baseWardrobe: `${name} outfit`,
	};
}

const aria = char(
	"aria",
	"Aria",
	"woman in her late 20s, dark hair, warm eyes",
);
const marco = char("marco", "Marco", "man in his 30s, short beard, glasses");
const nimi = char("nimi", "Nimi", "small round robot, blue glow");

describe("buildCharacterRoster", () => {
	it("최소 1명을 강제한다", () => {
		expect(() => buildCharacterRoster(CH, [])).toThrow();
	});

	it("id 중복을 첫 항목 우선으로 제거한다", () => {
		const roster = buildCharacterRoster(CH, [
			aria,
			marco,
			char("aria", "AriaDup"),
		]);
		expect(roster.characters).toHaveLength(2);
		expect(roster.characters[0].name).toBe("Aria");
	});

	it("기본 selectionMode: 1명이면 single, 여러 명이면 sequential", () => {
		expect(buildCharacterRoster(CH, [aria]).selectionMode).toBe("single");
		expect(buildCharacterRoster(CH, [aria, marco]).selectionMode).toBe(
			"sequential",
		);
	});
});

describe("singleHostRoster", () => {
	it("단일 호스트를 single 모드 로스터로 감싼다", () => {
		const roster = singleHostRoster(aria);
		expect(roster.characters).toEqual([aria]);
		expect(roster.selectionMode).toBe("single");
		expect(roster.channelId).toBe(CH);
	});
});

describe("selectRosterCharacter", () => {
	it("single 모드는 항상 첫 캐릭터", () => {
		const roster = buildCharacterRoster(CH, [aria, marco], "single");
		expect(selectRosterCharacter(roster, 0).id).toBe("aria");
		expect(selectRosterCharacter(roster, 5).id).toBe("aria");
	});

	it("sequential 은 캐릭터 수로 순환한다", () => {
		const roster = buildCharacterRoster(CH, [aria, marco, nimi], "sequential");
		expect(selectRosterCharacter(roster, 0).id).toBe("aria");
		expect(selectRosterCharacter(roster, 1).id).toBe("marco");
		expect(selectRosterCharacter(roster, 2).id).toBe("nimi");
		expect(selectRosterCharacter(roster, 3).id).toBe("aria");
	});

	it("음수/범위초과 인덱스도 안전하게 순환", () => {
		const roster = buildCharacterRoster(CH, [aria, marco, nimi], "sequential");
		expect(selectRosterCharacter(roster, -1).id).toBe("nimi");
		expect(selectRosterCharacter(roster, 99).id).toBe("aria");
	});

	it("by-scene 은 명시 지정 우선, 없으면 sequential 폴백", () => {
		const roster = buildCharacterRoster(CH, [aria, marco, nimi], "by-scene", {
			0: "nimi",
			2: "marco",
		});
		expect(selectRosterCharacter(roster, 0).id).toBe("nimi"); // 지정
		expect(selectRosterCharacter(roster, 1).id).toBe("marco"); // 폴백 1%3
		expect(selectRosterCharacter(roster, 2).id).toBe("marco"); // 지정
	});

	it("by-scene 지정이 존재하지 않는 id 면 sequential 폴백", () => {
		const roster = buildCharacterRoster(CH, [aria, marco], "by-scene", {
			0: "ghost",
		});
		expect(selectRosterCharacter(roster, 0).id).toBe("aria");
	});
});

describe("deriveCharacterSeed / buildCharacterIdentity", () => {
	it("캐릭터별 시드는 host-character 의 channel+id 시드와 동일(재사용)", () => {
		expect(deriveCharacterSeed(aria)).toBe(deriveHostSeed(CH, "aria"));
	});

	it("캐릭터마다 시드가 다르고 결정론적", () => {
		expect(deriveCharacterSeed(aria)).not.toBe(deriveCharacterSeed(marco));
		expect(deriveCharacterSeed(aria)).toBe(deriveCharacterSeed(aria));
	});

	it("정체성은 buildHostIdentity 와 동일", () => {
		expect(buildCharacterIdentity(aria)).toEqual(buildHostIdentity(aria));
	});
});

describe("buildCharacterVisualAnchor", () => {
	it("이름·외형·기본의상을 포함한다", () => {
		const anchor = buildCharacterVisualAnchor(aria);
		expect(anchor).toContain("Aria");
		expect(anchor).toContain("dark hair");
		expect(anchor).toContain("wears Aria outfit");
	});
});

describe("buildRosterAnchorString", () => {
	it("전체 출연진을 나열하고 현재 인물을 표시한다", () => {
		const roster = buildCharacterRoster(CH, [aria, marco, nimi]);
		const anchor = buildRosterAnchorString(roster, "marco");
		expect(anchor).toContain("Aria");
		expect(anchor).toContain("Marco");
		expect(anchor).toContain("Nimi");
		expect(anchor).toContain("on-screen character is Marco");
	});

	it("길이를 예산(700) 안으로 제한한다", () => {
		const many = Array.from({ length: 20 }, (_, i) =>
			char(
				`c${i}`,
				`Name${i}`,
				"a very detailed appearance description ".repeat(5),
			),
		);
		const roster = buildCharacterRoster(CH, many);
		expect(buildRosterAnchorString(roster, "c0").length).toBeLessThanOrEqual(
			700,
		);
	});

	it("캐스트가 cap 을 넘쳐도 활성 캐릭터 표시는 절대 잘리지 않는다", () => {
		const many = Array.from({ length: 20 }, (_, i) =>
			char(
				`c${i}`,
				`Name${i}`,
				"a very detailed appearance description ".repeat(5),
			),
		);
		const roster = buildCharacterRoster(CH, many);
		// 활성은 마지막 캐릭터 — 명단 뒤쪽이라 순진하게 뒤에 붙이면 잘려나갈 인물
		const anchor = buildRosterAnchorString(roster, "c19");
		expect(anchor).toContain("on-screen character is Name19");
	});
});

describe("applyRosterToScenePrompt", () => {
	const RAW = "wide shot of a sunny meadow, cinematic lighting";

	it("단일 캐릭터면 로스터 앵커 없이 기존 단일 호스트 경로와 동일", () => {
		const roster = singleHostRoster(aria);
		const { prompt, character, identity } = applyRosterToScenePrompt(
			RAW,
			roster,
			3,
		);
		expect(character.id).toBe("aria");
		expect(identity).toEqual(buildHostIdentity(aria));
		expect(prompt).toBe(
			applyHostToScenePrompt(RAW, buildHostIdentity(aria), {}),
		);
		expect(prompt).not.toContain("Character roster:");
	});

	it("다중 캐릭터면 로스터 앵커 + 선택 캐릭터 정체성을 주입", () => {
		const roster = buildCharacterRoster(CH, [aria, marco, nimi], "sequential");
		const { prompt, character, identity } = applyRosterToScenePrompt(
			RAW,
			roster,
			1,
		);
		expect(character.id).toBe("marco");
		expect(identity.styleSeed).toBe(deriveCharacterSeed(marco));
		expect(prompt).toContain("Character roster:");
		expect(prompt).toContain("on-screen character is Marco");
		// 호스트 연속성 잠금(레퍼런스 시트/시드)도 함께 들어간다
		expect(prompt).toContain("Host continuity:");
		expect(prompt).toContain(identity.referenceSheetPath);
	});

	it("같은 sceneIndex 는 같은 캐릭터(결정론)", () => {
		const roster = buildCharacterRoster(CH, [aria, marco], "sequential");
		const a = applyRosterToScenePrompt(RAW, roster, 4);
		const b = applyRosterToScenePrompt(RAW, roster, 4);
		expect(a.character.id).toBe(b.character.id);
		expect(a.prompt).toBe(b.prompt);
	});

	it("era 를 통과시켜 시대 의상을 적용한다", () => {
		const roster = singleHostRoster(aria);
		const withEra = applyRosterToScenePrompt(RAW, roster, 0, { era: "joseon" });
		const noEra = applyRosterToScenePrompt(RAW, roster, 0);
		expect(withEra.prompt).not.toBe(noEra.prompt);
	});

	it("원본 장면 묘사(head)를 보존한다", () => {
		const roster: ChannelCharacterRoster = singleHostRoster(aria);
		const { prompt } = applyRosterToScenePrompt(RAW, roster, 0);
		expect(prompt).toContain("sunny meadow");
	});
});

describe("buildCastDirective", () => {
	it("2명 이상이면 전원 외형을 나열한다", () => {
		const d = buildCastDirective([
			{ name: "Aria", appearance: "woman, dark hair" },
			{ name: "Marco", appearance: "man, glasses" },
		]);
		expect(d).toContain("Aria — woman, dark hair");
		expect(d).toContain("Marco — man, glasses");
		expect(d).toContain("visually identical");
	});

	it("0~1명이면 빈 문자열(전체 출연진 개념 없음)", () => {
		expect(buildCastDirective([])).toBe("");
		expect(buildCastDirective([{ name: "Aria", appearance: "solo" }])).toBe("");
	});

	it("HostCharacter 아닌 {name, appearance} 최소 형태도 받는다(애니 bible 등)", () => {
		const d = buildCastDirective([
			{ name: "루", appearance: "round robot, yellow raincoat" },
			{ name: "냥", appearance: "black cat, red scarf" },
		]);
		expect(d).toContain("루 — round robot, yellow raincoat");
		expect(d).toContain("냥 — black cat, red scarf");
	});

	it("길이를 cap(500) 안으로 제한한다", () => {
		const many = Array.from({ length: 15 }, (_, i) => ({
			name: `C${i}`,
			appearance: "a long detailed appearance description ".repeat(4),
		}));
		expect(buildCastDirective(many).length).toBeLessThanOrEqual(500);
	});
});
