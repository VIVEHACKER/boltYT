import {
	PButton,
	PHeading,
	PInlineNotification,
	PInputText,
	PSelect,
	PSelectOption,
	PSpinner,
	PTag,
	PText,
	PTextarea,
} from "@porsche-design-system/components-react";
import { ArrowLeft, Save, Trash2, Tv } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
	deleteReferenceTemplate,
	getReferenceTemplate,
	updateReferenceTemplate,
} from "../../lib/reference-import";
import {
	formatReferenceOutputFormats,
	getReferenceTemplateMethodDescription,
	getReferenceTemplateMethodLabel,
	getReferenceTemplateMethodRules,
	getReferenceTemplateRecommendedMode,
	isBuiltInReference,
} from "../../lib/reference-template-presets";
import type { ReferenceTemplate } from "../../types/database";

const VISUAL_MOODS: ReferenceTemplate["visual_mood"][] = [
	"horror",
	"mystery",
	"news",
	"neutral",
	"warm",
];
const SUBTITLE_POSITIONS: ReferenceTemplate["subtitle_position"][] = [
	"top",
	"center",
	"bottom",
	"dynamic",
];
const SUBTITLE_SIZES: ReferenceTemplate["subtitle_size_preset"][] = [
	"xs",
	"sm",
	"md",
	"lg",
	"xl",
];
const SUBTITLE_BG_STYLES: ReferenceTemplate["subtitle_bg_style"][] = [
	"none",
	"pill",
	"block",
	"stroke",
	"glow",
];
const TRANSITION_STYLES: ReferenceTemplate["transition_style"][] = [
	"hardcut",
	"crossfade",
	"zoom",
	"mixed",
];
const PACINGS: ReferenceTemplate["pacing_preset"][] = [
	"fast",
	"medium",
	"slow",
];
const BGM_TEMPOS: ReferenceTemplate["bgm_tempo"][] = ["slow", "mid", "fast"];
const HOOK_PATTERNS: ReferenceTemplate["hook_pattern"][] = [
	"question",
	"shock",
	"claim",
	"story",
	"",
];
const LIGHTING_STYLES: ReferenceTemplate["lighting_style"][] = [
	"dark",
	"natural",
	"bright",
	"mixed",
];

export default function ReferenceDetailPage() {
	const { id = "" } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const [template, setTemplate] = useState<ReferenceTemplate | null>(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);

	useEffect(() => {
		if (!id) return;
		setLoading(true);
		getReferenceTemplate(id)
			.then((t) => {
				setTemplate(t);
				if (!t) setError("템플릿을 찾을 수 없습니다.");
			})
			.catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"))
			.finally(() => setLoading(false));
	}, [id]);

	function update<K extends keyof ReferenceTemplate>(
		field: K,
		value: ReferenceTemplate[K],
	) {
		setTemplate((prev) => (prev ? { ...prev, [field]: value } : prev));
	}

	async function handleSave() {
		if (!template) return;
		setSaving(true);
		setError(null);
		setMessage(null);
		try {
			await updateReferenceTemplate(template.id, {
				name: template.name,
				visual_mood: template.visual_mood,
				visual_prompt_template: template.visual_prompt_template,
				lighting_style: template.lighting_style,
				subtitle_position: template.subtitle_position,
				subtitle_size_preset: template.subtitle_size_preset,
				subtitle_bg_style: template.subtitle_bg_style,
				subtitle_accent_color: template.subtitle_accent_color,
				scene_count: template.scene_count,
				avg_scene_duration: template.avg_scene_duration,
				hook_duration: template.hook_duration,
				transition_style: template.transition_style,
				pacing_preset: template.pacing_preset,
				tts_voice_id: template.tts_voice_id,
				tts_speed: template.tts_speed,
				tts_tone_keywords: template.tts_tone_keywords,
				bgm_mood: template.bgm_mood,
				bgm_keywords: template.bgm_keywords,
				bgm_tempo: template.bgm_tempo,
				hook_pattern: template.hook_pattern,
			});
			setMessage("저장되었습니다.");
		} catch (e) {
			setError(e instanceof Error ? e.message : "저장 실패");
		} finally {
			setSaving(false);
		}
	}

	async function handleDelete() {
		if (!template) return;
		if (!confirm(`"${template.name}"을(를) 삭제할까요?`)) return;
		try {
			await deleteReferenceTemplate(template.id);
			navigate("/references");
		} catch (e) {
			setError(e instanceof Error ? e.message : "삭제 실패");
		}
	}

	function contentUrlFor(target: ReferenceTemplate) {
		const params = new URLSearchParams({
			template: target.id,
			mode: getReferenceTemplateRecommendedMode(target),
		});
		if (!isBuiltInReference(target) && target.channel_id) {
			params.set("channel", target.channel_id);
		}
		return `/content/new?${params.toString()}`;
	}

	if (loading) {
		return (
			<div className="flex items-center justify-center h-64">
				<PSpinner size="medium" />
			</div>
		);
	}

	if (!template) {
		return (
			<div className="max-w-3xl">
				<PInlineNotification
					state="error"
					heading="찾을 수 없음"
					description={error ?? ""}
					dismissButton={false}
				/>
			</div>
		);
	}

	const builtIn = isBuiltInReference(template);
	const methodLabel = getReferenceTemplateMethodLabel(template);
	const methodDescription = getReferenceTemplateMethodDescription(template);
	const methodRules = getReferenceTemplateMethodRules(template);

	return (
		<div className="max-w-4xl space-y-6">
			<button
				type="button"
				onClick={() => navigate("/references")}
				className="flex items-center gap-2 text-sm opacity-60 hover:opacity-100"
			>
				<ArrowLeft size={14} /> 목록
			</button>

			<div className="flex items-start justify-between gap-6">
				<div className="flex-1">
					<PHeading tag="h1" size="large">
						{template.name || template.source_title}
					</PHeading>
					<div className="flex items-center gap-2 mt-2">
						{template.source_type === "youtube" && (
							<Tv size={14} className="text-red-500" />
						)}
						{template.source_creator && (
							<PText size="small" color="neutral-contrast-medium">
								{template.source_creator}
							</PText>
						)}
						{template.source_url && !builtIn && (
							<a
								href={template.source_url}
								target="_blank"
								rel="noopener noreferrer"
								className="text-xs opacity-60 hover:opacity-100 underline"
							>
								원본 영상
							</a>
						)}
					</div>
				</div>
				{template.thumbnail_url && (
					<img
						src={template.thumbnail_url}
						alt=""
						className="w-40 h-24 object-cover rounded-lg border border-[#2a2a2a]"
					/>
				)}
			</div>

			{message && (
				<PInlineNotification
					state="success"
					heading="저장 완료"
					description={message}
					onDismiss={() => setMessage(null)}
				/>
			)}
			{error && (
				<PInlineNotification
					state="error"
					heading="오류"
					description={error}
					onDismiss={() => setError(null)}
				/>
			)}
			{builtIn && (
				<PInlineNotification
					state="info"
					heading="내장 제작 방식"
					description="삭제/수정하지 않고 그대로 재사용하는 템플릿입니다. 아래 버튼으로 내용만 바꿔 새 콘텐츠를 만들 수 있습니다."
					dismissButton={false}
				/>
			)}
			{methodLabel && (
				<Section title="제작 방식">
					<div>
							<PTag color="background-base">{methodLabel}</PTag>
							<PTag color="background-base">
								{formatReferenceOutputFormats(template)}
							</PTag>
							{methodDescription && (
							<PText
								size="small"
								color="neutral-contrast-medium"
								className="mt-3"
							>
								{methodDescription}
							</PText>
						)}
					</div>
					{methodRules.length > 0 && (
						<div className="space-y-2">
							{methodRules.map((rule) => (
								<PText key={rule} size="small" color="neutral-contrast-medium">
									- {rule}
								</PText>
							))}
						</div>
					)}
				</Section>
			)}

			{/* 기본 */}
			<Section title="기본">
				<PInputText
					name="name"
					label="별칭"
					value={template.name}
					onInput={(e) => update("name", (e.target as HTMLInputElement).value)}
				/>
			</Section>

			{/* 시각 */}
			<Section title="시각 스타일">
				<div className="grid grid-cols-2 gap-4">
					<PSelect
						name="visual_mood"
						label="무드"
						value={template.visual_mood}
						onUpdate={(e) =>
							update(
								"visual_mood",
								String(
									e.detail.value ?? "neutral",
								) as ReferenceTemplate["visual_mood"],
							)
						}
					>
						{VISUAL_MOODS.map((m) => (
							<PSelectOption key={m} value={m}>
								{m}
							</PSelectOption>
						))}
					</PSelect>

					<PSelect
						name="lighting"
						label="조명"
						value={template.lighting_style}
						onUpdate={(e) =>
							update(
								"lighting_style",
								String(
									e.detail.value ?? "natural",
								) as ReferenceTemplate["lighting_style"],
							)
						}
					>
						{LIGHTING_STYLES.map((l) => (
							<PSelectOption key={l} value={l}>
								{l}
							</PSelectOption>
						))}
					</PSelect>
				</div>

				<PTextarea
					name="visual_prompt"
					label="이미지 생성 프롬프트 템플릿"
					description="AI가 이 영상 느낌으로 이미지를 만들 때 쓸 영문 프롬프트"
					value={template.visual_prompt_template}
					onInput={(e) =>
						update(
							"visual_prompt_template",
							(e.target as HTMLTextAreaElement).value,
						)
					}
					rows={3}
				/>

				{template.dominant_colors.length > 0 && (
					<div>
						<PText size="small" color="neutral-contrast-medium">
							도미넌트 컬러
						</PText>
						<div className="flex gap-2 mt-2">
							{template.dominant_colors.map((c) => (
								<div
									key={c}
									className="flex items-center gap-2 px-2 py-1 bg-[#1a1a1a] rounded border border-[#2a2a2a]"
								>
									<div
										className="w-6 h-6 rounded"
										style={{ backgroundColor: c }}
									/>
									<span className="text-xs font-mono">{c}</span>
								</div>
							))}
						</div>
					</div>
				)}
			</Section>

			{/* 레이아웃 */}
			<Section title="자막 레이아웃">
				<div className="grid grid-cols-2 gap-4">
					<PSelect
						name="subtitle_position"
						label="위치"
						value={template.subtitle_position}
						onUpdate={(e) =>
							update(
								"subtitle_position",
								String(
									e.detail.value ?? "bottom",
								) as ReferenceTemplate["subtitle_position"],
							)
						}
					>
						{SUBTITLE_POSITIONS.map((p) => (
							<PSelectOption key={p} value={p}>
								{p}
							</PSelectOption>
						))}
					</PSelect>

					<PSelect
						name="subtitle_size"
						label="크기"
						value={template.subtitle_size_preset}
						onUpdate={(e) =>
							update(
								"subtitle_size_preset",
								String(
									e.detail.value ?? "lg",
								) as ReferenceTemplate["subtitle_size_preset"],
							)
						}
					>
						{SUBTITLE_SIZES.map((s) => (
							<PSelectOption key={s} value={s}>
								{s}
							</PSelectOption>
						))}
					</PSelect>

					<PSelect
						name="subtitle_bg"
						label="배경 스타일"
						value={template.subtitle_bg_style}
						onUpdate={(e) =>
							update(
								"subtitle_bg_style",
								String(
									e.detail.value ?? "pill",
								) as ReferenceTemplate["subtitle_bg_style"],
							)
						}
					>
						{SUBTITLE_BG_STYLES.map((s) => (
							<PSelectOption key={s} value={s}>
								{s}
							</PSelectOption>
						))}
					</PSelect>

					<PInputText
						name="accent_color"
						label="강조 색상 (hex)"
						value={template.subtitle_accent_color}
						onInput={(e) =>
							update(
								"subtitle_accent_color",
								(e.target as HTMLInputElement).value,
							)
						}
					/>
				</div>
			</Section>

			{/* 페이싱 */}
			<Section title="페이싱 / 훅">
				<div className="grid grid-cols-3 gap-4">
					<PInputText
						name="scene_count"
						label="씬 수"
						value={String(template.scene_count)}
						onInput={(e) =>
							update(
								"scene_count",
								Number((e.target as HTMLInputElement).value) || 0,
							)
						}
					/>
					<PInputText
						name="avg_duration"
						label="평균 씬 길이 (초)"
						value={String(template.avg_scene_duration)}
						onInput={(e) =>
							update(
								"avg_scene_duration",
								Number((e.target as HTMLInputElement).value) || 0,
							)
						}
					/>
					<PInputText
						name="hook_duration"
						label="훅 길이 (초)"
						value={String(template.hook_duration)}
						onInput={(e) =>
							update(
								"hook_duration",
								Number((e.target as HTMLInputElement).value) || 0,
							)
						}
					/>
				</div>
				<div className="grid grid-cols-3 gap-4 mt-4">
					<PSelect
						name="transition"
						label="전환 스타일"
						value={template.transition_style}
						onUpdate={(e) =>
							update(
								"transition_style",
								String(
									e.detail.value ?? "mixed",
								) as ReferenceTemplate["transition_style"],
							)
						}
					>
						{TRANSITION_STYLES.map((t) => (
							<PSelectOption key={t} value={t}>
								{t}
							</PSelectOption>
						))}
					</PSelect>

					<PSelect
						name="pacing"
						label="페이싱"
						value={template.pacing_preset}
						onUpdate={(e) =>
							update(
								"pacing_preset",
								String(
									e.detail.value ?? "medium",
								) as ReferenceTemplate["pacing_preset"],
							)
						}
					>
						{PACINGS.map((p) => (
							<PSelectOption key={p} value={p}>
								{p}
							</PSelectOption>
						))}
					</PSelect>

					<PSelect
						name="hook_pattern"
						label="훅 패턴"
						value={template.hook_pattern}
						onUpdate={(e) =>
							update(
								"hook_pattern",
								String(
									e.detail.value ?? "",
								) as ReferenceTemplate["hook_pattern"],
							)
						}
					>
						{HOOK_PATTERNS.map((h) => (
							<PSelectOption key={h || "_empty"} value={h}>
								{h || "(없음)"}
							</PSelectOption>
						))}
					</PSelect>
				</div>
			</Section>

			{/* 음성 */}
			<Section title="음성 (TTS)">
				<div className="grid grid-cols-3 gap-4">
					<PInputText
						name="tts_voice"
						label="Voice ID (선택)"
						description="OpenAI: alloy/nova/echo 등"
						value={template.tts_voice_id}
						onInput={(e) =>
							update("tts_voice_id", (e.target as HTMLInputElement).value)
						}
					/>
					<PInputText
						name="tts_speed"
						label="속도"
						value={String(template.tts_speed)}
						onInput={(e) =>
							update(
								"tts_speed",
								Number((e.target as HTMLInputElement).value) || 1.0,
							)
						}
					/>
					<PInputText
						name="tts_tone"
						label="톤 키워드 (쉼표 구분)"
						value={template.tts_tone_keywords.join(", ")}
						onInput={(e) =>
							update(
								"tts_tone_keywords",
								(e.target as HTMLInputElement).value
									.split(",")
									.map((s) => s.trim())
									.filter(Boolean),
							)
						}
					/>
				</div>
			</Section>

			{/* BGM */}
			<Section title="BGM">
				<div className="grid grid-cols-3 gap-4">
					<PInputText
						name="bgm_mood"
						label="무드"
						value={template.bgm_mood}
						onInput={(e) =>
							update("bgm_mood", (e.target as HTMLInputElement).value)
						}
					/>
					<PInputText
						name="bgm_keywords"
						label="검색 키워드 (쉼표)"
						value={template.bgm_keywords.join(", ")}
						onInput={(e) =>
							update(
								"bgm_keywords",
								(e.target as HTMLInputElement).value
									.split(",")
									.map((s) => s.trim())
									.filter(Boolean),
							)
						}
					/>
					<PSelect
						name="bgm_tempo"
						label="템포"
						value={template.bgm_tempo}
						onUpdate={(e) =>
							update(
								"bgm_tempo",
								String(
									e.detail.value ?? "mid",
								) as ReferenceTemplate["bgm_tempo"],
							)
						}
					>
						{BGM_TEMPOS.map((t) => (
							<PSelectOption key={t} value={t}>
								{t}
							</PSelectOption>
						))}
					</PSelect>
				</div>
			</Section>

			{template.transcript && (
				<Section title="전사 스크립트">
					<PText size="small" className="opacity-80 whitespace-pre-wrap">
						{template.transcript}
					</PText>
				</Section>
			)}

			{template.script_structure.length > 0 && (
				<Section title="씬 구조 (레퍼런스)">
					<div className="space-y-2">
						{template.script_structure.map((row, i) => (
							<div
								key={`${row.role}-${i}`}
								className="flex items-center gap-3 text-sm"
							>
								<PTag color="background-base">{row.role}</PTag>
								<span className="opacity-60">{row.duration}초</span>
								<span className="opacity-80">{row.note}</span>
							</div>
						))}
					</div>
				</Section>
			)}

			<div className="flex justify-between pt-4 border-t border-[#2a2a2a]">
				{builtIn ? (
					<div />
				) : (
					<PButton
						variant="secondary"
						icon="delete"
						onClick={handleDelete}
						aria-label="삭제"
					>
						<Trash2 size={14} className="mr-1 inline" /> 삭제
					</PButton>
				)}
				<div className="flex gap-2">
					<PButton
						variant="secondary"
						onClick={() => navigate(contentUrlFor(template))}
					>
						이 템플릿으로 콘텐츠 만들기
					</PButton>
					{!builtIn && (
						<PButton onClick={handleSave} loading={saving}>
							<Save size={14} className="mr-1 inline" /> 저장
						</PButton>
					)}
				</div>
			</div>
		</div>
	);
}

function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div className="bg-[#141414] p-6 rounded-lg border border-[#2a2a2a] space-y-4">
			<PHeading tag="h3" size="small">
				{title}
			</PHeading>
			{children}
		</div>
	);
}
