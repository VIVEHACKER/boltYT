/**
 * 고정 캐릭터 로스터 — 한 채널이 재사용하는 N명의 고정 캐릭터.
 *
 * `host-character.ts`(단일 호스트)의 일반화다. 로스터의 캐릭터 1명 == 기존 단일 호스트
 * (동일한 channel-scope 시드/레퍼런스 시트/프롬프트 잠금을 그대로 재사용).
 *
 * 경쟁 포맷 정찰(예: "무생물잔소리" 구독자용 제작기, 2026-06)에서 확인된 핵심 기법:
 *   1. 채널마다 **고정 캐릭터 로스터**(예: 8명의 재사용 캐릭터)를 둔다.
 *   2. 각 캐릭터의 **비주얼 앵커 문자열**(잠긴 외형)을 모든 씬 프롬프트에 주입한다.
 *   3. 씬→캐릭터를 **결정론적으로** 매핑한다(단일/순환/씬별 지정).
 * boltYT 는 이미 (1)(2)에 해당하는 시드·레퍼런스 시트 잠금이 있으나 단일 호스트에 한정됐고
 * historical_vlog 장르에만 배선돼 있었다. 이 모듈은 그 잠금을 **장르 무관 N캐릭터**로 끌어올린다.
 *
 * 순수 모듈 — DOM/네트워크 없음. 결정론. host-character 의 1차 함수만 조립한다.
 */

import { clampWords, type HistoricalEra } from "./historical-vlog-format";
import {
	applyHostToScenePrompt,
	buildHostIdentity,
	deriveHostSeed,
	type HostCharacter,
	type HostIdentity,
} from "./host-character";

/**
 * 씬→캐릭터 매핑 방식.
 * - `single`: 로스터의 첫 캐릭터를 모든 씬에 사용(= 기존 단일 호스트와 동일 동작).
 * - `sequential`: 씬 인덱스를 캐릭터 수로 순환(라운드로빈).
 * - `by-scene`: `sceneAssignments` 의 명시 지정 우선, 없으면 sequential 로 폴백.
 */
export type RosterSelectionMode = "single" | "sequential" | "by-scene";

export interface ChannelCharacterRoster {
	channelId: string;
	/** 고정·재사용 캐릭터들. 최소 1명. 순서가 sequential 매핑의 기준. */
	characters: HostCharacter[];
	selectionMode: RosterSelectionMode;
	/** by-scene 모드에서 sceneIndex → characterId 명시 지정. */
	sceneAssignments?: Record<number, string>;
}

function nonEmpty(value: string | undefined): string {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * 로스터 생성 + 정규화. id 중복은 첫 항목 우선으로 제거하고, 최소 1명을 강제한다.
 * (id 는 스토리지 경로 scope 이므로 host-character.slugify 로 이미 ASCII 화된 값을 기대.)
 */
export function buildCharacterRoster(
	channelId: string,
	characters: HostCharacter[],
	selectionMode: RosterSelectionMode = characters.length > 1
		? "sequential"
		: "single",
	sceneAssignments?: Record<number, string>,
): ChannelCharacterRoster {
	const seen = new Set<string>();
	const deduped = characters.filter((c) => {
		if (!c.id || seen.has(c.id)) return false;
		seen.add(c.id);
		return true;
	});
	if (deduped.length === 0) {
		throw new Error("character roster requires at least one character");
	}
	return {
		channelId,
		characters: deduped,
		selectionMode,
		...(sceneAssignments ? { sceneAssignments } : {}),
	};
}

/** 단일 호스트를 로스터(1명)로 감싼다 — 기존 단일 호스트 경로와의 하위호환 브리지. */
export function singleHostRoster(host: HostCharacter): ChannelCharacterRoster {
	return {
		channelId: host.channelId,
		characters: [host],
		selectionMode: "single",
	};
}

function findById(
	roster: ChannelCharacterRoster,
	id: string | undefined,
): HostCharacter | undefined {
	if (!id) return undefined;
	return roster.characters.find((c) => c.id === id);
}

/**
 * 씬 인덱스 → 이 씬에 등장하는 캐릭터(결정론). 항상 로스터 내 1명을 반환한다.
 * 음수/범위초과 인덱스도 안전하게 순환 처리.
 */
export function selectRosterCharacter(
	roster: ChannelCharacterRoster,
	sceneIndex: number,
): HostCharacter {
	const chars = roster.characters;
	const n = chars.length;
	if (roster.selectionMode === "single" || n === 1) return chars[0];
	if (roster.selectionMode === "by-scene") {
		const assigned = findById(roster, roster.sceneAssignments?.[sceneIndex]);
		if (assigned) return assigned;
	}
	const idx = ((Math.trunc(sceneIndex) % n) + n) % n;
	return chars[idx];
}

/** 캐릭터별 결정론 시드 — host-character 의 channel+id 시드를 그대로 재사용. */
export function deriveCharacterSeed(character: HostCharacter): number {
	return deriveHostSeed(character.channelId, character.id);
}

/** 캐릭터 → 에피소드 불변 정체성(시드 + 레퍼런스 시트 + identityLock). */
export function buildCharacterIdentity(character: HostCharacter): HostIdentity {
	return buildHostIdentity(character);
}

/**
 * 단일 캐릭터의 **비주얼 앵커 문자열** — 모든 씬 프롬프트에서 동일하게 유지할 잠긴 외형.
 * 경쟁사 기법의 핵심: 자연어 외형 묘사를 캐릭터마다 고정해 LLM/생성기가 같은 인물을 그리게 한다.
 * 길이는 짧게 유지(로스터 전체가 프롬프트 예산 안에 들어가야 함).
 */
export function buildCharacterVisualAnchor(character: HostCharacter): string {
	const appearance = clampWords(nonEmpty(character.appearance), 90);
	const wardrobe = nonEmpty(character.baseWardrobe);
	const wardrobePart = wardrobe ? `, wears ${wardrobe}` : "";
	return `${nonEmpty(character.name)} (${appearance}${wardrobePart})`;
}

/**
 * 로스터 전체 비주얼 앵커 — 출연진 명단 + 이번 씬의 등장 인물.
 * 모든 씬 프롬프트에 주입해 (a) 전체 캐스트를 일관 유지하고 (b) 현재 화면 인물을 명시한다.
 * 전체 길이를 cap 해 host continuity 예산(1600)을 침범하지 않게 한다.
 */
export function buildRosterAnchorString(
	roster: ChannelCharacterRoster,
	activeCharacterId?: string,
): string {
	// 활성(현재 화면) 캐릭터 문장을 맨 앞에 둬서 cap(700) 절단에도 절대 소실되지 않게 한다.
	// 남은 예산으로 출연진 명단을 채운다 → 큰 캐스트는 명단이 잘리되 "이 씬의 인물"은 항상 유지.
	const active = findById(roster, activeCharacterId);
	const activePart = active
		? `In this scene the on-screen character is ${nonEmpty(active.name)}. `
		: "";
	const cast = roster.characters
		.map((c) => `[${buildCharacterVisualAnchor(c)}]`)
		.join(", ");
	const castBudget = Math.max(0, 700 - activePart.length);
	const castBlock = clampWords(
		`keep every listed person visually identical across all shots and episodes: ${cast}.`,
		castBudget,
	);
	return `${activePart}${castBlock}`.trim();
}

/**
 * 씬 비주얼 프롬프트에 **로스터 잠금**을 적용한다 — 이 모듈의 production 진입점.
 *   1. sceneIndex 로 이번 씬 캐릭터를 결정론 선택
 *   2. 그 캐릭터의 정체성(시드/레퍼런스 시트)으로 host continuity 잠금
 *   3. 로스터가 2명 이상이면 출연진 앵커를 함께 주입(단일이면 host continuity 로 충분 → 생략)
 *
 * 반환된 { prompt, character, identity } 의 identity 로 생성기 옵션(seed/referenceImagePath)을
 * 같은 캐릭터로 맞출 수 있다(이미지/영상 생성이 프롬프트와 시드를 일치시켜야 일관성이 산다).
 */
export function applyRosterToScenePrompt(
	rawPrompt: string,
	roster: ChannelCharacterRoster,
	sceneIndex: number,
	opts: { era?: string | HistoricalEra } = {},
): { prompt: string; character: HostCharacter; identity: HostIdentity } {
	const character = selectRosterCharacter(roster, sceneIndex);
	const identity = buildCharacterIdentity(character);
	const rosterAnchor =
		roster.characters.length > 1
			? buildRosterAnchorString(roster, character.id)
			: undefined;
	const prompt = applyHostToScenePrompt(rawPrompt, identity, {
		...(opts.era !== undefined ? { era: opts.era } : {}),
		...(rosterAnchor ? { rosterAnchor } : {}),
	});
	return { prompt, character, identity };
}
