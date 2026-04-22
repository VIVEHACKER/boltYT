/**
 * Ruler — 상단 시간 눈금 (초 단위).
 */

interface Props {
	zoom: number;
	fps: number;
	totalFrames: number;
}

export function Ruler({ zoom, fps, totalFrames }: Props) {
	const totalSec = totalFrames / fps;
	const marks: number[] = [];
	const step = zoom < 1 ? 2 : zoom < 3 ? 1 : 0.5; // 초 단위 스텝

	for (let s = 0; s <= totalSec; s += step) {
		marks.push(s);
	}

	return (
		<div
			style={{
				position: "relative",
				height: 24,
				width: totalFrames * zoom,
				background: "#111",
				borderBottom: "1px solid #333",
				fontSize: 10,
				color: "rgba(255,255,255,0.6)",
				fontFamily: "monospace",
			}}
			aria-hidden="true"
		>
			{marks.map((sec) => {
				const x = sec * fps * zoom;
				const isMajor = sec % 5 === 0;
				return (
					<div
						key={sec}
						style={{
							position: "absolute",
							left: x,
							top: 0,
							height: "100%",
							borderLeft: isMajor
								? "1px solid rgba(255,255,255,0.35)"
								: "1px solid rgba(255,255,255,0.12)",
							paddingLeft: 4,
							paddingTop: 4,
						}}
					>
						{isMajor ? `${Math.round(sec)}s` : ""}
					</div>
				);
			})}
		</div>
	);
}
