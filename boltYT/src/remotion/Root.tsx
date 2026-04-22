import { Composition } from "remotion";
import { DEMO_BGM_URL, getDemoRemotionScenes } from "../lib/demo-data";
import {
	type CompositionProps,
	calculateTotalFrames,
	VideoComposition,
} from "./Composition";
import {
	SHORTS_HEIGHT,
	SHORTS_SUBTITLE,
	SHORTS_WIDTH,
	VIDEO_FPS,
	VIDEO_HEIGHT,
	VIDEO_WIDTH,
} from "./types";

const DEMO_SCENES = getDemoRemotionScenes();

export function RemotionRoot() {
	return (
		<>
			{/* 롱폼 16:9 — 연속 나레이션 + 인트로/아웃트로 */}
			<Composition
				id="YouTubeVideo"
				component={VideoComposition}
				durationInFrames={300}
				fps={VIDEO_FPS}
				width={VIDEO_WIDTH}
				height={VIDEO_HEIGHT}
				defaultProps={{
					scenes: DEMO_SCENES,
					// narrationUrl 제거 → 씬별 audioUrl 개별 재생 활성화
					captionStyle: "chunked" as const,
					// intro/outro 제거 → 사진+나레이션만
				}}
				calculateMetadata={({ props }: { props: CompositionProps }) => {
					const frames = calculateTotalFrames(
						props.scenes,
						props.intro,
						props.outro,
					);
					return { durationInFrames: frames > 0 ? frames : 300 };
				}}
			/>

			{/* 숏폼 9:16 */}
			<Composition
				id="YouTubeShorts"
				component={VideoComposition}
				durationInFrames={300}
				fps={VIDEO_FPS}
				width={SHORTS_WIDTH}
				height={SHORTS_HEIGHT}
				defaultProps={{
					scenes: DEMO_SCENES,
					subtitleStyle: SHORTS_SUBTITLE,
					captionStyle: "chunked" as const,
					bgmUrl: DEMO_BGM_URL,
				}}
				calculateMetadata={({ props }: { props: CompositionProps }) => {
					const frames = calculateTotalFrames(props.scenes);
					return { durationInFrames: frames > 0 ? frames : 300 };
				}}
			/>
		</>
	);
}
