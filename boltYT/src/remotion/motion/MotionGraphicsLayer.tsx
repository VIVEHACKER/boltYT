/**
 * MotionGraphicsLayer — 씬의 motionGraphics 스펙 배열을 라우팅 렌더.
 */

import type { MotionGraphicSpec } from "../types";
import { ArrowCallout, type ArrowCalloutParams } from "./ArrowCallout";
import { EmojiBurst, type EmojiBurstParams } from "./EmojiBurst";
import { type LowerThirdParams, LowerThirdV2 } from "./LowerThirdV2";
import { NumberCounter, type NumberCounterParams } from "./NumberCounter";
import { ProgressBar, type ProgressBarParams } from "./ProgressBar";
import { QuoteBubble, type QuoteBubbleParams } from "./QuoteBubble";

interface Props {
	graphics?: MotionGraphicSpec[];
}

export function MotionGraphicsLayer({ graphics }: Props) {
	if (!graphics || graphics.length === 0) return null;

	return (
		<>
			{graphics.map((g, i) => {
				const key = `${g.type}-${g.startFrame}-${i}`;
				switch (g.type) {
					case "number_counter":
						return (
							<NumberCounter
								key={key}
								params={g.params as unknown as NumberCounterParams}
								startFrame={g.startFrame}
								duration={g.duration}
							/>
						);
					case "lower_third":
						return (
							<LowerThirdV2
								key={key}
								params={g.params as unknown as LowerThirdParams}
								startFrame={g.startFrame}
								duration={g.duration}
							/>
						);
					case "progress_bar":
						return (
							<ProgressBar
								key={key}
								params={g.params as unknown as ProgressBarParams}
								startFrame={g.startFrame}
								duration={g.duration}
							/>
						);
					case "arrow_callout":
						return (
							<ArrowCallout
								key={key}
								params={g.params as unknown as ArrowCalloutParams}
								startFrame={g.startFrame}
								duration={g.duration}
							/>
						);
					case "quote_bubble":
						return (
							<QuoteBubble
								key={key}
								params={g.params as unknown as QuoteBubbleParams}
								startFrame={g.startFrame}
								duration={g.duration}
							/>
						);
					case "emoji_burst":
						return (
							<EmojiBurst
								key={key}
								params={g.params as unknown as EmojiBurstParams}
								startFrame={g.startFrame}
								duration={g.duration}
							/>
						);
					default:
						return null;
				}
			})}
		</>
	);
}
