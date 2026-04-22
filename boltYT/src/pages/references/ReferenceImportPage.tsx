import {
	PButton,
	PHeading,
	PInlineNotification,
	PInputText,
	PSelect,
	PSelectOption,
	PSpinner,
	PText,
} from "@porsche-design-system/components-react";
import { ArrowLeft, CheckCircle2, Tv } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
	type AnalysisJob,
	checkAnalyzerHealth,
	cleanupAnalysisJob,
	saveReferenceTemplate,
	startYouTubeAnalysis,
	waitForAnalysis,
} from "../../lib/reference-import";
import { supabase } from "../../lib/supabase";
import type { Channel } from "../../types/database";

const STATUS_LABEL: Record<AnalysisJob["status"], string> = {
	queued: "대기 중",
	downloading: "영상 다운로드 중...",
	extracting: "프레임/오디오 추출 중...",
	transcribing: "스크립트 전사 중 (Whisper)...",
	analyzing: "스타일 분석 중 (GPT-4o Vision)...",
	complete: "분석 완료",
	failed: "실패",
};

export default function ReferenceImportPage() {
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const channelParam = searchParams.get("channel") ?? "";

	const [channels, setChannels] = useState<Channel[]>([]);
	const [channelId, setChannelId] = useState(channelParam);
	const [url, setUrl] = useState("");
	const [name, setName] = useState("");

	const [analyzerReady, setAnalyzerReady] = useState<boolean | null>(null);
	const [job, setJob] = useState<AnalysisJob | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		void checkAnalyzerHealth().then(setAnalyzerReady);
		supabase
			.from("channels")
			.select("*")
			.order("name")
			.then(({ data }) => {
				const list = (data ?? []) as Channel[];
				setChannels(list);
				if (!channelId && list.length > 0) setChannelId(list[0].id);
			});
	}, [channelId]);

	async function handleAnalyze() {
		if (!url.trim()) {
			setError("URL을 입력하세요.");
			return;
		}
		if (!channelId) {
			setError("채널을 선택하세요.");
			return;
		}
		setError(null);
		setJob(null);

		try {
			const started = await startYouTubeAnalysis(url.trim());
			setJob(started);
			const final = await waitForAnalysis(started.id, (j) => setJob(j));
			setJob(final);
			if (final.status === "failed") {
				setError(final.error ?? "분석 실패");
				void cleanupAnalysisJob(final.id);
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : "분석 시작 실패");
		}
	}

	async function handleSave() {
		if (!job?.result) return;
		setSaving(true);
		setError(null);
		try {
			const saved = await saveReferenceTemplate(
				channelId,
				name.trim() || job.result.source_title || "이름 없음",
				job.result,
			);
			void cleanupAnalysisJob(job.id);
			navigate(`/references/${saved.id}`);
		} catch (e) {
			setError(e instanceof Error ? e.message : "저장 실패");
		} finally {
			setSaving(false);
		}
	}

	const inProgress =
		job?.status && job.status !== "complete" && job.status !== "failed";

	return (
		<div className="max-w-3xl">
			<button
				type="button"
				onClick={() => navigate("/references")}
				className="flex items-center gap-2 text-sm opacity-60 hover:opacity-100 mb-4"
			>
				<ArrowLeft size={14} /> 목록
			</button>

			<PHeading tag="h1" size="large" className="mb-static-md">
				새 레퍼런스 분석
			</PHeading>

			<PInlineNotification
				state="info"
				heading="YouTube 저작권 주의"
				dismissButton={false}
				className="mb-static-md"
			>
				원본 저작권자 권리가 유지됩니다. 분석·스타일 참조 용도로만 내부에서
				사용하고, 추출된 프레임·오디오·전사를 그대로 재업로드하지 마세요.
			</PInlineNotification>

			{analyzerReady === false && (
				<PInlineNotification
					state="warning"
					heading="분석 서버가 꺼져 있습니다"
					description="터미널에서 npm run reference-analyzer 실행 후 새로고침하세요."
					dismissButton={false}
					className="mb-static-md"
				/>
			)}

			<div className="space-y-4 bg-[#141414] p-6 rounded-lg border border-[#2a2a2a]">
				<PSelect
					name="channel"
					label="채널"
					value={channelId}
					onUpdate={(e) => setChannelId(String(e.detail.value ?? ""))}
				>
					{channels.map((ch) => (
						<PSelectOption key={ch.id} value={ch.id}>
							{ch.name}
						</PSelectOption>
					))}
				</PSelect>

				<PInputText
					name="url"
					label="YouTube Shorts URL"
					description="https://www.youtube.com/shorts/... (최대 3분 영상까지 분석 가능)"
					value={url}
					onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
					disabled={Boolean(inProgress)}
				>
					<span slot="start">
						<Tv size={16} className="opacity-60" />
					</span>
				</PInputText>

				<PInputText
					name="name"
					label="별칭 (선택)"
					description="없으면 영상 제목 사용"
					value={name}
					onInput={(e) => setName((e.target as HTMLInputElement).value)}
					disabled={Boolean(inProgress)}
				/>

				<div className="flex justify-end">
					<PButton
						onClick={handleAnalyze}
						loading={Boolean(inProgress)}
						disabled={!url.trim() || !channelId || analyzerReady === false}
					>
						분석 시작
					</PButton>
				</div>
			</div>

			{error && (
				<PInlineNotification
					state="error"
					heading="오류"
					description={error}
					dismissButton={false}
					className="mt-static-md"
				/>
			)}

			{job && (
				<div className="mt-static-lg bg-[#141414] p-6 rounded-lg border border-[#2a2a2a]">
					<div className="flex items-center gap-3 mb-4">
						{inProgress ? (
							<PSpinner size="small" />
						) : job.status === "complete" ? (
							<CheckCircle2 className="text-green-500" size={20} />
						) : null}
						<div>
							<PText className="font-semibold">
								{STATUS_LABEL[job.status]}
							</PText>
							<PText size="x-small" color="neutral-contrast-medium">
								진행률 {job.progress}%
							</PText>
						</div>
					</div>

					{/* 진행 바 */}
					<div className="w-full h-2 bg-[#2a2a2a] rounded-full overflow-hidden mb-4">
						<div
							className="h-full bg-blue-500 transition-all duration-500"
							style={{ width: `${job.progress}%` }}
						/>
					</div>

					{job.result && (
						<div className="space-y-4 mt-6 pt-6 border-t border-[#2a2a2a]">
							<PHeading tag="h3" size="small">
								분석 결과 미리보기
							</PHeading>

							<div className="grid grid-cols-2 gap-3 text-sm">
								<Stat label="제목" value={job.result.source_title} />
								<Stat label="제작자" value={job.result.source_creator} />
								<Stat
									label="길이"
									value={`${Math.round(job.result.duration_seconds)}초`}
								/>
								<Stat
									label="씬 수 / 평균 길이"
									value={`${job.result.scene_count}개 / ${job.result.avg_scene_duration.toFixed(1)}초`}
								/>
								<Stat label="무드" value={job.result.visual_mood} />
								<Stat label="페이싱" value={job.result.pacing_preset} />
								<Stat
									label="자막 위치/크기"
									value={`${job.result.subtitle_position} / ${job.result.subtitle_size_preset}`}
								/>
								<Stat label="전환 스타일" value={job.result.transition_style} />
								<Stat label="BGM 무드" value={job.result.bgm_mood} />
								<Stat label="훅 패턴" value={job.result.hook_pattern} />
							</div>

							{job.result.dominant_colors.length > 0 && (
								<div>
									<PText size="x-small" color="neutral-contrast-medium">
										도미넌트 컬러
									</PText>
									<div className="flex gap-2 mt-1">
										{job.result.dominant_colors.slice(0, 6).map((c) => (
											<div
												key={c}
												className="w-8 h-8 rounded border border-[#2a2a2a]"
												style={{ backgroundColor: c }}
												title={c}
											/>
										))}
									</div>
								</div>
							)}

							{job.result.visual_prompt_template && (
								<div>
									<PText size="x-small" color="neutral-contrast-medium">
										시각 프롬프트 템플릿
									</PText>
									<PText size="small" className="mt-1 opacity-80">
										{job.result.visual_prompt_template}
									</PText>
								</div>
							)}

							{job.result.transcript && (
								<div>
									<PText size="x-small" color="neutral-contrast-medium">
										전사 (발췌)
									</PText>
									<PText size="small" className="mt-1 opacity-80 line-clamp-3">
										{job.result.transcript}
									</PText>
								</div>
							)}

							<div className="flex justify-end gap-2 pt-4">
								<PButton variant="secondary" onClick={() => setJob(null)}>
									다시 분석
								</PButton>
								<PButton onClick={handleSave} loading={saving}>
									템플릿으로 저장
								</PButton>
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<PText size="x-small" color="neutral-contrast-medium">
				{label}
			</PText>
			<PText size="small" className="font-medium">
				{value || "—"}
			</PText>
		</div>
	);
}
