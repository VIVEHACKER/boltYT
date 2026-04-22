import {
	PButton,
	PDivider,
	PHeading,
	PTag,
	PText,
} from "@porsche-design-system/components-react";
import { Player } from "@remotion/player";
import { useNavigate } from "react-router-dom";
import { DEMO_SCENES, getDemoRemotionScenes } from "../../lib/demo-data";
import {
	calculateTotalFrames,
	VideoComposition,
} from "../../remotion/Composition";
import { VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH } from "../../remotion/types";

interface DemoPreviewProps {
	onBack: () => void;
}

export default function DemoPreview({ onBack }: DemoPreviewProps) {
	const navigate = useNavigate();
	const remotionScenes = getDemoRemotionScenes();
	const totalFrames = calculateTotalFrames(remotionScenes);
	const totalDuration = DEMO_SCENES.reduce(
		(sum, s) => sum + s.audio_duration,
		0,
	);

	return (
		<div className="bg-surface rounded-[8px] p-static-lg">
			<div className="flex items-center gap-static-sm mb-static-sm">
				<PHeading size="medium" tag="h2">
					5단계: 미리보기 / 승인
				</PHeading>
				<PTag color="notification-warning-soft">데모 모드</PTag>
			</div>
			<PText size="small" color="contrast-medium" className="mb-static-lg">
				Remotion Player로 영상을 미리보기합니다. (데모 데이터)
			</PText>

			<div className="grid grid-cols-1 md:grid-cols-3 gap-static-sm mb-static-lg">
				<div className="bg-canvas rounded-[4px] p-static-sm text-center">
					<PText size="x-small" color="contrast-medium">
						씬 수
					</PText>
					<PText weight="semi-bold">{DEMO_SCENES.length}</PText>
				</div>
				<div className="bg-canvas rounded-[4px] p-static-sm text-center">
					<PText size="x-small" color="contrast-medium">
						총 길이
					</PText>
					<PText weight="semi-bold">
						{Math.floor(totalDuration / 60)}:
						{String(Math.round(totalDuration % 60)).padStart(2, "0")}
					</PText>
				</div>
				<div className="bg-canvas rounded-[4px] p-static-sm text-center">
					<PText size="x-small" color="contrast-medium">
						해상도
					</PText>
					<PText weight="semi-bold">1920×1080</PText>
				</div>
			</div>

			{/* Remotion Player */}
			<div className="mb-static-lg rounded-[8px] overflow-hidden bg-[#000]">
				<Player
					component={VideoComposition}
					inputProps={{ scenes: remotionScenes }}
					durationInFrames={totalFrames}
					fps={VIDEO_FPS}
					compositionWidth={VIDEO_WIDTH}
					compositionHeight={VIDEO_HEIGHT}
					style={{ width: "100%" }}
					controls
					autoPlay={false}
				/>
			</div>

			{/* Scene list */}
			<PHeading size="small" tag="h3" className="mb-static-md">
				씬 구성
			</PHeading>
			<div className="flex flex-col gap-static-sm mb-static-lg">
				{DEMO_SCENES.map((scene, i) => (
					<div
						key={scene.id}
						className="bg-canvas rounded-[4px] p-static-md flex items-start gap-static-md"
					>
						<div className="w-8 h-8 rounded-full bg-surface flex items-center justify-center text-[12px] font-semibold shrink-0">
							{i + 1}
						</div>
						<div className="flex-1 min-w-0">
							<PText size="small">{scene.narration_text}</PText>
							<div className="flex items-center gap-static-xs mt-static-xs">
								<PTag
									color={
										scene.scene_type === "text_emphasis"
											? "notification-warning-soft"
											: "background-surface"
									}
								>
									{scene.scene_type === "text_emphasis"
										? "텍스트 강조"
										: "이미지"}
								</PTag>
								<PText size="x-small" color="contrast-medium">
									{scene.audio_duration}초
								</PText>
							</div>
						</div>
					</div>
				))}
			</div>

			<PDivider className="my-static-lg" />

			<div className="flex justify-between">
				<PButton variant="secondary" onClick={onBack}>
					이전
				</PButton>
				<PButton onClick={() => navigate("/dashboard")}>대시보드로</PButton>
			</div>
		</div>
	);
}
