import {
	PButton,
	PHeading,
	PInlineNotification,
	PSpinner,
	PText,
} from "@porsche-design-system/components-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DEMO_CHANNELS } from "../../lib/demo-data";
import { getReferenceTemplate } from "../../lib/reference-import";
import { DEMO_MODE, supabase } from "../../lib/supabase";
import type { Channel, ReferenceTemplate } from "../../types/database";
import StepBrief from "./StepBrief";
import StepIndicator from "./StepIndicator";
import StepMedia from "./StepMedia";
import StepPreview from "./StepPreview";
import StepResearch from "./StepResearch";
import StepScript from "./StepScript";
import StepTopic from "./StepTopic";

export type ContentMode = "ai" | "research";

export interface CollectedSource {
	id: string;
	type: "image" | "video" | "article";
	url: string;
	title: string;
	thumbnail?: string;
	/** 기사 스니펫/영상 설명 (짧은 요약) */
	description?: string;
	/** 기사 본문 전체 텍스트 (A: 서버 스크래핑 결과) */
	bodyText?: string;
	/** 기사 발행 일자 (ISO 또는 표시용) */
	pubDate?: string;
	/** 기사/영상 출처 (언론사명/YouTube 채널명) */
	publisher?: string;
	/** 사건 시점 날짜 — 기사 발행일과 다를 수 있음 */
	eventDate?: string;
	/** 사건 시점 제목/장면 설명 */
	eventTitle?: string;
}

const AI_STEPS = [
	"주제 입력",
	"브리프 생성",
	"스크립트",
	"미디어 생성",
	"미리보기",
];
const RESEARCH_STEPS = [
	"주제 입력",
	"자료 수집",
	"스크립트",
	"미디어 생성",
	"미리보기",
];

export default function ContentWizardPage() {
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const [mode, setMode] = useState<ContentMode | null>(null);
	const [step, setStep] = useState(0);
	const [channels, setChannels] = useState<Channel[]>(
		DEMO_MODE ? (DEMO_CHANNELS as Channel[]) : [],
	);
	const [selectedChannelId, setSelectedChannelId] = useState(
		DEMO_MODE ? DEMO_CHANNELS[0].id : "",
	);
	const [topicId, setTopicId] = useState("");
	const [briefId, setBriefId] = useState("");
	const [scriptId, setScriptId] = useState("");
	const [sources, setSources] = useState<CollectedSource[]>([]);
	const [referenceTemplate, setReferenceTemplate] =
		useState<ReferenceTemplate | null>(null);
	const [loading, setLoading] = useState(!DEMO_MODE);

	useEffect(() => {
		const templateId = searchParams.get("template");
		if (templateId) {
			void getReferenceTemplate(templateId).then((t) => {
				if (t) setReferenceTemplate(t);
			});
		}
		if (DEMO_MODE) return;
		supabase
			.from("channels")
			.select("*")
			.order("name")
			.then(({ data }) => {
				const list = data ?? [];
				setChannels(list);
				// Pre-select channel from URL param, else default to first
				const channelParam = searchParams.get("channel");
				if (channelParam && list.some((c) => c.id === channelParam)) {
					setSelectedChannelId(channelParam);
				} else if (list.length > 0) {
					setSelectedChannelId(list[0].id);
				}
				setLoading(false);
			});
	}, [searchParams]);

	if (loading) {
		return (
			<div className="flex items-center justify-center h-64">
				<PSpinner size="medium" />
			</div>
		);
	}

	if (channels.length === 0) {
		return (
			<div className="max-w-2xl text-center py-fluid-lg">
				<PHeading size="large" tag="h1">
					콘텐츠 생성
				</PHeading>
				<PText color="contrast-medium" className="mt-static-md">
					먼저 채널을 생성해주세요.
				</PText>
				<PButton
					className="mt-static-lg"
					onClick={() => navigate("/channels/new")}
				>
					채널 만들기
				</PButton>
			</div>
		);
	}

	// Mode selection screen
	if (!mode) {
		return (
			<div className="max-w-3xl">
				<PHeading size="x-large" tag="h1" className="mb-static-sm">
					콘텐츠 생성
				</PHeading>
				<PText color="contrast-medium" className="mb-fluid-lg">
					어떤 방식으로 영상을 만들까요?
				</PText>

				<div className="grid grid-cols-1 md:grid-cols-2 gap-static-md">
					<button
						type="button"
						className="bg-surface rounded-[8px] p-static-lg text-left border-2 border-transparent hover:border-primary transition-colors cursor-pointer"
						onClick={() => setMode("ai")}
					>
						<div className="text-[32px] mb-static-sm">✨</div>
						<PHeading size="small" tag="h3" className="mb-static-xs">
							AI 자동 생성
						</PHeading>
						<PText size="small" color="contrast-medium">
							주제만 입력하면 AI가 스크립트, 이미지, 음성을 모두 생성합니다.
							빠르게 영상을 만들 때 좋습니다.
						</PText>
					</button>

					<button
						type="button"
						className="bg-surface rounded-[8px] p-static-lg text-left border-2 border-transparent hover:border-primary transition-colors cursor-pointer"
						onClick={() => setMode("research")}
					>
						<div className="text-[32px] mb-static-sm">🔍</div>
						<PHeading size="small" tag="h3" className="mb-static-xs">
							자료 기반 제작
						</PHeading>
						<PText size="small" color="contrast-medium">
							뉴스, 사진, 영상 자료를 수집하고, 그 자료들을 엮어서 영상을
							구성합니다. 다큐/미스테리/정보 영상에 적합합니다.
						</PText>
					</button>
				</div>
			</div>
		);
	}

	const stepLabels = mode === "ai" ? AI_STEPS : RESEARCH_STEPS;

	return (
		<div className="max-w-3xl">
			<div className="flex items-center gap-static-sm mb-static-sm">
				<PHeading size="x-large" tag="h1">
					콘텐츠 생성
				</PHeading>
				<button
					type="button"
					className="text-[12px] text-contrast-medium hover:text-primary transition-colors cursor-pointer underline bg-transparent border-0"
					onClick={() => {
						setMode(null);
						setStep(0);
					}}
				>
					모드 변경
				</button>
			</div>
			<PText color="contrast-medium" className="mb-fluid-md">
				{mode === "ai"
					? "AI가 모든 콘텐츠를 자동 생성합니다."
					: "자료를 수집하고 영상으로 구성합니다."}
			</PText>

			{referenceTemplate && (
				<PInlineNotification
					state="info"
					heading={`레퍼런스 템플릿 적용 중: ${referenceTemplate.name || referenceTemplate.source_title}`}
					description={`무드: ${referenceTemplate.visual_mood} · 페이싱: ${referenceTemplate.pacing_preset} · 씬 ${referenceTemplate.scene_count}개 · 평균 ${referenceTemplate.avg_scene_duration}초`}
					onDismiss={() => setReferenceTemplate(null)}
					className="mb-fluid-sm"
				/>
			)}

			<StepIndicator steps={stepLabels} currentStep={step} />

			<div className="mt-fluid-md">
				{/* Step 0: 주제 입력 (공통) */}
				{step === 0 && (
					<StepTopic
						channels={channels}
						selectedChannelId={selectedChannelId}
						onChannelChange={setSelectedChannelId}
						onNext={(id) => {
							setTopicId(id);
							setStep(1);
						}}
					/>
				)}

				{/* Step 1: AI → 브리프 / Research → 자료 수집 */}
				{step === 1 && mode === "ai" && (
					<StepBrief
						topicId={topicId}
						onNext={(id) => {
							setBriefId(id);
							setStep(2);
						}}
						onBack={() => setStep(0)}
					/>
				)}
				{step === 1 && mode === "research" && (
					<StepResearch
						topicId={topicId}
						sources={sources}
						onSourcesChange={setSources}
						onNext={() => setStep(2)}
						onBack={() => setStep(0)}
					/>
				)}

				{/* Step 2: 스크립트 (공통 — research 모드는 sources 전달) */}
				{step === 2 && (
					<StepScript
						briefId={mode === "ai" ? briefId : topicId}
						mode={mode}
						sources={sources}
						referenceTemplate={referenceTemplate}
						onNext={(id) => {
							setScriptId(id);
							setStep(3);
						}}
						onBack={() => setStep(1)}
					/>
				)}

				{/* Step 3: 미디어 생성 */}
				{step === 3 && (
					<StepMedia
						scriptId={scriptId}
						mode={mode}
						sources={sources}
						referenceTemplate={referenceTemplate}
						onNext={() => setStep(4)}
						onBack={() => setStep(2)}
					/>
				)}

				{/* Step 4: 미리보기 */}
				{step === 4 && (
					<StepPreview
						scriptId={scriptId}
						referenceTemplate={referenceTemplate}
						onBack={() => setStep(3)}
					/>
				)}
			</div>
		</div>
	);
}
