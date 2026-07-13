/**
 * 고정 호스트 캐릭터 — 에피소드 간 "동일 인물" 일관성 (키스톤).
 *
 * 문제: 기존 파이프라인은 캐릭터 시트/시드를 scriptId 로 잠근다
 *   (animation-production: `scripts/{scriptId}/animation/character-sheet.png`,
 *    styleSeed = hash(scriptId 기반 identityLock)).
 *   → 영상마다 다른 시드/시트 → 호스트 얼굴이 매 에피소드 달라짐 (일관성 0).
 *
 * 검증된 수익 포맷("Chloe VS History")의 "킥"은 *고정 호스트가 모든 영상에
 *   동일하게 등장*하는 것 = 채널 브랜드. 그래서 이 모듈은 캐릭터 잠금을
 *   채널+호스트 스코프로 끌어올린다:
 *     - referenceSheetPath = `channels/{channelId}/host/{hostId}/reference-sheet.png`
 *     - styleSeed = fnv1a32(channelId:hostId:appearance) — scriptId 와 무관, 영구 고정
 *   호스트 레퍼런스 시트는 채널당 1회 생성 후 모든 에피소드가 재사용한다.
 *   각 에피소드 미디어 생성 시 { referenceImagePath, seed } 를 전달하면
 *   동일 호스트가 재현된다.
 *
 * 순수 모듈 — DOM/네트워크 의존 없음. 결정론.
 */

import { fnv1a32 } from "./hash-seed";
import {
	clampWords,
	clampWordsKeepTail,
	type HistoricalEra,
	resolveEra,
	type VlogLocale,
} from "./historical-vlog-format";

export interface HostCharacter {
	/** 호스트 안정 식별자 (채널 내 고유, 영구) */
	id: string;
	channelId: string;
	/** 표시 이름 (내레이션 언어와 무관 — 외형이 일관성을 만든다) */
	name: string;
	/**
	 * 잠긴 외형 묘사 — 모든 에피소드에서 동일하게 유지되는 얼굴/체형/머리.
	 * 시대 의상은 에피소드별로 덧입히되 인물 자체는 바뀌지 않는다.
	 */
	appearance: string;
	/** 시대 의상이 없을 때의 기본 의상 */
	baseWardrobe: string;
	voiceId?: string;
	ttsProvider?: "openai" | "elevenlabs";
	/** 내레이션 기본 언어 (외형과 무관) */
	locale?: VlogLocale | string;
}

export interface HostIdentity {
	host: HostCharacter;
	/** 채널+호스트 파생 — scriptId 무관, 에피소드 간 고정 */
	identityLock: string;
	/** 모든 에피소드 공통 시드 (동일 인물 재현의 핵심) */
	styleSeed: number;
	/** 채널 스코프 레퍼런스 시트 경로 — 모든 에피소드가 공유 */
	referenceSheetPath: string;
}

/** 미디어 생성기에 넘길 호스트 잠금 파라미터 (image-gen / video-gen 계약) */
export interface HostMediaLock {
	referenceImagePath: string;
	seed: number;
}

// 호스트 id 는 스토리지 경로(channels/{ch}/host/{id}/...)에 들어가므로 ASCII 로 강제한다.
// 비ASCII(한글 등) 이름은 제거 후 fallback 으로 대체해 경로 호환성을 보장.
function slugify(value: string, fallback: string): string {
	const slug = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 48);
	return slug || fallback;
}

function normalize(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

/**
 * 채널+호스트 결정론 시드 — 같은 (channelId, hostId) 면 항상 같은 양의 31-bit 정수.
 * scriptId 를 섞지 않는 것이 핵심: 모든 에피소드가 같은 시드를 받아야 호스트가 동일해진다.
 */
export function deriveHostSeed(channelId: string, hostId: string): number {
	return fnv1a32(`${channelId}:${hostId}`) >>> 1;
}

/** 채널 스코프 호스트 레퍼런스 시트 경로 — 모든 에피소드 공유. */
export function hostReferenceSheetPath(
	channelId: string,
	hostId: string,
): string {
	return `channels/${channelId}/host/${hostId}/reference-sheet.png`;
}

/** 호스트 → 에피소드 불변 정체성(시드 + 시트 경로 + identityLock). */
export function buildHostIdentity(host: HostCharacter): HostIdentity {
	const identityLock = normalize(
		`${host.channelId}:${host.id}:${host.name}:${host.appearance}`,
	);
	return {
		host,
		identityLock,
		styleSeed: deriveHostSeed(host.channelId, host.id),
		referenceSheetPath: hostReferenceSheetPath(host.channelId, host.id),
	};
}

/** 미디어 생성기 계약 — 이 두 값을 모든 에피소드 이미지/영상 생성에 넘긴다. */
export function hostMediaLock(identity: HostIdentity): HostMediaLock {
	return {
		referenceImagePath: identity.referenceSheetPath,
		seed: identity.styleSeed,
	};
}

/**
 * 호스트 레퍼런스 포트레이트 생성 프롬프트 — 채널당 1회. 이후 모든 에피소드가 이 얼굴을 참조.
 * IP-Adapter face-lock 최적화: 멀티뷰 시트가 아니라 *단일 정면 헤드샷*(얼굴 중심)으로 만든다.
 * 의상/배경 신호를 최소화해야 IP-Adapter 가 옷·배경을 끌고 오지 않고 *얼굴만* 고정한다.
 */
export function buildHostReferencePrompt(identity: HostIdentity): string {
	const { host } = identity;
	const parts = [
		"photorealistic studio headshot portrait of one single person",
		host.appearance,
		"head and shoulders, neutral friendly expression, looking straight at the camera",
		"plain neutral grey background, soft even lighting, sharp focus, photorealistic",
		"no text, no logo, no watermark",
	];
	return clampWords(parts.filter(Boolean).join(", "), 900);
}

/**
 * 에피소드별 호스트 일관성 지시문 — 씬 프롬프트에 주입.
 * era 가 있으면 시대 의상으로 덧입히되 인물 정체성은 잠근다.
 */
export function buildHostContinuityDirectives(
	identity: HostIdentity,
	era?: string | HistoricalEra,
): string[] {
	const { host } = identity;
	const resolved = era ? resolveEra(era) : undefined;
	const directives = [
		`Recurring host in every shot and every episode: ${host.name} — ${host.appearance}.`,
		"Keep the exact same face, age, hair, and build as the reference sheet; do not change the host between episodes.",
		`Reference sheet path: ${identity.referenceSheetPath}.`,
		`Identity lock: ${identity.identityLock}. Stable seed: ${identity.styleSeed}.`,
	];
	if (resolved) {
		directives.push(
			`For this episode the host wears period-accurate clothing: ${resolved.wardrobeKeywords} — the clothing changes but the person does not.`,
		);
	} else {
		directives.push(`Default wardrobe: ${host.baseWardrobe}.`);
	}
	return directives;
}

/**
 * 씬 비주얼 프롬프트에 호스트 잠금을 덧붙인다.
 * (POV/시대 배경은 historical-vlog-format.buildPovVisualPrompt 가 먼저 넣고,
 *  그 결과를 여기 통과시켜 호스트 정체성까지 잠그는 게 권장 순서.)
 */
export function applyHostToScenePrompt(
	rawPrompt: string,
	identity: HostIdentity,
	opts: { era?: string | HistoricalEra; rosterAnchor?: string } = {},
): string {
	const directives = buildHostContinuityDirectives(identity, opts.era);
	// 로스터 앵커(출연진 명단 + 현재 인물)는 character-roster 가 다중 캐릭터일 때만 넘긴다.
	// 일관성에 필수라 host continuity 와 함께 보호 구간(truncation 우선순위 head 보다 높음)에 둔다.
	const anchor = opts.rosterAnchor?.trim();
	// 호스트 잠금(레퍼런스 시트/시드)은 일관성에 필수라 절대 잘리면 안 된다. clampWords 는
	// 끝에서 자르므로, rawPrompt 를 먼저 줄여 continuity suffix 공간을 확보한 뒤 붙인다.
	// continuity 가 그 자체로 cap 을 넘을 수 있으므로(긴 StyleBible appearance) 먼저 cap 으로
	// clamp — 출력은 항상 1600 이하를 보장하되 head 보다 호스트 잠금을 우선 보존한다.
	const continuity = clampWords(
		`${anchor ? `Character roster: ${anchor} ` : ""}Host continuity: ${directives.join(" ")}`,
		1600,
	);
	const headBudget = Math.max(0, 1600 - continuity.length - 1);
	// rawPrompt 는 buildPovVisualPrompt 산출물일 수 있고 그 필수 지시문(POV/시대/의상)이
	// tail 에 있으므로, head(장면 묘사)에서 자르고 tail 을 보존한다. → POV·호스트 잠금 둘 다 유지.
	const head = clampWordsKeepTail(rawPrompt.trim(), headBudget);
	return [head, continuity].filter((part) => part.length > 0).join(" ");
}

/** 시대 의상으로 호스트 의상만 교체한 변형 호스트(외형 정체성은 유지). */
export function hostWithEraWardrobe(
	host: HostCharacter,
	era: string | HistoricalEra,
): HostCharacter {
	const resolved = resolveEra(era);
	return { ...host, baseWardrobe: resolved.wardrobeKeywords };
}

/**
 * 채널 StyleBible(구조적 부분집합) → HostCharacter 브리지.
 * 기존 채널 단위 캐릭터 설정을 재사용하므로 새 DB 테이블 없이 호스트를 고정할 수 있다.
 * StyleBible 은 이 인터페이스에 구조적으로 할당 가능(character_name 등 동일 필드 보유).
 */
export interface HostSourceConfig {
	channel_id: string;
	character_name?: string;
	appearance_description?: string;
	outfit_rules?: string;
	tts_voice_id?: string;
}

export function hostFromStyleBible(style: HostSourceConfig): HostCharacter {
	const name = style.character_name?.trim() || "Host";
	const voiceId = style.tts_voice_id?.trim();
	return {
		id: slugify(name, "host"),
		channelId: style.channel_id,
		name,
		appearance:
			style.appearance_description?.trim() || "consistent recurring host",
		baseWardrobe: style.outfit_rules?.trim() || "simple modern neutral outfit",
		...(voiceId ? { voiceId } : {}),
	};
}

/**
 * 스타터 호스트 — 즉시 시작용 기본 시간여행 브이로그 진행자.
 * 외형은 언어와 무관하게 고정(동일 인물). 이름/보이스만 로케일에 맞춘다.
 */
export function createStarterHost(
	channelId: string,
	locale: VlogLocale = "ko",
): HostCharacter {
	const name = locale === "en" ? "Aria" : "아리";
	return {
		// 고정 ASCII id — 같은 채널이면 KO/EN 무관하게 동일 호스트(동일 시드/시트).
		id: "aria-time-traveler",
		channelId,
		name,
		appearance:
			"a friendly woman in her late 20s, warm brown eyes, shoulder-length dark brown hair, light natural makeup, approachable expressive face, average build",
		baseWardrobe: "simple modern neutral top",
		ttsProvider: "openai",
		locale,
	};
}
