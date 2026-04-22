/**
 * BeatGrid — BPM 기반 수직 격자선.
 * 실측 beats 배열 있으면 그걸 사용, 없으면 BPM으로 균일 분할.
 */

interface Props {
	bpm: number;
	beats: number[];
	zoom: number; // px/frame
	fps: number;
	totalFrames: number;
}

export function BeatGrid({ bpm, beats, zoom, fps, totalFrames }: Props) {
	const gridLines: number[] = []; // 프레임 포지션

	if (beats.length > 0) {
		for (const t of beats) {
			gridLines.push(Math.round(t * fps));
		}
	} else if (bpm > 0) {
		const beatFrames = (60 / bpm) * fps;
		for (let f = 0; f < totalFrames; f += beatFrames) {
			gridLines.push(Math.round(f));
		}
	} else {
		return null; // 비트 정보 없음
	}

	return (
		<div
			style={{
				position: "absolute",
				inset: 0,
				pointerEvents: "none",
				zIndex: 2,
			}}
			aria-hidden="true"
		>
			{gridLines.map((f, i) => {
				const isDownbeat = i % 4 === 0;
				return (
					<div
						key={`beat-${f}`}
						style={{
							position: "absolute",
							left: f * zoom,
							top: 0,
							bottom: 0,
							width: isDownbeat ? 2 : 1,
							background: isDownbeat
								? "rgba(255, 215, 0, 0.35)"
								: "rgba(255, 215, 0, 0.15)",
						}}
					/>
				);
			})}
		</div>
	);
}
