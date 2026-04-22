/**
 * 샘플 콘텐츠 프리셋 — 새 사용자가 "빈 화면" 대신 한 클릭으로 실행 가능한 시작점.
 * 새 콘텐츠 마법사 / 대시보드 빈 상태에서 불러옴.
 */

export interface SamplePreset {
	id: string;
	title: string;
	description: string;
	format: "shorts" | "longform";
	topic: string;
	tone: "calm" | "energetic" | "serious";
	language: "ko" | "en";
	/** AI 생성 시 힌트로 주입할 스타일 키워드 */
	styleHints: string[];
}

export const SAMPLE_PRESETS: SamplePreset[] = [
	{
		id: "news-shorts",
		title: "뉴스 요약 쇼츠",
		description:
			"최근 기사 3개를 60초로 요약. 자막 중심 + 뉴스 톤 TTS + 빠른 컷.",
		format: "shorts",
		topic: "오늘의 IT 업계 주요 뉴스 3가지를 1분 안에 정리",
		tone: "serious",
		language: "ko",
		styleHints: [
			"뉴스 헤드라인 스타일 자막",
			"2-3초 하드컷",
			"중립적 내레이션",
			"하단 자막 굵게",
		],
	},
	{
		id: "knowledge-explainer",
		title: "지식 설명 롱폼",
		description:
			"한 가지 개념을 5-7분 상세 설명. 다이어그램/예시 이미지 자동 생성.",
		format: "longform",
		topic: "양자컴퓨팅이 기존 컴퓨터와 다른 이유를 초등학생도 이해하게 설명",
		tone: "calm",
		language: "ko",
		styleHints: [
			"차분한 설명 톤",
			"단계별 비유 삽입",
			"플랫 일러스트 스타일",
			"배경 BGM 잔잔한 피아노",
		],
	},
	{
		id: "hook-driven-short",
		title: "훅 중심 바이럴 쇼츠",
		description:
			"강한 오프닝 훅(질문/충격)으로 시작해서 30-45초 동안 페이스업.",
		format: "shorts",
		topic: "아무도 알려주지 않는 노트북 배터리 수명 2배 늘리는 법",
		tone: "energetic",
		language: "ko",
		styleHints: [
			"첫 3초 강한 훅",
			"빠른 줌/whip 트랜지션",
			"숫자·이모지 에너지 모션",
			"하이톤 TTS",
		],
	},
];

export function findPreset(id: string): SamplePreset | undefined {
	return SAMPLE_PRESETS.find((p) => p.id === id);
}
