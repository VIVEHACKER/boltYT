import {
	PButton,
	PHeading,
	PInlineNotification,
	PInputText,
	PSelect,
	PSelectOption,
	PSpinner,
	PTabs,
	PTabsItem,
	PText,
	PTextarea,
} from "@porsche-design-system/components-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { Channel, StyleBible } from "../types/database";

export default function StyleBiblePage() {
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const channelParam = searchParams.get("channel");

	const [channels, setChannels] = useState<Channel[]>([]);
	const [selectedChannelId, setSelectedChannelId] = useState(
		channelParam ?? "",
	);
	const [styleBible, setStyleBible] = useState<Partial<StyleBible>>({});
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState("");

	const loadStyleBible = useCallback(async (channelId: string) => {
		const { data } = await supabase
			.from("style_bibles")
			.select("*")
			.eq("channel_id", channelId)
			.maybeSingle();

		setStyleBible((data as Partial<StyleBible>) ?? { channel_id: channelId });
	}, []);

	useEffect(() => {
		supabase
			.from("channels")
			.select("*")
			.order("name")
			.then(({ data }) => {
				const list = (
					Array.isArray(data) ? data : data ? [data] : []
				) as Channel[];
				setChannels(list);
				if (!selectedChannelId && list.length > 0) {
					setSelectedChannelId(list[0].id);
				}
				setLoading(false);
			});
		// 채널 목록은 마운트 시 1회만 로드; selectedChannelId는 초기 기본값 선택용
	}, [selectedChannelId]);

	useEffect(() => {
		if (!selectedChannelId) return;
		// eslint-disable-next-line react-hooks/set-state-in-effect
		void loadStyleBible(selectedChannelId);
	}, [selectedChannelId, loadStyleBible]);

	function update(field: string, value: unknown) {
		setStyleBible((prev) => ({ ...prev, [field]: value }));
	}

	async function handleSave() {
		setSaving(true);
		setMessage("");

		const payload = {
			channel_id: selectedChannelId,
			character_name: styleBible.character_name ?? "",
			appearance_description: styleBible.appearance_description ?? "",
			outfit_rules: styleBible.outfit_rules ?? "",
			background_rules: styleBible.background_rules ?? "",
			color_palette: styleBible.color_palette ?? [],
			subtitle_font: styleBible.subtitle_font ?? "default",
			subtitle_placement: styleBible.subtitle_placement ?? "bottom",
			cut_duration_rules: styleBible.cut_duration_rules ?? "",
			tts_voice_id: styleBible.tts_voice_id ?? "",
			tts_speed: styleBible.tts_speed ?? 1.0,
			tts_tone: styleBible.tts_tone ?? "",
			thumbnail_style: styleBible.thumbnail_style ?? "",
			intro_template: styleBible.intro_template ?? "",
			outro_template: styleBible.outro_template ?? "",
			updated_at: new Date().toISOString(),
		};

		if (styleBible.id) {
			const { error } = await supabase
				.from("style_bibles")
				.update(payload)
				.eq("id", styleBible.id);
			if (error) {
				setMessage(error.message);
			} else {
				setMessage("저장되었습니다.");
			}
		} else {
			const { error, data } = await supabase
				.from("style_bibles")
				.insert(payload)
				.select()
				.maybeSingle();
			if (error) {
				setMessage(error.message);
			} else {
				const row = Array.isArray(data) ? data[0] : data;
				setStyleBible(row ?? styleBible);
				setMessage("저장되었습니다.");
			}
		}

		setSaving(false);
	}

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
					스타일 바이블
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

	return (
		<div className="max-w-3xl">
			<div className="flex items-center justify-between mb-fluid-md">
				<div>
					<PHeading size="x-large" tag="h1">
						스타일 바이블
					</PHeading>
					<PText color="contrast-medium">
						채널의 캐릭터, 비주얼, 음성 스타일을 설정하세요.
					</PText>
				</div>
				<PButton loading={saving} onClick={handleSave}>
					저장
				</PButton>
			</div>

			{message && (
				<PInlineNotification
					state={message.includes("저장") ? "success" : "error"}
					className="mb-static-md"
					dismissButton={false}
				>
					{message}
				</PInlineNotification>
			)}

			<PSelect
				name="channel"
				label="채널 선택"
				value={selectedChannelId}
				onChange={(e) => setSelectedChannelId(e.detail.value)}
				className="mb-fluid-md"
			>
				{channels.map((ch) => (
					<PSelectOption key={ch.id} value={ch.id}>
						{ch.name}
					</PSelectOption>
				))}
			</PSelect>

			<PTabs>
				<PTabsItem label="캐릭터">
					<div className="flex flex-col gap-static-lg pt-static-md">
						<PInputText
							name="characterName"
							label="캐릭터명"
							placeholder="예: AI 나래이터"
							value={styleBible.character_name ?? ""}
							onInput={(e) =>
								update("character_name", (e.target as HTMLInputElement).value)
							}
						/>
						<PTextarea
							name="appearance"
							label="외형 설명"
							placeholder="캐릭터의 외형을 설명하세요"
							value={styleBible.appearance_description ?? ""}
							rows={3}
							onInput={(e) =>
								update(
									"appearance_description",
									(e.target as HTMLTextAreaElement).value,
								)
							}
						/>
						<PTextarea
							name="outfitRules"
							label="의상 규칙"
							placeholder="의상/복장 관련 규칙"
							value={styleBible.outfit_rules ?? ""}
							rows={2}
							onInput={(e) =>
								update("outfit_rules", (e.target as HTMLTextAreaElement).value)
							}
						/>
						<PTextarea
							name="backgroundRules"
							label="배경 규칙"
							placeholder="배경 이미지/영상 관련 규칙"
							value={styleBible.background_rules ?? ""}
							rows={2}
							onInput={(e) =>
								update(
									"background_rules",
									(e.target as HTMLTextAreaElement).value,
								)
							}
						/>
					</div>
				</PTabsItem>

				<PTabsItem label="비주얼">
					<div className="flex flex-col gap-static-lg pt-static-md">
						<PInputText
							name="colorPalette"
							label="색상 팔레트 (쉼표로 구분)"
							placeholder="예: #FF0000, #00FF00, #0000FF"
							value={styleBible.color_palette?.join(", ") ?? ""}
							onInput={(e) =>
								update(
									"color_palette",
									(e.target as HTMLInputElement).value
										.split(",")
										.map((c) => c.trim())
										.filter(Boolean),
								)
							}
						/>
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-static-md">
							<PSelect
								name="subtitleFont"
								label="자막 폰트"
								value={styleBible.subtitle_font ?? "default"}
								onChange={(e) => update("subtitle_font", e.detail.value)}
							>
								<PSelectOption value="default">기본</PSelectOption>
								<PSelectOption value="bold">굵은체</PSelectOption>
								<PSelectOption value="handwriting">손글씨</PSelectOption>
							</PSelect>

							<PSelect
								name="subtitlePlacement"
								label="자막 위치"
								value={styleBible.subtitle_placement ?? "bottom"}
								onChange={(e) => update("subtitle_placement", e.detail.value)}
							>
								<PSelectOption value="top">상단</PSelectOption>
								<PSelectOption value="center">중앙</PSelectOption>
								<PSelectOption value="bottom">하단</PSelectOption>
							</PSelect>
						</div>
						<PInputText
							name="cutDuration"
							label="컷 길이 규칙"
							placeholder="예: 쇼츠 3-5초, 롱폼 5-10초"
							value={styleBible.cut_duration_rules ?? ""}
							onInput={(e) =>
								update(
									"cut_duration_rules",
									(e.target as HTMLInputElement).value,
								)
							}
						/>
						<PTextarea
							name="thumbnailStyle"
							label="썸네일 스타일"
							placeholder="예: 큰 텍스트, 밝은 색상, 인물 클로즈업"
							value={styleBible.thumbnail_style ?? ""}
							rows={2}
							onInput={(e) =>
								update(
									"thumbnail_style",
									(e.target as HTMLTextAreaElement).value,
								)
							}
						/>
					</div>
				</PTabsItem>

				<PTabsItem label="음성">
					<div className="flex flex-col gap-static-lg pt-static-md">
						<PInputText
							name="ttsVoiceId"
							label="TTS 보이스 ID"
							placeholder="예: ko-KR-Standard-A"
							value={styleBible.tts_voice_id ?? ""}
							onInput={(e) =>
								update("tts_voice_id", (e.target as HTMLInputElement).value)
							}
						/>
						<PInputText
							name="ttsSpeed"
							label="TTS 속도 (0.5 ~ 2.0)"
							placeholder="1.0"
							value={String(styleBible.tts_speed ?? 1.0)}
							onInput={(e) =>
								update(
									"tts_speed",
									parseFloat((e.target as HTMLInputElement).value) || 1.0,
								)
							}
						/>
						<PTextarea
							name="ttsTone"
							label="음성 톤 설명"
							placeholder="예: 차분하고 신뢰감 있는 톤, 약간 빠른 속도"
							value={styleBible.tts_tone ?? ""}
							rows={2}
							onInput={(e) =>
								update("tts_tone", (e.target as HTMLTextAreaElement).value)
							}
						/>
					</div>
				</PTabsItem>

				<PTabsItem label="템플릿">
					<div className="flex flex-col gap-static-lg pt-static-md">
						<PTextarea
							name="introTemplate"
							label="인트로 템플릿"
							placeholder="인트로 영상에 대한 설명 또는 스크립트"
							value={styleBible.intro_template ?? ""}
							rows={3}
							onInput={(e) =>
								update(
									"intro_template",
									(e.target as HTMLTextAreaElement).value,
								)
							}
						/>
						<PTextarea
							name="outroTemplate"
							label="아웃트로 템플릿"
							placeholder="아웃트로 영상에 대한 설명 또는 스크립트"
							value={styleBible.outro_template ?? ""}
							rows={3}
							onInput={(e) =>
								update(
									"outro_template",
									(e.target as HTMLTextAreaElement).value,
								)
							}
						/>
					</div>
				</PTabsItem>
			</PTabs>
		</div>
	);
}
