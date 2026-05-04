import { assessThumbnailReadiness } from "./thumbnail-intelligence";
import {
	buildUploadGrowthPlan,
	type GrowthPlan,
	type UploadAnalyticsSnapshot,
	type UploadRenderSnapshot,
} from "./upload-growth";
import {
	normalizeUploadStatus,
	type UploadListItem,
} from "./upload-management";
import { analyzeYouTubePolicyRisk } from "./youtube-policy-risk";

export type GrowthHealth = "good" | "watch" | "risk" | "blocked";
export type GrowthExperimentType =
	| "title_thumbnail"
	| "publish_window"
	| "retention_edit"
	| "shorts_longform_funnel"
	| "metadata_refresh";
export type GrowthDecisionKind = "scale" | "fix_packaging" | "fix_retention" | "observe";

export interface GrowthKpi {
	id: string;
	label: string;
	value: string;
	detail: string;
	health: GrowthHealth;
}

export interface GrowthLoopStage {
	id: string;
	label: string;
	status: "complete" | "active" | "blocked";
	score: number;
	description: string;
	nextStep: string;
}

export interface GrowthExperiment {
	id: string;
	type: GrowthExperimentType;
	title: string;
	priority: number;
	hypothesis: string;
	metric: string;
	actions: string[];
	successCriteria: string;
}

export interface GrowthDistributionTask {
	id: string;
	when: string;
	channel: "youtube" | "shorts" | "community" | "comments" | "metadata";
	title: string;
	reason: string;
	linkedUploadId?: string;
}

export interface GrowthScaleDecision {
	uploadId: string;
	title: string;
	kind: GrowthDecisionKind;
	score: number;
	reason: string;
	action: string;
}

export interface GrowthRiskControl {
	id: string;
	severity: GrowthHealth;
	title: string;
	detail: string;
	action: string;
}

export interface GrowthMissingData {
	id: string;
	label: string;
	count: number;
	impact: string;
	action: string;
}

export interface GrowthCommandCenter {
	generatedAt: string;
	confidence: GrowthPlan["confidence"];
	commandScore: number;
	primaryObjective: string;
	kpis: GrowthKpi[];
	loop: GrowthLoopStage[];
	experiments: GrowthExperiment[];
	distributionTasks: GrowthDistributionTask[];
	scaleDecisions: GrowthScaleDecision[];
	riskControls: GrowthRiskControl[];
	missingData: GrowthMissingData[];
	growthPlan: GrowthPlan;
	evidence: string[];
}

export function buildGrowthCommandCenter(params: {
	uploads: UploadListItem[];
	analyticsByUploadId?: Record<string, UploadAnalyticsSnapshot | undefined>;
	rendersById?: Record<string, UploadRenderSnapshot | undefined>;
	now?: Date;
}): GrowthCommandCenter {
	const {
		uploads,
		analyticsByUploadId = {},
		rendersById = {},
		now = new Date(),
	} = params;
	const growthPlan = buildUploadGrowthPlan({
		uploads,
		analyticsByUploadId,
		rendersById,
		now,
	});
	const published = uploads.filter((upload) => isPublished(upload));
	const queued = uploads.filter((upload) => {
		const status = normalizeUploadStatus(upload.status);
		return status === "queued" || status === "failed";
	});
	const scheduled = uploads.filter((upload) =>
		isWithinDays(upload.scheduled_at, now, 7),
	);
	const analyticsRows = published
		.map((upload) => analyticsByUploadId[upload.id])
		.filter(isAnalyticsSnapshot);
	const analyticsCoverage = ratio(analyticsRows.length, published.length);
	const thumbnailCoverage = ratio(
		queued.filter((upload) => Boolean(upload.thumbnail_path)).length,
		queued.length,
	);
	const durationCoverage = ratio(
		uploads.filter((upload) => Boolean(renderFor(upload, rendersById))).length,
		uploads.length,
	);
	const policyReports = uploads.map((upload) => ({
		upload,
			report: analyzeYouTubePolicyRisk({
				title: upload.title ?? "",
				description: upload.description ?? "",
				format: renderFor(upload, rendersById)?.format ?? undefined,
				scenes: [],
			}),
	}));
	const criticalPolicyCount = policyReports.filter((item) =>
		item.report.issues.some((issue) => issue.severity === "critical"),
	).length;
	const warningPolicyCount = policyReports.filter((item) =>
		item.report.issues.some((issue) => issue.severity === "warning"),
	).length;
	const scaleDecisions = buildScaleDecisions({
		uploads: published,
		analyticsByUploadId,
		rendersById,
	});
	const experiments = buildExperiments({
		uploads,
		queued,
		growthPlan,
		scaleDecisions,
		thumbnailCoverage,
		analyticsCoverage,
	});
	const riskControls = buildRiskControls({
		uploads,
		queued,
		criticalPolicyCount,
		warningPolicyCount,
		analyticsCoverage,
		thumbnailCoverage,
		durationCoverage,
	});
	const missingData = buildMissingData({
		uploads,
		published,
		queued,
		analyticsCoverage,
		thumbnailCoverage,
		durationCoverage,
		analyticsByUploadId,
		rendersById,
	});
	const commandScore = commandCenterScore({
		analyticsCoverage,
		thumbnailCoverage,
		durationCoverage,
		criticalPolicyCount,
		warningPolicyCount,
		experimentCount: experiments.length,
	});

	return {
		generatedAt: now.toISOString(),
		confidence: growthPlan.confidence,
		commandScore,
		primaryObjective: primaryObjective({
			commandScore,
			totalUploads: uploads.length,
			queuedCount: queued.length,
			publishedCount: published.length,
			analyticsCoverage,
			criticalPolicyCount,
			scaleDecisions,
		}),
		kpis: buildKpis({
			uploads,
			published,
			queued,
			scheduled,
			analyticsRows,
			analyticsCoverage,
			thumbnailCoverage,
			commandScore,
			criticalPolicyCount,
		}),
		loop: buildLoop({
			analyticsCoverage,
			experiments,
			scaleDecisions,
			riskControls,
			publishedCount: published.length,
		}),
		experiments,
		distributionTasks: buildDistributionTasks({
			queued,
			growthPlan,
			scaleDecisions,
		}),
		scaleDecisions,
		riskControls,
		missingData,
		growthPlan,
		evidence: [
			"local uploads table: 제목, 설명, 태그, 상태, 예약/게시 시각",
			"local analytics table: 조회수, CTR, 평균 시청, 좋아요, 댓글, 구독자 증가",
			"local renders table: 포맷과 길이",
			"YouTube 정책 리스크 규칙: 스팸/기만/반복/실제영상 오인 신호",
			"레퍼런스/도메인 지식: 트렌드 클러스터, 길이 밴드, 업로드 리듬",
		],
	};
}

function buildKpis(params: {
	uploads: UploadListItem[];
	published: UploadListItem[];
	queued: UploadListItem[];
	scheduled: UploadListItem[];
	analyticsRows: UploadAnalyticsSnapshot[];
	analyticsCoverage: number;
	thumbnailCoverage: number;
	commandScore: number;
	criticalPolicyCount: number;
}): GrowthKpi[] {
	const {
		uploads,
		published,
		queued,
		scheduled,
		analyticsRows,
		analyticsCoverage,
		thumbnailCoverage,
		commandScore,
		criticalPolicyCount,
	} = params;
	const totalViews = sum(analyticsRows.map((row) => row.views));
	const totalSubscribers = sum(analyticsRows.map((row) => row.subscribers_gained));
	const avgCtr = average(
		analyticsRows.map((row) => normalizeCtr(row.ctr)).filter(isFiniteNumber),
	);
	const avgWatch = average(
		analyticsRows
			.map((row) => Number(row.avg_watch_duration ?? Number.NaN))
			.filter(isFiniteNumber),
	);

	return [
		{
			id: "command-score",
			label: "운영 준비도",
			value: `${commandScore}점`,
			detail: "성과 회수, 썸네일, 길이 데이터, 정책 차단 신호를 합산",
			health: commandScore >= 82 ? "good" : commandScore >= 62 ? "watch" : "risk",
		},
		{
			id: "content-pipeline",
			label: "파이프라인",
			value: `${queued.length}/${uploads.length}`,
			detail: `대기 ${queued.length}개 · 예약 7일 내 ${scheduled.length}개 · 게시 ${published.length}개`,
			health: queued.length >= 3 || scheduled.length >= 2 ? "good" : "watch",
		},
		{
			id: "analytics-loop",
			label: "성과 회수율",
			value: `${Math.round(analyticsCoverage * 100)}%`,
			detail: "게시 영상 중 분석 데이터가 연결된 비율",
			health:
				published.length === 0
					? "watch"
					: analyticsCoverage >= 0.75
						? "good"
						: analyticsCoverage >= 0.4
							? "watch"
							: "risk",
		},
		{
			id: "thumbnail-readiness",
			label: "썸네일 준비",
			value: `${Math.round(thumbnailCoverage * 100)}%`,
			detail: "대기열 중 업로드용 썸네일 파일이 있는 비율",
				health:
					queued.length === 0
						? "watch"
						: thumbnailCoverage >= 0.8
							? "good"
							: thumbnailCoverage >= 0.45
								? "watch"
								: "risk",
		},
		{
			id: "view-signal",
			label: "누적 조회/구독",
			value: `${compactNumber(totalViews)} / +${compactNumber(totalSubscribers)}`,
			detail: `평균 CTR ${formatPercent(avgCtr)} · 평균 시청 ${formatSeconds(avgWatch)}`,
			health: totalViews > 0 || totalSubscribers > 0 ? "good" : "watch",
		},
		{
			id: "policy-risk",
			label: "정책 차단",
			value: `${criticalPolicyCount}건`,
			detail: "critical 신호는 업로드 전 차단 기준",
			health: criticalPolicyCount > 0 ? "blocked" : "good",
		},
	];
}

function buildLoop(params: {
	analyticsCoverage: number;
	experiments: GrowthExperiment[];
	scaleDecisions: GrowthScaleDecision[];
	riskControls: GrowthRiskControl[];
	publishedCount: number;
}): GrowthLoopStage[] {
	const {
		analyticsCoverage,
		experiments,
		scaleDecisions,
		riskControls,
		publishedCount,
	} = params;
	const blockedRisk = riskControls.some((risk) => risk.severity === "blocked");
	const scaleCount = scaleDecisions.filter((decision) => decision.kind === "scale").length;

	return [
		{
			id: "collect",
			label: "수집",
			status:
				publishedCount === 0
					? "blocked"
					: analyticsCoverage >= 0.65
						? "complete"
						: "active",
			score: Math.round(analyticsCoverage * 100),
			description: "게시 후 조회, CTR, 평균 시청, 구독 전환을 회수합니다.",
			nextStep:
				analyticsCoverage >= 0.65
					? "다음 단계는 낮은 지표의 원인 분리입니다."
					: "YouTube 분석 동기화 버튼으로 게시 영상 성과를 채우세요.",
		},
		{
			id: "diagnose",
			label: "진단",
			status: scaleDecisions.length > 0 ? "complete" : "active",
			score: scaleDecisions.length > 0 ? 82 : 46,
			description: "성과를 스케일/패키징 수정/리텐션 수정/관찰로 나눕니다.",
			nextStep:
				scaleDecisions[0]?.action ??
				"분석 데이터가 쌓일 때까지 제목·썸네일·길이 실험을 먼저 예약하세요.",
		},
		{
			id: "experiment",
			label: "실험",
			status: experiments.length >= 2 ? "active" : "blocked",
			score: Math.min(95, 40 + experiments.length * 14),
			description: "제목, 썸네일, 시간대, 메타데이터를 한 번에 하나씩 실험합니다.",
			nextStep: experiments[0]?.actions[0] ?? "실험 후보를 만들 대기열이 필요합니다.",
		},
		{
			id: "scale",
			label: "증폭/중단",
			status: blockedRisk ? "blocked" : scaleCount > 0 ? "active" : "blocked",
			score: blockedRisk ? 28 : Math.min(92, 42 + scaleCount * 18),
			description: "승자 포맷은 3개 변주로 증폭하고, 실패 포맷은 원인별로 중단합니다.",
			nextStep:
				scaleCount > 0
					? "스케일 후보는 같은 편집 문법으로 소재만 바꿔 72시간 안에 후속 제작하세요."
					: "아직 증폭 후보가 없습니다. 먼저 CTR/시청지속 신호를 확보하세요.",
		},
	];
}

function buildExperiments(params: {
	uploads: UploadListItem[];
	queued: UploadListItem[];
	growthPlan: GrowthPlan;
	scaleDecisions: GrowthScaleDecision[];
	thumbnailCoverage: number;
	analyticsCoverage: number;
}): GrowthExperiment[] {
	const {
		uploads,
		queued,
		growthPlan,
		scaleDecisions,
		thumbnailCoverage,
		analyticsCoverage,
	} = params;
	const experiments: GrowthExperiment[] = [];
	const topKeyword = growthPlan.keywords[0]?.keyword;
	const firstQueued = queued[0] ?? uploads[0];
	const weakPackaging = scaleDecisions.filter(
		(decision) => decision.kind === "fix_packaging",
	);
	const weakRetention = scaleDecisions.filter(
		(decision) => decision.kind === "fix_retention",
	);

	if (firstQueued) {
		experiments.push({
			id: "title-thumbnail-lab",
			type: "title_thumbnail",
			title: "제목/썸네일 패키지 3안 실험",
			priority: thumbnailCoverage < 0.8 || weakPackaging.length > 0 ? 96 : 78,
			hypothesis: topKeyword
				? `"${topKeyword}" 계열 노출 키워드와 감정/증거형 썸네일을 분리하면 CTR이 개선됩니다.`
				: "제목은 질문, 썸네일은 증거/감정으로 역할을 분리하면 초기 클릭 데이터가 생깁니다.",
			metric: "노출 CTR, 첫 30초 유지율, 구독자 증가",
			actions: [
				`${firstQueued.title ?? "다음 업로드"}에 호기심형/증거형/직접형 제목 3안을 만듭니다.`,
				"썸네일 문구는 제목 반복 금지, 3-5단어 이하, 피사체/핵심 증거를 가리지 않게 배치합니다.",
				"게시 후 24-48시간 안에 CTR이 낮으면 제목 또는 썸네일 중 하나만 바꿉니다.",
			],
			successCriteria: "CTR 5% 이상 또는 기존 중앙값 대비 +20%",
		});
	}

	if (growthPlan.publishWindows.length > 0 && uploads.length > 0) {
		const firstWindow = growthPlan.publishWindows[0];
		const secondWindow = growthPlan.publishWindows[1] ?? firstWindow;
		experiments.push({
			id: "publish-window-test",
			type: "publish_window",
			title: "업로드 시간대 A/B",
			priority: analyticsCoverage < 0.6 ? 88 : 72,
			hypothesis: `${firstWindow.label}와 ${secondWindow.label}를 나눠 예약하면 초기 노출 회수 속도 차이를 확인할 수 있습니다.`,
			metric: "게시 후 2시간 조회수, 24시간 CTR, 24시간 평균 시청",
			actions: [
				`다음 영상은 ${firstWindow.label}에 예약합니다.`,
				`같은 포맷의 다음 영상은 ${secondWindow.label}에 예약합니다.`,
				"제목/썸네일 구조는 동일하게 유지해 시간대 변수만 분리합니다.",
			],
			successCriteria: "24시간 조회/CTR 중 2개 지표가 상대 슬롯보다 우세",
		});
	}

	if (weakRetention.length > 0) {
		experiments.push({
			id: "retention-edit-test",
			type: "retention_edit",
			title: "리텐션 컷 재편집",
			priority: 90,
			hypothesis: "첫 30초 컷 밀도와 90-150초 챕터 전환을 보강하면 평균 시청시간이 회복됩니다.",
			metric: "평균 시청시간, 평균 시청률, 이탈 구간",
			actions: [
				`${weakRetention[0]?.title ?? "리텐션 약한 영상"}의 첫 10초를 결과/반전 컷으로 재배치합니다.`,
				"롱폼은 90-150초마다 새 자료, 인물, 반론, 증거 중 하나를 넣습니다.",
				"쇼츠는 3초 안에 제목의 약속을 화면으로 회수합니다.",
			],
			successCriteria: "평균 시청시간 +15% 또는 첫 30초 이탈률 감소",
		});
	}

	const hasShorts = uploads.some((upload) => uploadLooksLikeFormat(upload, "shorts"));
	const hasLongform = uploads.some((upload) => uploadLooksLikeFormat(upload, "longform"));
	if (hasShorts || hasLongform) {
		experiments.push({
			id: "shorts-longform-funnel",
			type: "shorts_longform_funnel",
			title: "Shorts에서 롱폼으로 넘기는 퍼널",
			priority: hasShorts && hasLongform ? 82 : 68,
			hypothesis: "쇼츠는 한 질문만 회수하고 롱폼은 근거/챕터로 확장하면 구독 전환과 세션 길이가 올라갑니다.",
			metric: "쇼츠 조회 대비 롱폼 클릭, 구독자 증가, 재방문",
			actions: [
				"쇼츠 마지막 3초에 롱폼에서 회수할 질문 1개만 남깁니다.",
				"설명 첫 줄과 고정 댓글에 관련 롱폼/시리즈 링크를 둡니다.",
				"롱폼 제목은 쇼츠 제목을 반복하지 말고 더 큰 질문으로 확장합니다.",
			],
			successCriteria: "쇼츠 업로드 72시간 내 관련 롱폼 조회 또는 구독 증가 감지",
		});
	}

	if (growthPlan.metadataActions.length > 0) {
		experiments.push({
			id: "metadata-refresh",
			type: "metadata_refresh",
			title: "검색/추천 메타데이터 보강",
			priority: 66,
			hypothesis: "설명 첫 2줄, 태그 수, 제목 첫 45자를 정리하면 검색 매칭과 추천 문맥이 선명해집니다.",
			metric: "검색 유입, 관련 동영상 유입, CTR",
			actions: growthPlan.metadataActions.slice(0, 3),
			successCriteria: "48-96시간 안에 검색/관련 유입 또는 CTR 하락 방어",
		});
	}

	return experiments.sort((a, b) => b.priority - a.priority).slice(0, 5);
}

function buildDistributionTasks(params: {
	queued: UploadListItem[];
	growthPlan: GrowthPlan;
	scaleDecisions: GrowthScaleDecision[];
}): GrowthDistributionTask[] {
	const { queued, growthPlan, scaleDecisions } = params;
	const firstQueued = queued[0];
	const topScale = scaleDecisions.find((decision) => decision.kind === "scale");
	const firstWindow = growthPlan.publishWindows[0];
	const tasks: GrowthDistributionTask[] = [];

	tasks.push({
		id: "d0-publish-window",
		when: firstWindow?.label ?? "다음 저녁 슬롯",
		channel: "youtube",
		title: firstQueued
			? `"${truncate(firstQueued.title ?? "다음 업로드", 34)}" 예약`
			: "다음 파일럿 업로드 예약",
		reason: firstWindow?.reason ?? "초기 데이터가 부족해 기준 슬롯을 확보합니다.",
		linkedUploadId: firstQueued?.id,
	});
	tasks.push({
		id: "d0-comment",
		when: "게시 직후 10분",
		channel: "comments",
		title: "고정 댓글 CTA",
		reason: "쇼츠/롱폼 퍼널, 다음 편 예고, 출처 링크를 댓글에 고정해 세션을 늘립니다.",
		linkedUploadId: firstQueued?.id,
	});
	tasks.push({
		id: "d1-thumbnail-check",
		when: "D+1",
		channel: "metadata",
		title: "CTR 낮은 영상 패키징 1회 수정",
		reason: "제목과 썸네일을 동시에 바꾸면 원인 분리가 안 되므로 하나만 수정합니다.",
	});
	tasks.push({
		id: "d3-community",
		when: "D+3",
		channel: "community",
		title: "커뮤니티/시리즈 질문 게시",
		reason: "댓글 반응을 다음 주제 후보로 회수하고 재방문 신호를 만듭니다.",
	});
	tasks.push({
		id: "d7-scale",
		when: "D+7",
		channel: "shorts",
		title: topScale
			? `"${truncate(topScale.title, 30)}" 변주 3개 제작`
			: "상위 포맷 1개만 변주 제작",
		reason: topScale?.reason ?? "승자 포맷이 없으면 조회수보다 CTR/평균 시청을 먼저 비교합니다.",
		linkedUploadId: topScale?.uploadId,
	});

	return tasks;
}

function buildScaleDecisions(params: {
	uploads: UploadListItem[];
	analyticsByUploadId: Record<string, UploadAnalyticsSnapshot | undefined>;
	rendersById: Record<string, UploadRenderSnapshot | undefined>;
}): GrowthScaleDecision[] {
	const { uploads, analyticsByUploadId, rendersById } = params;
	return uploads
		.map((upload) => {
			const analytics = analyticsByUploadId[upload.id];
			if (!analytics) return null;
			const ctr = normalizeCtr(analytics.ctr);
			const watchSeconds = Number(analytics.avg_watch_duration ?? 0);
			const render = renderFor(upload, rendersById);
			const duration = Number(render?.duration_seconds ?? 0);
			const retention = duration > 0 && watchSeconds > 0 ? watchSeconds / duration : null;
			const engagementScore =
				Number(analytics.likes ?? 0) * 2 +
				Number(analytics.comments ?? 0) * 3 +
				Number(analytics.subscribers_gained ?? 0) * 12;
			const score = Math.round(
				Math.min(100, (ctr ?? 0) * 7 + watchSeconds * 0.45 + engagementScore),
			);
			const title = upload.title?.trim() || "제목 없음";

			if ((ctr ?? 0) >= 7 && (retention === null || retention >= 0.42)) {
				return {
					uploadId: upload.id,
					title,
					kind: "scale" as const,
					score,
					reason: `CTR ${formatPercent(ctr)}와 시청 지속 신호가 스케일 기준을 넘었습니다.`,
					action: "같은 편집 문법으로 소재만 바꾼 후속 3개를 72시간 안에 예약하세요.",
				};
			}
			if ((ctr ?? 0) > 0 && (ctr ?? 0) < 3) {
				return {
					uploadId: upload.id,
					title,
					kind: "fix_packaging" as const,
					score,
					reason: `CTR ${formatPercent(ctr)}라 클릭 패키징 문제가 우선입니다.`,
					action: "제목 첫 45자 또는 썸네일 문구 중 하나만 교체해 원인을 분리하세요.",
				};
			}
			if (retention !== null && retention < 0.32) {
				return {
					uploadId: upload.id,
					title,
					kind: "fix_retention" as const,
					score,
					reason: `평균 시청이 전체 길이의 ${Math.round(retention * 100)}%라 편집 리듬 보강이 필요합니다.`,
					action: "첫 10초를 결과 컷으로 재배치하고 중간 챕터 전환을 추가하세요.",
				};
			}
			return {
				uploadId: upload.id,
				title,
				kind: "observe" as const,
				score,
				reason: "강한 스케일/수정 신호가 아직 부족합니다.",
				action: "동일 포맷 1개를 더 게시해 제목/썸네일/시간대 변수를 분리하세요.",
			};
		})
		.filter(isGrowthScaleDecision)
		.sort((a, b) => decisionPriority(b) - decisionPriority(a) || b.score - a.score)
		.slice(0, 8);
}

function buildRiskControls(params: {
	uploads: UploadListItem[];
	queued: UploadListItem[];
	criticalPolicyCount: number;
	warningPolicyCount: number;
	analyticsCoverage: number;
	thumbnailCoverage: number;
	durationCoverage: number;
}): GrowthRiskControl[] {
	const {
		uploads,
		queued,
		criticalPolicyCount,
		warningPolicyCount,
		analyticsCoverage,
		thumbnailCoverage,
		durationCoverage,
	} = params;
	const risks: GrowthRiskControl[] = [];
	const duplicateTitles = duplicateTitleCount(uploads);
	const weakThumbnailItems = queued.filter((upload) => {
		const readiness = assessThumbnailReadiness({
			title: upload.title,
			description: upload.description,
			thumbnailPath: upload.thumbnail_path,
			requirePlan: false,
		});
		return readiness.level !== "ready";
	}).length;

	if (criticalPolicyCount > 0) {
		risks.push({
			id: "critical-policy",
			severity: "blocked",
			title: "critical 정책 신호",
			detail: `${criticalPolicyCount}개 업로드가 실제 영상 오인, 기만, 외부 유도 같은 차단 후보입니다.`,
			action: "공개 전 제목/설명/출처 표현을 낮추고 정책 체크를 다시 통과시키세요.",
		});
	}
	if (warningPolicyCount > 0) {
		risks.push({
			id: "warning-policy",
			severity: "risk",
			title: "정책 경고 신호",
			detail: `${warningPolicyCount}개 업로드에 반복 양산, 단정 표현, 출처 약함 신호가 있습니다.`,
			action: "각 영상마다 고유 타임라인, 출처, 해석, 결론을 추가하세요.",
		});
	}
	if (queued.length > 0 && (thumbnailCoverage < 0.75 || weakThumbnailItems > 0)) {
		risks.push({
			id: "thumbnail-gap",
			severity: thumbnailCoverage < 0.4 ? "risk" : "watch",
			title: "썸네일 패키징 약함",
			detail: `대기열 썸네일 준비율 ${Math.round(thumbnailCoverage * 100)}%, 보강 후보 ${weakThumbnailItems}개입니다.`,
			action: "업로드 전 제목/썸네일 3안과 첫 프레임 구조를 같이 저장하세요.",
		});
	}
	if (uploads.some((upload) => isPublished(upload)) && analyticsCoverage < 0.5) {
		risks.push({
			id: "analytics-gap",
			severity: "watch",
			title: "성과 회수 부족",
			detail: `게시 영상 분석 연결률이 ${Math.round(analyticsCoverage * 100)}%라 추천 신뢰도가 낮습니다.`,
			action: "게시된 YouTube 영상의 분석 동기화를 먼저 실행하세요.",
		});
	}
	if (uploads.length > 0 && durationCoverage < 0.7) {
		risks.push({
			id: "duration-gap",
			severity: "watch",
			title: "길이 데이터 부족",
			detail: `렌더 길이 데이터 연결률이 ${Math.round(durationCoverage * 100)}%입니다.`,
			action: "렌더 테이블의 format/duration_seconds 연결을 확인해 길이 추천을 실제값으로 바꾸세요.",
		});
	}
	if (duplicateTitles > 0) {
		risks.push({
			id: "duplicate-title",
			severity: "risk",
			title: "반복 제목 패턴",
			detail: `${duplicateTitles}개 제목이 사실상 중복입니다.`,
			action: "주제명만 바꾸는 템플릿 반복을 줄이고 각 영상의 고유 질문을 제목에 반영하세요.",
		});
	}

	return risks.slice(0, 6);
}

function buildMissingData(params: {
	uploads: UploadListItem[];
	published: UploadListItem[];
	queued: UploadListItem[];
	analyticsCoverage: number;
	thumbnailCoverage: number;
	durationCoverage: number;
	analyticsByUploadId: Record<string, UploadAnalyticsSnapshot | undefined>;
	rendersById: Record<string, UploadRenderSnapshot | undefined>;
}): GrowthMissingData[] {
	const {
		uploads,
		published,
		queued,
		analyticsCoverage,
		thumbnailCoverage,
		durationCoverage,
		analyticsByUploadId,
		rendersById,
	} = params;
	const missingAnalytics = published.filter(
		(upload) => !analyticsByUploadId[upload.id],
	).length;
	const missingThumbnails = queued.filter((upload) => !upload.thumbnail_path).length;
	const missingDurations = uploads.filter(
		(upload) => !renderFor(upload, rendersById)?.duration_seconds,
	).length;
	const missing: GrowthMissingData[] = [];

	if (published.length > 0 && (missingAnalytics > 0 || analyticsCoverage < 0.7)) {
		missing.push({
			id: "analytics",
			label: "YouTube Analytics",
			count: missingAnalytics,
			impact: "CTR/시청지속/구독 전환이 없어 스케일 판단이 추정으로 떨어집니다.",
			action: "업로드 관리에서 게시 영상 분석 동기화를 실행하세요.",
		});
	}
	if (queued.length > 0 && (missingThumbnails > 0 || thumbnailCoverage < 0.8)) {
		missing.push({
			id: "thumbnails",
			label: "썸네일 파일",
			count: missingThumbnails,
			impact: "업로드 패키징 실험과 CTR 학습이 약해집니다.",
			action: "승인 단계에서 썸네일/Shorts 첫 프레임을 생성하고 파일 경로를 저장하세요.",
		});
	}
	if (uploads.length > 0 && (missingDurations > 0 || durationCoverage < 0.8)) {
		missing.push({
			id: "durations",
			label: "렌더 길이",
			count: missingDurations,
			impact: "쇼츠/롱폼 길이 추천과 리텐션 판단이 부정확해집니다.",
			action: "renders.format과 duration_seconds가 업로드 render_id와 연결되는지 확인하세요.",
		});
	}

	return missing;
}

function commandCenterScore(params: {
	analyticsCoverage: number;
	thumbnailCoverage: number;
	durationCoverage: number;
	criticalPolicyCount: number;
	warningPolicyCount: number;
	experimentCount: number;
}): number {
	const {
		analyticsCoverage,
		thumbnailCoverage,
		durationCoverage,
		criticalPolicyCount,
		warningPolicyCount,
		experimentCount,
	} = params;
	const raw =
		30 +
		analyticsCoverage * 22 +
		thumbnailCoverage * 18 +
		durationCoverage * 12 +
		Math.min(18, experimentCount * 4) -
		criticalPolicyCount * 18 -
		warningPolicyCount * 4;
	return clamp(Math.round(raw), 0, 100);
}

function primaryObjective(params: {
	commandScore: number;
	totalUploads: number;
	queuedCount: number;
	publishedCount: number;
	analyticsCoverage: number;
	criticalPolicyCount: number;
	scaleDecisions: GrowthScaleDecision[];
}): string {
	if (params.totalUploads === 0) {
		return "첫 파일럿 3개를 만들고 업로드 루프를 시작하세요.";
	}
	if (params.criticalPolicyCount > 0) {
		return "업로드 전 정책 차단 신호를 먼저 제거하세요.";
	}
	if (params.publishedCount > 0 && params.analyticsCoverage < 0.5) {
		return "게시 영상 분석을 회수해 추천을 추정이 아니라 실제 지표 기반으로 바꾸세요.";
	}
	if (params.scaleDecisions.some((decision) => decision.kind === "scale")) {
		return "승자 포맷을 72시간 안에 3개 변주로 증폭하세요.";
	}
	if (params.queuedCount > 0) {
		return "대기열을 시간대 실험과 썸네일 3안 실험으로 예약하세요.";
	}
	if (params.commandScore < 60) {
		return "새 콘텐츠보다 측정/썸네일/길이 데이터부터 채워 운영 루프를 복구하세요.";
	}
	return "다음 파일럿 3개를 같은 포맷으로 운영해 승자 데이터를 만드세요.";
}

function renderFor(
	upload: UploadListItem,
	rendersById: Record<string, UploadRenderSnapshot | undefined>,
): UploadRenderSnapshot | undefined {
	return upload.render_id ? rendersById[upload.render_id] : undefined;
}

function isPublished(upload: UploadListItem): boolean {
	return normalizeUploadStatus(upload.status) === "published" || Boolean(upload.published_at);
}

function isAnalyticsSnapshot(
	value: UploadAnalyticsSnapshot | undefined,
): value is UploadAnalyticsSnapshot {
	return Boolean(value);
}

function isGrowthScaleDecision(
	value: GrowthScaleDecision | null,
): value is GrowthScaleDecision {
	return Boolean(value);
}

function uploadLooksLikeFormat(
	upload: UploadListItem,
	format: "shorts" | "longform",
): boolean {
	const text = `${upload.title ?? ""} ${upload.description ?? ""} ${(upload.tags ?? []).join(" ")}`.toLowerCase();
	if (format === "shorts") return text.includes("shorts") || text.includes("쇼츠");
	return text.includes("longform") || text.includes("롱폼");
}

function normalizeCtr(value: number | null | undefined): number | null {
	const numberValue = Number(value);
	if (!Number.isFinite(numberValue) || numberValue <= 0) return null;
	return numberValue <= 1 ? numberValue * 100 : numberValue;
}

function decisionPriority(decision: GrowthScaleDecision): number {
	if (decision.kind === "scale") return 4;
	if (decision.kind === "fix_packaging") return 3;
	if (decision.kind === "fix_retention") return 2;
	return 1;
}

function duplicateTitleCount(uploads: UploadListItem[]): number {
	const normalized = uploads
		.map((upload) =>
			(upload.title ?? "")
				.toLowerCase()
				.replace(/[#\d０-９0-9]/g, "")
				.replace(/\s+/g, " ")
				.trim(),
		)
		.filter((title) => title.length >= 8);
	const seen = new Set<string>();
	let duplicates = 0;
	for (const title of normalized) {
		if (seen.has(title)) duplicates += 1;
		seen.add(title);
	}
	return duplicates;
}

function isWithinDays(value: string | null | undefined, now: Date, days: number): boolean {
	if (!value) return false;
	const time = new Date(value).getTime();
	if (!Number.isFinite(time)) return false;
	const diff = time - now.getTime();
	return diff >= 0 && diff <= days * 24 * 60 * 60 * 1000;
}

function ratio(numerator: number, denominator: number): number {
	if (denominator <= 0) return 0;
	return numerator / denominator;
}

function sum(values: Array<number | null | undefined>): number {
	return values.reduce<number>((total, value) => {
		const numberValue = Number(value ?? 0);
		return total + (Number.isFinite(numberValue) ? numberValue : 0);
	}, 0);
}

function average(values: number[]): number | null {
	if (values.length === 0) return null;
	return values.reduce((total, value) => total + value, 0) / values.length;
}

function isFiniteNumber(value: number | null): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function compactNumber(value: number): string {
	return new Intl.NumberFormat("ko-KR", {
		notation: value >= 10_000 ? "compact" : "standard",
		maximumFractionDigits: 1,
	}).format(value);
}

function formatPercent(value: number | null): string {
	if (value === null) return "데이터 없음";
	return `${Math.round(value * 10) / 10}%`;
}

function formatSeconds(value: number | null): string {
	if (value === null) return "데이터 없음";
	const seconds = Math.round(value);
	if (seconds >= 60) {
		const minutes = Math.floor(seconds / 60);
		const rest = seconds % 60;
		return rest ? `${minutes}분 ${rest}초` : `${minutes}분`;
	}
	return `${seconds}초`;
}

function truncate(value: string, maxLength: number): string {
	const trimmed = value.trim();
	if (trimmed.length <= maxLength) return trimmed;
	return `${trimmed.slice(0, maxLength - 1).trim()}…`;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}
