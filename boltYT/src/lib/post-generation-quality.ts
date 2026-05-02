export type QualityCheckStatus = "pass" | "warn" | "fail" | "skipped";

export interface QualityGate {
	id: string;
	label: string;
	phase: "grounding" | "implementation" | "visual" | "verification";
	blocking: boolean;
	command?: string;
	rationale: string;
}

export interface QualityCheckResult {
	id: string;
	label: string;
	status: QualityCheckStatus;
	command?: string;
	details: string;
	durationMs?: number;
}

export interface ProjectLearning {
	id: string;
	title: string;
	rule: string;
	files: string[];
}

export interface QualityLoopReport {
	verdict: "ship" | "improve" | "blocked";
	score: number;
	checks: QualityCheckResult[];
	nextActions: string[];
	learnings: ProjectLearning[];
}

export const POST_GENERATION_QUALITY_GATES: QualityGate[] = [
	{
		id: "reference-coverage",
		label: "레퍼런스 커버리지",
		phase: "grounding",
		blocking: true,
		rationale:
			"생성물 판단 기준이 비어 있으면 다음 작업이 감각 의존으로 돌아간다.",
	},
	{
		id: "build",
		label: "프로덕션 빌드",
		phase: "verification",
		blocking: true,
		command: "npm run build",
		rationale: "타입, 번들, lazy route, import 경로 문제를 한 번에 잡는다.",
	},
	{
		id: "tests",
		label: "단위/통합 테스트",
		phase: "verification",
		blocking: true,
		command: "npm test --if-present",
		rationale: "기존 제작 파이프라인과 품질 게이트 회귀를 막는다.",
	},
	{
		id: "lint",
		label: "정적 린트",
		phase: "verification",
		blocking: true,
		command: "npm run lint",
		rationale: "사용하지 않는 코드, React hook, import 품질 문제를 차단한다.",
	},
	{
		id: "reference-e2e",
		label: "레퍼런스 UI E2E",
		phase: "visual",
		blocking: true,
		command: "npx playwright test e2e/references.spec.ts",
		rationale:
			"브라우저 수동 제어가 실패해도 자동 생성 레퍼런스가 화면에 노출되는지 검증한다.",
	},
	{
		id: "harness",
		label: "GAN Harness 게이트",
		phase: "verification",
		blocking: true,
		command: "gan-harness verify .",
		rationale: "빌드, 테스트, 린트, 타입체크, 시크릿 스캔을 최종 게이트로 묶는다.",
	},
];

export const PROJECT_QUALITY_LEARNINGS: ProjectLearning[] = [
	{
		id: "reference-dna",
		title: "레퍼런스는 원본 복사가 아니라 제작 DNA",
		rule: "영상, 음악, 대사 자체를 가져오지 말고 컷 호흡, 화면 배치, TTS/BGM 톤, 대본 구조만 템플릿화한다.",
		files: [
			"server/lib/reference-production-dna.ts",
			"src/lib/reference-bridge.ts",
			"src/lib/reference-template-presets.ts",
		],
	},
	{
		id: "generated-reference-library",
		title: "자동 생성 레퍼런스는 localStorage에만 두지 않는다",
		rule: "브라우저 제어가 실패해도 재사용되도록 생성 레퍼런스는 코드 내장 템플릿으로 승격한다.",
		files: [
			"scripts/reference-batch-template.ts",
			"src/lib/generated-reference-template-presets.ts",
			"src/pages/references/ReferenceListPage.tsx",
		],
	},
	{
		id: "video-quality-floor",
		title: "영상 품질은 아이디어보다 제작 승인선이 먼저",
		rule: "정적 이미지 흔들기, 의미 없는 카드 자막, 업로드용 메타 문구가 들어가면 렌더 전 차단한다.",
		files: [
			"src/lib/youtube-production-quality.ts",
			"src/lib/youtube-production-repair.ts",
			"docs/video-quality-reference-analysis.md",
		],
	},
	{
		id: "audio-bgm-gate",
		title: "BGM은 mood/tempo/keyword 기반으로 새로 선택",
		rule: "레퍼런스 BGM을 복제하지 않고 장면별 에너지 곡선과 메타 품질 점수로 골라야 한다.",
		files: [
			"src/lib/bgm-quality.ts",
			"src/lib/bgm-cue-plan.ts",
			"docs/audio-production-quality-plan.md",
		],
	},
	{
		id: "browser-risk-e2e",
		title: "수동 브라우저 제어 실패는 E2E로 흡수",
		rule: "in-app 브라우저 제어가 닫혀도 핵심 UI 상태는 Playwright E2E에서 확인되게 만든다.",
		files: ["e2e/references.spec.ts", "playwright.config.ts"],
	},
	{
		id: "policy-boundary",
		title: "자료 기반 제작은 권리/정책 경계를 먼저 통과",
		rule: "원본 영상/음악/대사 재사용, 과한 유사 복제, 출처 없는 자료컷을 품질 게이트에서 차단한다.",
		files: [
			"docs/youtube-policy-compliance-production.md",
			"src/lib/youtube-policy-risk.ts",
		],
	},
];

export function judgePostGenerationQuality(
	checks: QualityCheckResult[],
): QualityLoopReport {
	const knownBlockingIds = new Set(
		POST_GENERATION_QUALITY_GATES.filter((gate) => gate.blocking).map(
			(gate) => gate.id,
		),
	);
	const blockingFailures = checks.filter(
		(check) =>
			knownBlockingIds.has(check.id) &&
			(check.status === "fail" || check.status === "skipped"),
	);
	const score = calculateQualityScore(checks);
	const nextActions = buildNextActions(checks, blockingFailures);
	const verdict =
		blockingFailures.length > 0 ? "blocked" : score >= 92 ? "ship" : "improve";

	return {
		verdict,
		score,
		checks,
		nextActions,
		learnings: PROJECT_QUALITY_LEARNINGS,
	};
}

function calculateQualityScore(checks: QualityCheckResult[]): number {
	if (checks.length === 0) return 0;
	const weights: Record<QualityCheckStatus, number> = {
		pass: 100,
		warn: 70,
		skipped: 45,
		fail: 0,
	};
	return Math.round(
		checks.reduce((sum, check) => sum + weights[check.status], 0) /
			checks.length,
	);
}

function buildNextActions(
	checks: QualityCheckResult[],
	blockingFailures: QualityCheckResult[],
): string[] {
	if (blockingFailures.length === 0) {
		const warnings = checks.filter((check) => check.status === "warn");
		if (warnings.length === 0) {
			return [
				"생성물 기준 게이트를 통과했다. 다음 작업은 동일 루틴을 기준선으로 재사용한다.",
			];
		}
		return warnings.map((check) => `${check.label}: ${check.details}`);
	}
	return blockingFailures.map((check) =>
		check.command
			? `${check.label} 실패. \`${check.command}\` 결과를 먼저 고친다.`
			: `${check.label} 실패. ${check.details}`,
	);
}
