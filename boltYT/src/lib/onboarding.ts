/**
 * 온보딩 완료 상태 관리.
 * localStorage key: `onboarding_done_v1` — 첫 방문 여부 판단.
 * 버전 suffix 는 큰 UI 개편 시 재표시 트리거용.
 */

const KEY = "onboarding_done_v1";

export function hasSeenOnboarding(): boolean {
	try {
		return localStorage.getItem(KEY) === "1";
	} catch {
		return true; // SSR/privacy 모드 → 노이즈 방지
	}
}

export function markOnboardingSeen(): void {
	try {
		localStorage.setItem(KEY, "1");
	} catch {
		/* ignore */
	}
}

export function resetOnboarding(): void {
	try {
		localStorage.removeItem(KEY);
	} catch {
		/* ignore */
	}
}

export interface OnboardingStep {
	id: string;
	title: string;
	description: string;
	cta?: { label: string; to: string };
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
	{
		id: "welcome",
		title: "boltYT에 오신 것을 환영합니다",
		description:
			"AI가 주제→스크립트→씬→영상까지 자동 생성합니다. 첫 영상을 5분 안에 만들어봅니다.",
	},
	{
		id: "channel",
		title: "1) 채널을 만들어 스타일을 고정하세요",
		description:
			"언어/분위기/화자를 채널마다 저장해두면 모든 새 콘텐츠가 자동으로 그 톤을 따릅니다.",
		cta: { label: "채널 만들기", to: "/channels/new" },
	},
	{
		id: "reference",
		title: "2) 레퍼런스 영상을 임포트해 스타일을 복제하세요",
		description:
			"유튜브 URL 한 줄이면 8프레임 분석 + Whisper 전사 + GPT Vision으로 완전한 스타일 템플릿이 생성됩니다.",
		cta: { label: "레퍼런스 임포트", to: "/references/import" },
	},
	{
		id: "create",
		title: "3) 콘텐츠 마법사로 영상을 만들어보세요",
		description:
			"주제만 입력하면 스크립트·이미지·TTS·BGM·자막까지 자동으로 조립됩니다. 바로 미리보기 가능.",
		cta: { label: "새 콘텐츠", to: "/content/new" },
	},
];
