/**
 * Paid BGM library import — 유료 음악(Epidemic/Artlist/Soundstripe 등)을 boltYT에 넣는 경로.
 *
 * 왜 import인가: 이 라이브러리들은 공개 다운로드 API가 없다(Epidemic은 엔터프라이즈 파트너 API,
 * Artlist/Soundstripe는 수동 다운로드). 그래서 자동 fetch가 불가능하고, 표준 워크플로우는
 * "구독 → 사이트에서 트랙 다운로드 → 편집툴에 import"이다. boltYT도 같은 방식:
 * 사용자가 받은 파일을 import하고, 라이브러리/라이선스/Content-ID claim 클리어 방식을 함께 기록한다.
 *
 * 수익화 안전의 핵심은 Content ID claim 클리어다 — 라이선스가 있어도 claim이 걸리면
 * 클리어(채널 safelist/clearlist 또는 영상별 코드) 전까지 수익이 막힌다(리서치 검증).
 */

import type { BgmTrack } from "./bgm";

export type PaidBgmLibrary =
	| "epidemic_sound"
	| "artlist"
	| "soundstripe"
	| "envato_elements"
	| "uppbeat"
	| "bgm_president"
	| "mewpot"
	| "sellbuymusic"
	| "other";

/** Content ID claim을 클리어하는 방식 — 라이브러리마다 다르다. */
export type BgmClaimClearMethod =
	| "channel_safelist" // Epidemic: 채널 등록 → 구독 중 게시분 영구 클리어
	| "channel_clearlist" // Artlist: 채널 등록 → 게시분 평생 사용권
	| "per_video_code" // Soundstripe: 영상별 claim 코드 입력
	| "per_video_tool" // Envato: 영상별 claim clear 도구 실행
	| "claim_free" // 애초에 claim이 안 걸림(AI 생성/일부 Uppbeat 프리미엄)
	| "unknown";

export type BgmLicenseBasis =
	| "owned"
	| "licensed"
	| "ai_generated"
	| "youtube_audio_library"
	| "pixabay_content_license"
	| "creative_commons"
	| "public_domain"
	| "unknown";

export interface BgmContentIdInfo {
	/** 이 소스가 Content ID claim을 발생시키는가 */
	claimExpected: boolean;
	clearMethod: BgmClaimClearMethod;
	/** 영상별 코드 방식일 때 입력한 코드 */
	clearCode?: string;
	/** 채널 등록(safelist/clearlist)을 이 채널에 대해 완료했는가 */
	channelCleared?: boolean;
}

export interface BgmLicense {
	basis: BgmLicenseBasis;
	library?: PaidBgmLibrary;
	/** 예: "Epidemic Pro", "Artlist Unlimited" */
	licenseTier?: string;
	attribution?: string;
	contentId?: BgmContentIdInfo;
}

export interface PaidBgmLibraryInfo {
	id: PaidBgmLibrary;
	label: string;
	/** 어디서 받는가 */
	downloadUrl: string;
	/** 모니터링(수익화) 채널에 권장되는가 */
	recommendedForMonetization: boolean;
	/** 기본 claim 클리어 방식 */
	claimClearMethod: BgmClaimClearMethod;
	notes: string;
}

/** 유료 BGM 라이브러리 레지스트리 — "어디서 받고 어떻게 claim을 클리어하는가". */
export const PAID_BGM_LIBRARIES: Record<PaidBgmLibrary, PaidBgmLibraryInfo> = {
	epidemic_sound: {
		id: "epidemic_sound",
		label: "Epidemic Sound",
		downloadUrl: "https://www.epidemicsound.com",
		recommendedForMonetization: true,
		claimClearMethod: "channel_safelist",
		notes:
			"카탈로그 100% 자체 보유로 서드파티 claim 최소. 채널 Safelist 등록 시 구독 중 게시분 영구 클리어. 페이스리스 표준.",
	},
	artlist: {
		id: "artlist",
		label: "Artlist",
		downloadUrl: "https://artlist.io",
		recommendedForMonetization: true,
		claimClearMethod: "channel_clearlist",
		notes:
			"채널 Clearlist 등록 → 구독 중 게시분 평생 사용권. PRO 제휴 아티스트라 완전 royalty-free는 아님.",
	},
	soundstripe: {
		id: "soundstripe",
		label: "Soundstripe",
		downloadUrl: "https://www.soundstripe.com",
		recommendedForMonetization: true,
		claimClearMethod: "per_video_code",
		notes: "영상별 claim 코드로 클리어. 평생 사용권(게시분).",
	},
	envato_elements: {
		id: "envato_elements",
		label: "Envato Elements",
		downloadUrl: "https://elements.envato.com",
		recommendedForMonetization: false,
		claimClearMethod: "per_video_tool",
		notes:
			"영상별 claim clear 도구 실행 필요. 영상/음악 번들이지만 claim 처리 수동.",
	},
	uppbeat: {
		id: "uppbeat",
		label: "Uppbeat",
		downloadUrl: "https://uppbeat.io",
		recommendedForMonetization: true,
		claimClearMethod: "claim_free",
		notes: "프리미엄 트랙은 claim-free. 무료 티어는 크레딧 제한.",
	},
	bgm_president: {
		id: "bgm_president",
		label: "브금대통령",
		downloadUrl: "https://www.bgmpresident.com",
		recommendedForMonetization: true,
		claimClearMethod: "unknown",
		notes:
			"한국 쇼츠에서 많이 쓰이는 BGM 소스. 곡별 이용조건/출처 표기/claim 여부를 확인해 메타데이터에 남긴다.",
	},
	mewpot: {
		id: "mewpot",
		label: "뮤팟",
		downloadUrl: "https://www.mewpot.com",
		recommendedForMonetization: true,
		claimClearMethod: "unknown",
		notes:
			"국내 영상 제작용 BGM 라이브러리. 다운로드한 파일을 import하고 곡별 라이선스 정보를 기록한다.",
	},
	sellbuymusic: {
		id: "sellbuymusic",
		label: "셀바이뮤직",
		downloadUrl: "https://sellbuymusic.com",
		recommendedForMonetization: true,
		claimClearMethod: "unknown",
		notes:
			"국내 BGM 거래/라이선스 플랫폼. 구매·다운로드 후 파일과 라이선스 메모를 함께 import한다.",
	},
	other: {
		id: "other",
		label: "기타 라이선스 트랙",
		downloadUrl: "",
		recommendedForMonetization: false,
		claimClearMethod: "unknown",
		notes: "직접 라이선스를 확인하고 claim 클리어 방식을 입력하세요.",
	},
};

const CLEAR_LICENSE_BASES: BgmLicenseBasis[] = [
	"owned",
	"licensed",
	"ai_generated",
	"youtube_audio_library",
	"pixabay_content_license",
	"creative_commons",
	"public_domain",
];

export interface BgmClaimReadiness {
	/** 수익화 업로드에 claim 측면에서 준비됐는가 */
	cleared: boolean;
	blockers: string[];
	warnings: string[];
	requiredActions: string[];
}

function addUnique(items: string[], item: string) {
	if (!items.includes(item)) items.push(item);
}

/**
 * import한 트랙의 Content ID claim 준비 상태 평가.
 * 라이선스 근거가 부적합하거나, claim이 예상되는데 클리어 증적이 없으면 blocker.
 */
export function assessImportedBgmClaimReadiness(
	license: BgmLicense,
): BgmClaimReadiness {
	const blockers: string[] = [];
	const warnings: string[] = [];
	const requiredActions: string[] = [];

	if (!CLEAR_LICENSE_BASES.includes(license.basis)) {
		blockers.push("라이선스 근거가 수익화에 부적합합니다.");
		addUnique(
			requiredActions,
			"소유/라이선스/AI생성/YouTube Audio Library/CC/PD 중 하나로 라이선스를 확보하세요.",
		);
	}

	const contentId = license.contentId;
	if (contentId?.claimExpected) {
		switch (contentId.clearMethod) {
			case "channel_safelist":
			case "channel_clearlist": {
				if (!contentId.channelCleared) {
					const term =
						contentId.clearMethod === "channel_safelist"
							? "Safelist"
							: "Clearlist";
					blockers.push(`채널 ${term} 등록이 완료되지 않았습니다.`);
					addUnique(
						requiredActions,
						`${license.library ? `${PAID_BGM_LIBRARIES[license.library].label}에서 ` : ""}내 채널을 ${term}에 등록한 뒤 게시하세요.`,
					);
				}
				break;
			}
			case "per_video_code": {
				if (!contentId.clearCode) {
					blockers.push("영상별 claim 클리어 코드가 없습니다.");
					addUnique(
						requiredActions,
						"라이브러리에서 발급한 영상별 claim 코드를 입력/적용하세요.",
					);
				}
				break;
			}
			case "per_video_tool": {
				warnings.push(
					"업로드 후 라이브러리의 영상별 claim clear 도구를 실행해야 합니다.",
				);
				addUnique(
					requiredActions,
					"업로드 직후 claim clear 도구로 분쟁을 해제하세요.",
				);
				break;
			}
			case "claim_free": {
				warnings.push(
					"claim-free로 표시됐지만 claim이 예상된다고 입력됨 — 라이브러리 정책을 재확인하세요.",
				);
				break;
			}
			default: {
				// claim이 예상되는데 클리어 방식이 불명 → 차단(증적 없이 cleared로 보고하지 않는다).
				blockers.push("Content ID claim 클리어 방식이 불명확합니다.");
				addUnique(
					requiredActions,
					"claim 클리어 방식(채널 등록/영상별 코드/도구)을 확인해 기록하세요.",
				);
			}
		}
	} else if (license.basis === "licensed" && !contentId) {
		warnings.push(
			"라이선스 트랙인데 Content ID 정보가 없습니다 — claim 발생 가능성을 확인하세요.",
		);
		addUnique(
			requiredActions,
			"라이브러리의 claim 정책과 클리어 방식을 기록하세요.",
		);
	}

	return {
		cleared: blockers.length === 0,
		blockers,
		warnings,
		requiredActions,
	};
}

export interface ImportedBgmInput {
	id?: string;
	title: string;
	artist?: string;
	duration: number;
	/** 로컬 파일/blob URL */
	downloadUrl: string;
	previewUrl?: string;
	tags?: string[];
	license: BgmLicense;
}

function slugifyId(title: string): string {
	const base = title
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);
	return `imported-${base || "track"}`;
}

/**
 * import 입력 → BgmTrack. source="imported"로 고정하고 라이선스/ claim 메타데이터를 보존한다.
 */
export function buildImportedBgmTrack(input: ImportedBgmInput): BgmTrack {
	const library = input.license.library;
	return {
		id: input.id ?? slugifyId(input.title),
		title: input.title,
		artist: input.artist ?? (library ? PAID_BGM_LIBRARIES[library].label : ""),
		duration: input.duration,
		previewUrl: input.previewUrl ?? "",
		downloadUrl: input.downloadUrl,
		tags: input.tags ?? [],
		source: "imported",
		license: input.license,
	};
}
