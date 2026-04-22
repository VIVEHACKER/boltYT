import {
	PButton,
	PHeading,
	PInlineNotification,
	PSpinner,
	PTag,
	PText,
} from "@porsche-design-system/components-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ContentStatusBadge from "../../components/ContentStatusBadge";
import ScenePlayer from "../../components/ScenePlayer";
import TabButton from "../../components/TabButton";
import { ensureBlobUrls } from "../../lib/local-db";
import { supabase } from "../../lib/supabase";
import type { Scene } from "../../types/database";

interface TopicDetail {
	id: string;
	title: string;
	status: string;
	source: string;
	created_at: string;
	channel_name: string;
}

interface BriefDetail {
	id: string;
	core_message: string;
	target_audience: string;
	cautions: string;
	shorts_hooks: string[];
	longform_outline: { order: number; text: string }[];
}

interface ScriptDetail {
	id: string;
	format: string;
	content_json: { shorts_script?: string; format_selection?: string };
	status: string;
}

type SceneWithImage = Scene & { imageUrl?: string };

export default function ContentDetailPage() {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const [loading, setLoading] = useState(true);
	const [topic, setTopic] = useState<TopicDetail | null>(null);
	const [brief, setBrief] = useState<BriefDetail | null>(null);
	const [script, setScript] = useState<ScriptDetail | null>(null);
	const [scenes, setScenes] = useState<SceneWithImage[]>([]);
	const [activeTab, setActiveTab] = useState<
		"player" | "storyboard" | "brief" | "script"
	>("player");

	const loadContent = useCallback(async (topicId: string) => {
		const { data: topicData } = await supabase
			.from("topics")
			.select("*, channels(name)")
			.eq("id", topicId)
			.maybeSingle();

		if (!topicData) {
			setLoading(false);
			return;
		}

		const channel = (topicData as Record<string, unknown>).channels as {
			name: string;
		} | null;
		setTopic({
			id: topicData.id,
			title: topicData.title,
			status: topicData.status,
			source: topicData.source,
			created_at: topicData.created_at,
			channel_name: channel?.name ?? "",
		});

		const { data: briefData } = await supabase
			.from("briefs")
			.select("*")
			.eq("topic_id", topicId)
			.order("created_at", { ascending: false })
			.limit(1)
			.maybeSingle();

		if (briefData) {
			setBrief(briefData as unknown as BriefDetail);

			const { data: scriptData } = await supabase
				.from("scripts")
				.select("*")
				.eq("brief_id", briefData.id)
				.order("created_at", { ascending: false })
				.limit(1)
				.maybeSingle();

			if (scriptData) {
				setScript(scriptData as unknown as ScriptDetail);

				const { data: scenesData } = await supabase
					.from("scenes")
					.select("*")
					.eq("script_id", scriptData.id)
					.order("order_index");

				const rawScenes = (scenesData ?? []) as Scene[];

				const { data: assets } = await supabase
					.from("media_assets")
					.select("scene_id, storage_path, status, type")
					.in(
						"scene_id",
						rawScenes.map((s) => s.id),
					)
					.in("type", ["image", "video"])
					.eq("status", "complete");

				const storagePaths = (assets ?? [])
					.map((a) => a.storage_path)
					.filter((p) => p?.startsWith("scenes/"));
				const blobUrls = await ensureBlobUrls(storagePaths);

				const assetMap = new Map<string, string>();
				for (const a of assets ?? []) {
					if (!a.storage_path?.startsWith("scenes/")) continue;
					const url = blobUrls.get(a.storage_path) ?? "";
					if (url) assetMap.set(a.scene_id, url);
				}

				setScenes(
					rawScenes.map((s) => ({
						...s,
						imageUrl: assetMap.get(s.id) ?? (s.source_url || undefined),
					})),
				);
			}
		}

		setLoading(false);
	}, []);

	useEffect(() => {
		if (!id) return;
		// eslint-disable-next-line react-hooks/set-state-in-effect -- async topic detail fetch
		void loadContent(id);
	}, [id, loadContent]);

	if (loading) {
		return (
			<div className="flex items-center justify-center h-64">
				<PSpinner size="medium" />
			</div>
		);
	}

	if (!topic) {
		return (
			<div className="max-w-3xl">
				<PInlineNotification
					heading="콘텐츠를 찾을 수 없습니다"
					state="error"
					dismissButton={false}
				/>
				<PButton className="mt-static-md" onClick={() => navigate("/content")}>
					목록으로
				</PButton>
			</div>
		);
	}

	const totalDuration = scenes.reduce(
		(sum, s) => sum + Number(s.duration_seconds),
		0,
	);
	const shortsScript = script?.content_json?.shorts_script ?? "";
	const hasScenes = scenes.length > 0;

	const tabs: { key: typeof activeTab; label: string }[] = [
		...(hasScenes ? [{ key: "player" as const, label: "영상 미리보기" }] : []),
		{ key: "storyboard", label: "스토리보드" },
		{ key: "brief", label: "브리프" },
		{ key: "script", label: "스크립트" },
	];

	const effectiveTab =
		!hasScenes && activeTab === "player" ? "storyboard" : activeTab;

	return (
		<div className="max-w-4xl">
			<div className="flex items-center justify-between mb-static-sm">
				<div className="flex items-center gap-static-sm">
					<PButton
						variant="ghost"
						icon="arrow-left"
						compact
						hideLabel
						onClick={() => navigate("/content")}
					>
						뒤로
					</PButton>
					<PHeading size="x-large" tag="h1">
						{topic.title}
					</PHeading>
				</div>
				{hasScenes && (
					<PButton
						variant="secondary"
						compact
						onClick={() => navigate(`/content/${id}/editor`)}
					>
						타임라인 편집
					</PButton>
				)}
			</div>

			<div className="flex items-center gap-static-sm mb-fluid-md">
				<PText size="small" color="contrast-medium">
					{topic.channel_name}
				</PText>
				<PText size="x-small" color="contrast-medium">
					{new Date(topic.created_at).toLocaleDateString("ko-KR")}
				</PText>
				<ContentStatusBadge status={topic.status} />
			</div>

			{scenes.length > 0 && (
				<div className="grid grid-cols-3 gap-static-sm mb-fluid-md">
					<div className="bg-surface rounded-[8px] p-static-md text-center">
						<PText size="x-small" color="contrast-medium">
							씬 수
						</PText>
						<PText weight="semi-bold" size="large">
							{scenes.length}
						</PText>
					</div>
					<div className="bg-surface rounded-[8px] p-static-md text-center">
						<PText size="x-small" color="contrast-medium">
							총 길이
						</PText>
						<PText weight="semi-bold" size="large">
							{Math.floor(totalDuration / 60)}:
							{String(Math.round(totalDuration % 60)).padStart(2, "0")}
						</PText>
					</div>
					<div className="bg-surface rounded-[8px] p-static-md text-center">
						<PText size="x-small" color="contrast-medium">
							스크립트 상태
						</PText>
						<ContentStatusBadge status={script?.status ?? "draft"} />
					</div>
				</div>
			)}

			<div className="flex gap-static-xs mb-static-md">
				{tabs.map((tab) => (
					<TabButton
						key={tab.key}
						active={effectiveTab === tab.key}
						onClick={() => setActiveTab(tab.key)}
					>
						{tab.label}
					</TabButton>
				))}
			</div>

			{effectiveTab === "player" && hasScenes && (
				<ScenePlayer scenes={scenes} />
			)}

			{effectiveTab === "storyboard" && <StoryboardView scenes={scenes} />}

			{effectiveTab === "brief" && <BriefView brief={brief} />}

			{effectiveTab === "script" && (
				<ScriptView shortsScript={shortsScript} scenes={scenes} />
			)}
		</div>
	);
}

function StoryboardView({ scenes }: { scenes: SceneWithImage[] }) {
	if (scenes.length === 0) {
		return (
			<div className="bg-surface rounded-[8px] p-fluid-lg text-center">
				<PText color="contrast-medium">아직 씬이 생성되지 않았습니다.</PText>
			</div>
		);
	}

	const sceneStartTimes: number[] = [];
	let run = 0;
	for (const s of scenes) {
		sceneStartTimes.push(run);
		run += Number(s.duration_seconds);
	}

	function sceneTagColor(type: string) {
		if (type === "news_overlay") return "notification-error-soft";
		if (type === "video") return "notification-info-soft";
		if (type === "text_emphasis") return "notification-warning-soft";
		return "background-surface";
	}

	function sceneTagLabel(type: string) {
		if (type === "news_overlay") return "뉴스";
		if (type === "image") return "이미지";
		if (type === "video") return "영상";
		return "텍스트 강조";
	}

	function sceneSideColor(type: string) {
		if (type === "news_overlay") return "#e63946";
		if (type === "video") return "#2563eb";
		if (type === "text_emphasis") return "#d97706";
		return "#6B6D70";
	}

	return (
		<div className="flex flex-col gap-static-md">
			{scenes.map((scene, i) => {
				const startTime = sceneStartTimes[i] ?? 0;
				const isNews = scene.scene_type === "news_overlay";

				return (
					<div
						key={scene.id}
						className="bg-surface rounded-[8px] overflow-hidden"
					>
						<div className="flex">
							<div className="w-20 bg-canvas flex flex-col items-center justify-center p-static-sm shrink-0 border-r border-contrast-low">
								<PText weight="semi-bold" size="large">
									{i + 1}
								</PText>
								<PText size="x-small" color="contrast-medium">
									{Math.floor(startTime / 60)}:
									{String(Math.round(startTime % 60)).padStart(2, "0")}
								</PText>
							</div>

							{scene.imageUrl && (
								<div className="w-40 shrink-0 border-r border-contrast-low">
									<img
										src={scene.imageUrl}
										alt={`씬 ${i + 1}`}
										className="w-full h-full object-cover"
									/>
								</div>
							)}

							<div className="flex-1 p-static-md">
								<div className="flex items-center gap-static-sm mb-static-sm">
									<PTag color={sceneTagColor(scene.scene_type)}>
										{sceneTagLabel(scene.scene_type)}
									</PTag>
									<PText size="x-small" color="contrast-medium">
										{Number(scene.duration_seconds)}초
									</PText>
								</div>

								<PText size="small" className="mb-static-sm">
									{scene.narration_text}
								</PText>

								{isNews &&
									(scene.news_title ||
										scene.news_source ||
										scene.news_excerpt) && (
										<div className="bg-canvas rounded-[4px] p-static-sm border-l-4 border-[#e63946] mb-static-xs">
											{scene.news_source && (
												<PText
													size="x-small"
													color="contrast-medium"
													className="mb-1"
												>
													{scene.news_source}
													{scene.news_date && ` · ${scene.news_date}`}
												</PText>
											)}
											{scene.news_title && (
												<PText size="small" weight="semi-bold">
													{scene.news_title}
												</PText>
											)}
											{scene.news_excerpt && (
												<PText
													size="x-small"
													color="contrast-medium"
													className="mt-1"
												>
													{scene.news_excerpt}
												</PText>
											)}
										</div>
									)}

								{!isNews && scene.visual_prompt && (
									<div className="bg-canvas rounded-[4px] p-static-sm">
										<PText size="x-small" color="contrast-medium">
											비주얼: {scene.visual_prompt}
										</PText>
									</div>
								)}
							</div>

							<div
								className="w-2 shrink-0"
								style={{
									background: sceneSideColor(scene.scene_type),
								}}
							/>
						</div>
					</div>
				);
			})}
		</div>
	);
}

function BriefView({ brief }: { brief: BriefDetail | null }) {
	if (!brief) {
		return (
			<div className="bg-surface rounded-[8px] p-fluid-lg text-center">
				<PText color="contrast-medium">
					브리프가 아직 생성되지 않았습니다.
				</PText>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-static-md">
			<div className="bg-surface rounded-[8px] p-static-lg">
				<PHeading size="small" tag="h3" className="mb-static-sm">
					핵심 메시지
				</PHeading>
				<PText>{brief.core_message}</PText>
			</div>

			<div className="bg-surface rounded-[8px] p-static-lg">
				<PHeading size="small" tag="h3" className="mb-static-sm">
					타겟 시청자
				</PHeading>
				<PText>{brief.target_audience}</PText>
			</div>

			{brief.cautions && (
				<div className="bg-surface rounded-[8px] p-static-lg">
					<PHeading size="small" tag="h3" className="mb-static-sm">
						주의사항
					</PHeading>
					<PText>{brief.cautions}</PText>
				</div>
			)}

			{brief.shorts_hooks?.length > 0 && (
				<div className="bg-surface rounded-[8px] p-static-lg">
					<PHeading size="small" tag="h3" className="mb-static-sm">
						쇼츠 훅
					</PHeading>
					<div className="flex flex-col gap-static-xs">
						{brief.shorts_hooks.map((hook, i) => (
							<div key={hook} className="flex items-start gap-static-sm">
								<PTag color="notification-info-soft">{i + 1}</PTag>
								<PText size="small">{hook}</PText>
							</div>
						))}
					</div>
				</div>
			)}

			{brief.longform_outline?.length > 0 && (
				<div className="bg-surface rounded-[8px] p-static-lg">
					<PHeading size="small" tag="h3" className="mb-static-sm">
						롱폼 목차
					</PHeading>
					<div className="flex flex-col gap-static-xs">
						{brief.longform_outline.map((item, i) => (
							<PText key={item.text ?? i} size="small">
								{item.text ?? (item as unknown as string)}
							</PText>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

function ScriptView({
	shortsScript,
	scenes,
}: {
	shortsScript: string;
	scenes: Scene[];
}) {
	return (
		<div className="flex flex-col gap-static-md">
			{shortsScript && (
				<div className="bg-surface rounded-[8px] p-static-lg">
					<div className="flex items-center gap-static-sm mb-static-sm">
						<PHeading size="small" tag="h3">
							쇼츠 스크립트
						</PHeading>
						<PTag color="notification-info-soft">9:16</PTag>
					</div>
					<pre className="whitespace-pre-wrap text-[14px] leading-relaxed font-[inherit]">
						{shortsScript}
					</pre>
				</div>
			)}

			{scenes.length > 0 && (
				<div className="bg-surface rounded-[8px] p-static-lg">
					<div className="flex items-center gap-static-sm mb-static-md">
						<PHeading size="small" tag="h3">
							롱폼 스크립트
						</PHeading>
						<PTag color="notification-info-soft">16:9</PTag>
						<PText size="x-small" color="contrast-medium">
							{scenes.length}개 씬 / 총{" "}
							{Math.round(
								scenes.reduce((s, sc) => s + Number(sc.duration_seconds), 0),
							)}
							초
						</PText>
					</div>
					<div className="flex flex-col gap-static-sm">
						{scenes.map((scene, i) => (
							<div
								key={scene.id}
								className="border-l-2 border-contrast-low pl-static-md py-static-xs"
							>
								<div className="flex items-center gap-static-xs mb-static-xs">
									<PText weight="semi-bold" size="x-small">
										씬 {i + 1}
									</PText>
									<PText size="x-small" color="contrast-medium">
										{Number(scene.duration_seconds)}초
									</PText>
								</div>
								<PText size="small">{scene.narration_text}</PText>
							</div>
						))}
					</div>
				</div>
			)}

			{!shortsScript && scenes.length === 0 && (
				<div className="bg-surface rounded-[8px] p-fluid-lg text-center">
					<PText color="contrast-medium">
						스크립트가 아직 생성되지 않았습니다.
					</PText>
				</div>
			)}
		</div>
	);
}
