import { describe, expect, it } from "vitest";
import {
	buildPovVisualPrompt,
	POV_DIRECTIVE_EN,
} from "./historical-vlog-format";
import {
	applyHostToScenePrompt,
	buildHostContinuityDirectives,
	buildHostIdentity,
	buildHostReferencePrompt,
	createStarterHost,
	deriveHostSeed,
	type HostCharacter,
	hostFromStyleBible,
	hostMediaLock,
	hostReferenceSheetPath,
	hostWithEraWardrobe,
} from "./host-character";

function sampleHost(overrides: Partial<HostCharacter> = {}): HostCharacter {
	return {
		id: "aria-time-traveler",
		channelId: "chan-1",
		name: "Aria",
		appearance: "late 20s woman, dark brown hair, warm brown eyes",
		baseWardrobe: "simple modern top",
		...overrides,
	};
}

describe("deriveHostSeed — 채널+호스트 고정 시드", () => {
	it("같은 (channelId, hostId) 는 항상 같은 양의 시드", () => {
		const a = deriveHostSeed("chan-1", "aria");
		const b = deriveHostSeed("chan-1", "aria");
		expect(a).toBe(b);
		expect(a).toBeGreaterThan(0);
	});

	it("scriptId 와 무관 — 다른 호스트/채널은 다른 시드", () => {
		expect(deriveHostSeed("chan-1", "aria")).not.toBe(
			deriveHostSeed("chan-1", "bob"),
		);
		expect(deriveHostSeed("chan-1", "aria")).not.toBe(
			deriveHostSeed("chan-2", "aria"),
		);
	});
});

describe("buildHostIdentity — 에피소드 불변 정체성", () => {
	it("시드/시트 경로가 채널+호스트 스코프이고 결정론적", () => {
		const id1 = buildHostIdentity(sampleHost());
		const id2 = buildHostIdentity(sampleHost());
		expect(id1.styleSeed).toBe(id2.styleSeed);
		expect(id1.referenceSheetPath).toBe(id2.referenceSheetPath);
		expect(id1.referenceSheetPath).toBe(
			hostReferenceSheetPath("chan-1", "aria-time-traveler"),
		);
		expect(id1.styleSeed).toBe(deriveHostSeed("chan-1", "aria-time-traveler"));
	});

	it("레퍼런스 시트 경로는 scriptId 가 아니라 채널 스코프 (키스톤)", () => {
		const id = buildHostIdentity(sampleHost());
		expect(id.referenceSheetPath).toContain("channels/chan-1/host/");
		expect(id.referenceSheetPath).not.toContain("scripts/");
	});

	it("identityLock 은 채널+호스트+이름+외형 파생", () => {
		const id = buildHostIdentity(sampleHost());
		expect(id.identityLock).toContain("chan-1");
		expect(id.identityLock).toContain("Aria");
	});
});

describe("hostMediaLock — 미디어 생성 계약", () => {
	it("referenceImagePath + seed 를 그대로 전달", () => {
		const identity = buildHostIdentity(sampleHost());
		const lock = hostMediaLock(identity);
		expect(lock.referenceImagePath).toBe(identity.referenceSheetPath);
		expect(lock.seed).toBe(identity.styleSeed);
	});

	it("같은 호스트의 서로 다른 에피소드는 동일 lock 을 받는다(동일 인물 보장)", () => {
		// 에피소드는 scriptId 가 달라도 호스트 lock 은 동일해야 한다.
		const identity = buildHostIdentity(sampleHost());
		const ep1 = hostMediaLock(identity);
		const ep2 = hostMediaLock(identity);
		expect(ep1).toEqual(ep2);
	});
});

describe("buildHostReferencePrompt", () => {
	it("외형 + 다각도/표정 + 깔끔한 배경을 포함, 900자 이내", () => {
		const prompt = buildHostReferencePrompt(buildHostIdentity(sampleHost()));
		expect(prompt).toContain("reference sheet");
		expect(prompt).toContain("dark brown hair");
		expect(prompt).toContain("front view");
		expect(prompt.length).toBeLessThanOrEqual(900);
	});
});

describe("buildHostContinuityDirectives", () => {
	it("에피소드 간 동일 인물 잠금 문구 포함", () => {
		const dirs = buildHostContinuityDirectives(buildHostIdentity(sampleHost()));
		const joined = dirs.join(" ");
		expect(joined).toContain("Recurring host");
		expect(joined.toLowerCase()).toContain("do not change the host");
	});

	it("era 지정 시 시대 의상으로 덧입히되 인물은 유지", () => {
		const dirs = buildHostContinuityDirectives(
			buildHostIdentity(sampleHost()),
			"ancient-rome-44ad",
		);
		const joined = dirs.join(" ");
		expect(joined).toContain("period-accurate clothing");
		expect(joined.toLowerCase()).toContain("the person does not");
	});
});

describe("applyHostToScenePrompt", () => {
	it("원본 프롬프트에 호스트 잠금을 덧붙인다", () => {
		const out = applyHostToScenePrompt(
			"a Roman street, selfie POV",
			buildHostIdentity(sampleHost()),
			{ era: "ancient-rome-44ad" },
		);
		expect(out).toContain("a Roman street");
		expect(out).toContain("Host continuity");
		expect(out.length).toBeLessThanOrEqual(1600);
	});

	it("긴 rawPrompt 에서도 Host continuity 잠금이 절대 잘리지 않는다", () => {
		const huge = "scene detail ".repeat(300); // 1600자 초과
		const out = applyHostToScenePrompt(huge, buildHostIdentity(sampleHost()), {
			era: "ancient-rome-44ad",
		});
		expect(out.length).toBeLessThanOrEqual(1600);
		// rawPrompt 가 길어도 호스트 잠금 지시는 보존되어야 한다
		expect(out).toContain("Host continuity");
	});

	it("appearance 가 그 자체로 cap 을 넘어도 1600 을 지킨다", () => {
		const longHost = sampleHost({ appearance: "y ".repeat(1000) });
		const out = applyHostToScenePrompt("raw", buildHostIdentity(longHost), {
			era: "ancient-rome-44ad",
		});
		expect(out.length).toBeLessThanOrEqual(1600);
	});

	it("문서화된 합성(buildPovVisualPrompt→applyHost)에서 POV 필수 suffix 와 호스트 잠금이 모두 살아남는다", () => {
		// 긴 장면 묘사 → POV 프롬프트가 1400 cap 근처, 필수 지시문은 tail 에 위치
		const pov = buildPovVisualPrompt(
			"busy scene ".repeat(300),
			"ancient-rome-44ad",
			{ shocked: true },
		);
		const out = applyHostToScenePrompt(pov, buildHostIdentity(sampleHost()), {
			era: "ancient-rome-44ad",
		});
		expect(out.length).toBeLessThanOrEqual(1600);
		// tail 보존 clamp 로 POV 필수 지시문이 호스트 잠금 추가 후에도 유지돼야 한다
		expect(out).toContain(POV_DIRECTIVE_EN);
		expect(out).toContain("shocked");
		expect(out).toContain("Host continuity");
	});
});

describe("hostWithEraWardrobe", () => {
	it("의상만 시대 의상으로 바꾸고 정체성은 유지", () => {
		const host = sampleHost();
		const dressed = hostWithEraWardrobe(host, "titanic-1912");
		expect(dressed.id).toBe(host.id);
		expect(dressed.appearance).toBe(host.appearance);
		expect(dressed.baseWardrobe).toContain("Edwardian");
	});
});

describe("hostFromStyleBible — 채널 StyleBible 재사용 브리지", () => {
	it("StyleBible 필드를 HostCharacter 로 매핑", () => {
		const host = hostFromStyleBible({
			channel_id: "chan-9",
			character_name: "Chloe",
			appearance_description: "late 20s woman, blonde",
			outfit_rules: "modern casual",
			tts_voice_id: "nova",
		});
		expect(host.channelId).toBe("chan-9");
		expect(host.name).toBe("Chloe");
		expect(host.appearance).toBe("late 20s woman, blonde");
		expect(host.baseWardrobe).toBe("modern casual");
		expect(host.voiceId).toBe("nova");
		// buildHostIdentity 와 결합 시 채널 스코프 시트
		expect(buildHostIdentity(host).referenceSheetPath).toContain(
			"channels/chan-9/host/chloe/",
		);
	});

	it("빈 필드는 안전한 기본값으로 대체", () => {
		const host = hostFromStyleBible({ channel_id: "c" });
		expect(host.name).toBe("Host");
		expect(host.id).toBe("host");
		expect(host.appearance.length).toBeGreaterThan(0);
		expect(host.baseWardrobe.length).toBeGreaterThan(0);
		expect(host.voiceId).toBeUndefined();
	});
});

describe("createStarterHost", () => {
	it("로케일별 이름, 고정 외형, 안정 id", () => {
		const ko = createStarterHost("chan-x", "ko");
		const en = createStarterHost("chan-x", "en");
		expect(ko.channelId).toBe("chan-x");
		expect(ko.name).toBe("아리");
		expect(en.name).toBe("Aria");
		// 외형은 언어와 무관하게 동일(동일 인물)
		expect(ko.appearance).toBe(en.appearance);
		expect(ko.id.length).toBeGreaterThan(0);
	});
});
