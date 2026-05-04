import { assessEnforcementSignals } from "./youtube-domain-intelligence";

export type PolicyRiskSeverity = "critical" | "warning" | "info";

export interface PolicyRiskIssue {
	severity: PolicyRiskSeverity;
	code: string;
	message: string;
	sceneIndex?: number;
}

export interface PolicyRiskReport {
	passed: boolean;
	score: number;
	issues: PolicyRiskIssue[];
	requiredActions: string[];
	disclosureRequired: boolean;
}

export interface PolicyRiskSceneInput {
	narration_text?: string;
	narration?: string;
	scene_type?: string;
	type?: string;
	visual_prompt?: string;
	visualPrompt?: string;
	news_title?: string;
	newsTitle?: string;
	news_source?: string;
	newsSource?: string;
	source_url?: string;
	sourceUrl?: string;
	shots?: Array<{
		visual_role?: string;
		selection_provider?: string;
		source_confidence?: number;
		rejection_reason?: string;
		source_url?: string;
	}>;
}

export interface PolicyRiskInput {
	title?: string;
	description?: string;
	format?: "shorts" | "longform" | "both" | string;
	scenes: PolicyRiskSceneInput[];
}

const REAL_FOOTAGE_CLAIMS = [
	"실제 cctv",
	"실제 CCTV",
	"실제 영상",
	"실제 장면",
	"단독 영상",
	"원본 영상",
	"caught on camera",
	"real footage",
	"actual footage",
	"surveillance footage",
];

const DISCLOSURE_TERMS = [
	"ai 재구성",
	"AI 재구성",
	"인공지능 재구성",
	"일부 장면은 재구성",
	"altered content",
	"synthetic content",
	"ai-generated",
	"reconstruction",
];

const GRAPHIC_TERMS = [
	"시체",
	"사체",
	"피투성이",
	"혈흔",
	"유혈",
	"절단",
	"참수",
	"고어",
	"잔혹",
	"살해 장면",
	"graphic",
	"gore",
	"corpse",
	"blood",
	"beheading",
	"dismembered",
];

const UNSUPPORTED_CERTAINTY_TERMS = [
	"100%",
	"확실히",
	"무조건",
	"범인은",
	"진짜 이유",
	"은폐했다",
	"조작했다",
	"거짓말했다",
	"proved",
	"definitely",
];

const MASS_PRODUCTION_TERMS = [
	"top 10",
	"part ",
	"복붙",
	"템플릿",
	"자동 생성",
	"뉴스 요약",
	"shorts factory",
];

function normalizeText(value?: string): string {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

function lower(value?: string): string {
	return normalizeText(value).toLowerCase();
}

function includesAny(text: string, terms: string[]): boolean {
	const normalized = text.toLowerCase();
	return terms.some((term) => normalized.includes(term.toLowerCase()));
}

function sceneText(scene: PolicyRiskSceneInput): string {
	return [
		scene.narration_text,
		scene.narration,
		scene.visual_prompt,
		scene.visualPrompt,
		scene.news_title,
		scene.newsTitle,
		scene.news_source,
		scene.newsSource,
		scene.source_url,
		scene.sourceUrl,
	]
		.map(normalizeText)
		.filter(Boolean)
		.join(" ");
}

function hasSyntheticShot(scene: PolicyRiskSceneInput): boolean {
	return Boolean(
		scene.shots?.some(
			(shot) =>
				shot.visual_role === "reconstruction" ||
				shot.selection_provider === "ai" ||
				shot.selection_provider === "generated" ||
				Boolean(shot.rejection_reason),
		),
	);
}

function hasSourceAnchor(scene: PolicyRiskSceneInput): boolean {
	if (normalizeText(scene.source_url || scene.sourceUrl)) return true;
	return Boolean(
		scene.shots?.some(
			(shot) =>
				Boolean(shot.source_url) &&
				shot.visual_role !== "reconstruction" &&
				shot.selection_provider !== "ai" &&
				shot.selection_provider !== "generated",
		),
	);
}

function unique(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))];
}

function repetitionRatio(scenes: PolicyRiskSceneInput[]): number {
	if (scenes.length < 4) return 0;
	const normalized = scenes.map((scene) =>
		lower(scene.narration_text || scene.narration)
			.replace(/[0-9０-９]/g, "")
			.slice(0, 80),
	);
	const repeated = normalized.filter(
		(text, index) => text && normalized.indexOf(text) !== index,
	).length;
	return repeated / scenes.length;
}

export function analyzeYouTubePolicyRisk(
	input: PolicyRiskInput,
): PolicyRiskReport {
	const issues: PolicyRiskIssue[] = [];
	const actions: string[] = [];
	const titleAndDescription = `${input.title ?? ""} ${input.description ?? ""}`;
	const metadata = lower(titleAndDescription);
	const hasDisclosure = includesAny(titleAndDescription, DISCLOSURE_TERMS);
	const repeatedSceneRatio = repetitionRatio(input.scenes);

	let syntheticSceneCount = 0;
	let lowAnchorSceneCount = 0;

	input.scenes.forEach((scene, index) => {
		const text = sceneText(scene);
		const synthetic = hasSyntheticShot(scene);
		const anchored = hasSourceAnchor(scene);
		const sceneIndex = index + 1;

		if (synthetic) syntheticSceneCount += 1;
		if (!anchored && (scene.scene_type ?? scene.type) !== "text_emphasis") {
			lowAnchorSceneCount += 1;
		}

		if (includesAny(text, REAL_FOOTAGE_CLAIMS) && synthetic && !anchored) {
			issues.push({
				severity: "critical",
				code: "synthetic_claimed_as_real",
				sceneIndex,
				message:
					"AI/재구성 장면을 실제 CCTV, 실제 영상, 단독 영상처럼 표현할 위험이 있습니다.",
			});
		}

		if (includesAny(text, GRAPHIC_TERMS)) {
			issues.push({
				severity: "warning",
				code: "graphic_or_shock_focus",
				sceneIndex,
				message:
					"잔혹하거나 충격 유도 중심 표현이 감지되었습니다. 그래픽 묘사 대신 맥락 설명과 비노출 자료로 바꾸세요.",
			});
		}

		if (
			includesAny(text, UNSUPPORTED_CERTAINTY_TERMS) &&
			!normalizeText(scene.news_source || scene.newsSource) &&
			!anchored
		) {
			issues.push({
				severity: "warning",
				code: "unsupported_absolute_claim",
				sceneIndex,
				message:
					"출처 앵커 없이 단정적 주장 표현이 감지되었습니다. 자료 기반 표현 또는 추정 표현으로 낮추세요.",
			});
		}
	});

	const disclosureRequired = syntheticSceneCount > 0;
	if (input.scenes.length === 0 && includesAny(metadata, REAL_FOOTAGE_CLAIMS)) {
		issues.push({
			severity: "warning",
			code: "metadata_real_footage_claim_requires_source",
			message:
				"제목/설명에 실제 영상·CCTV 표현이 있습니다. 업로드 전 실제 출처 영상이 포함됐는지 확인하세요.",
		});
		actions.push("실제 영상 출처가 없으면 제목/설명을 사건 재구성 또는 타임라인 분석으로 바꾸세요.");
	}
	if (includesAny(metadata, GRAPHIC_TERMS)) {
		issues.push({
			severity: "warning",
			code: "metadata_graphic_or_shock_focus",
			message:
				"제목/설명에 그래픽·충격 유도 표현이 있습니다. 비노출 다큐/분석 표현으로 낮추세요.",
		});
	}

	if (disclosureRequired && !hasDisclosure) {
		issues.push({
			severity: "warning",
			code: "missing_synthetic_disclosure",
			message:
				"현실적으로 보이는 AI/재구성 장면이 있으나 제목/설명에 재구성 고지가 없습니다.",
		});
		actions.push(
			'업로드 설명에 "일부 장면은 이해를 돕기 위한 AI 재구성입니다"를 추가하고 YouTube Studio의 altered content 항목을 확인하세요.',
		);
	}

	if (input.scenes.length >= 6 && lowAnchorSceneCount / input.scenes.length > 0.5) {
		issues.push({
			severity: "warning",
			code: "low_source_anchor_ratio",
			message:
				"출처 앵커가 약한 씬이 절반을 넘습니다. 스톡/AI 이미지 나열 또는 저품질 자동 생성 콘텐츠로 보일 수 있습니다.",
		});
		actions.push("저신뢰 씬은 기사, 문서, 지도, 원본 이미지, 직접 관련 영상으로 재검색하세요.");
	}

	if (repeatedSceneRatio > 0.3 || includesAny(metadata, MASS_PRODUCTION_TERMS)) {
		issues.push({
			severity: "warning",
			code: "mass_produced_pattern",
			message:
				"반복 템플릿/대량 생산형 콘텐츠로 보일 수 있는 패턴이 감지되었습니다.",
		});
		actions.push("각 영상마다 고유한 타임라인, 해석, 출처 맥락, 결론을 넣어 반복 양산감을 낮추세요.");
	}

	if (includesAny(metadata, REAL_FOOTAGE_CLAIMS)) {
		const hasUnanchoredSynthetic = input.scenes.some(
			(scene) => hasSyntheticShot(scene) && !hasSourceAnchor(scene),
		);
		if (hasUnanchoredSynthetic) {
			issues.push({
				severity: "critical",
				code: "metadata_real_claim_with_synthetic",
				message:
					"제목/설명에서 실제 영상처럼 기대하게 만들지만, 내부에는 출처 없는 재구성 장면이 있습니다.",
			});
		}
	}

	const sourceAnchorRatio =
		input.scenes.length > 0
			? 1 - lowAnchorSceneCount / input.scenes.length
			: 1;
	const hasSyntheticRealClaim =
		includesAny(metadata, REAL_FOOTAGE_CLAIMS) &&
		input.scenes.some((scene) => hasSyntheticShot(scene) && !hasSourceAnchor(scene));
	const enforcementSignals = assessEnforcementSignals({
		title: input.title,
		description: input.description,
		sceneCount: input.scenes.length,
		repetitionRatio: repeatedSceneRatio,
		sourceAnchorRatio,
		hasSyntheticRealClaim,
	});
	for (const issue of enforcementSignals.issues) {
		issues.push(issue);
	}
	actions.push(...enforcementSignals.requiredActions);

	if (actions.length === 0 && issues.length > 0) {
		actions.push("경고 씬의 표현, 출처 앵커, 썸네일/제목 일치 여부를 업로드 전 검토하세요.");
	}

	const criticals = issues.filter((issue) => issue.severity === "critical").length;
	const warnings = issues.filter((issue) => issue.severity === "warning").length;
	const score = Math.max(0, 100 - criticals * 35 - warnings * 8);

	return {
		passed: criticals === 0,
		score,
		issues,
		requiredActions: unique(actions),
		disclosureRequired,
	};
}
