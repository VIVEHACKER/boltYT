import { PTag, PText } from "@porsche-design-system/components-react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface SceneData {
	id: string;
	narration_text: string;
	scene_type: string;
	duration_seconds: number;
	order_index: number;
	imageUrl?: string;
	news_title?: string;
	news_source?: string;
	news_excerpt?: string;
	news_date?: string;
}

interface ScenePlayerProps {
	scenes: SceneData[];
}

export default function ScenePlayer({ scenes }: ScenePlayerProps) {
	const [currentIndex, setCurrentIndex] = useState(0);
	const [playing, setPlaying] = useState(false);
	const [elapsed, setElapsed] = useState(0);
	const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const currentScene = scenes[currentIndex];
	const duration = Number(currentScene?.duration_seconds ?? 5);

	const totalDuration = scenes.reduce(
		(s, sc) => s + Number(sc.duration_seconds),
		0,
	);
	const elapsedBefore = scenes
		.slice(0, currentIndex)
		.reduce((s, sc) => s + Number(sc.duration_seconds), 0);
	const globalElapsed = elapsedBefore + elapsed;

	const goToScene = useCallback(
		(index: number) => {
			if (index < 0 || index >= scenes.length) {
				setPlaying(false);
				setCurrentIndex(scenes.length - 1);
				setElapsed(Number(scenes[scenes.length - 1]?.duration_seconds ?? 0));
				return;
			}
			setCurrentIndex(index);
			setElapsed(0);
		},
		[scenes],
	);

	useEffect(() => {
		if (timerRef.current) clearInterval(timerRef.current);
		if (!playing) return;

		timerRef.current = setInterval(() => {
			setElapsed((prev) => {
				const next = prev + 0.1;
				if (next >= duration) {
					goToScene(currentIndex + 1);
					return 0;
				}
				return next;
			});
		}, 100);

		return () => {
			if (timerRef.current) clearInterval(timerRef.current);
		};
	}, [playing, currentIndex, duration, goToScene]);

	function togglePlay() {
		if (!playing && currentIndex === scenes.length - 1 && elapsed >= duration) {
			setCurrentIndex(0);
			setElapsed(0);
		}
		setPlaying(!playing);
	}

	function formatTime(seconds: number) {
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${String(s).padStart(2, "0")}`;
	}

	if (scenes.length === 0) {
		return (
			<div className="bg-canvas rounded-[8px] aspect-video flex items-center justify-center">
				<PText color="contrast-medium">씬 데이터가 없습니다.</PText>
			</div>
		);
	}

	const progress =
		totalDuration > 0 ? (globalElapsed / totalDuration) * 100 : 0;

	return (
		<div className="rounded-[8px] overflow-hidden bg-[#000]">
			<div className="relative aspect-video">
				{currentScene?.imageUrl ? (
					<img
						src={currentScene.imageUrl}
						alt={`씬 ${currentIndex + 1}`}
						className={`w-full h-full object-cover ${currentScene?.scene_type === "news_overlay" ? "brightness-[0.4]" : ""}`}
					/>
				) : (
					<div
						className="w-full h-full flex items-center justify-center"
						style={{
							background:
								currentScene?.scene_type === "news_overlay"
									? "linear-gradient(135deg, #0d1117 0%, #161b22 50%, #1a1f2e 100%)"
									: "#1a1a1a",
						}}
					>
						{currentScene?.scene_type !== "news_overlay" && (
							<div className="text-center">
								<PText color="contrast-medium" size="large">
									씬 {currentIndex + 1}
								</PText>
								<PText size="x-small" color="contrast-medium">
									{currentScene?.scene_type}
								</PText>
							</div>
						)}
					</div>
				)}

				{/* 뉴스 오버레이 카드 */}
				{currentScene?.scene_type === "news_overlay" && (
					<div className="absolute inset-0 flex items-center justify-center p-8">
						<div className="bg-[rgba(255,255,255,0.95)] rounded-[12px] p-6 max-w-[80%] w-full shadow-lg border-l-4 border-[#e63946]">
							{(currentScene.news_source || currentScene.news_date) && (
								<div className="flex items-center gap-2 mb-2">
									{currentScene.news_source && (
										<span className="text-[11px] font-semibold text-[#e63946] uppercase tracking-wider">
											{currentScene.news_source}
										</span>
									)}
									{currentScene.news_date && (
										<span className="text-[10px] text-[#6b7280]">
											{currentScene.news_date}
										</span>
									)}
								</div>
							)}
							{currentScene.news_title && (
								<p className="text-[18px] font-bold text-[#111827] leading-tight m-0 mb-1">
									{currentScene.news_title}
								</p>
							)}
							{currentScene.news_excerpt && (
								<p className="text-[12px] text-[#4b5563] leading-relaxed m-0">
									{currentScene.news_excerpt}
								</p>
							)}
						</div>
					</div>
				)}

				<div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-[rgba(0,0,0,0.85)] to-transparent p-4 pt-12">
					<div className="flex items-center gap-2 mb-2">
						<PTag
							color={
								currentScene?.scene_type === "news_overlay"
									? "notification-error-soft"
									: currentScene?.scene_type === "video"
										? "notification-info-soft"
										: currentScene?.scene_type === "text_emphasis"
											? "notification-warning-soft"
											: "background-surface"
							}
						>
							씬 {currentIndex + 1}/{scenes.length}
						</PTag>
					</div>
					<p className="text-[#fff] text-[15px] leading-relaxed">
						{currentScene?.narration_text}
					</p>
				</div>
			</div>

			<div className="px-3 pt-1">
				<div
					role="slider"
					tabIndex={0}
					aria-label="영상 진행률"
					aria-valuenow={Math.round(globalElapsed)}
					aria-valuemin={0}
					aria-valuemax={Math.round(totalDuration)}
					className="w-full h-1.5 bg-[#333] rounded-full cursor-pointer relative"
					onKeyDown={(e) => {
						if (e.key === "ArrowRight") goToScene(currentIndex + 1);
						else if (e.key === "ArrowLeft")
							goToScene(currentIndex - 1 >= 0 ? currentIndex - 1 : 0);
					}}
					onClick={(e) => {
						const rect = e.currentTarget.getBoundingClientRect();
						const pct = (e.clientX - rect.left) / rect.width;
						const targetTime = pct * totalDuration;

						let acc = 0;
						for (let i = 0; i < scenes.length; i++) {
							const sceneDur = Number(scenes[i].duration_seconds);
							if (acc + sceneDur > targetTime) {
								setCurrentIndex(i);
								setElapsed(targetTime - acc);
								return;
							}
							acc += sceneDur;
						}
					}}
				>
					<div
						className="h-full bg-[#fff] rounded-full transition-[width] duration-100"
						style={{ width: `${Math.min(progress, 100)}%` }}
					/>
					{scenes.map((sc, i) => {
						const sceneStart = scenes
							.slice(0, i)
							.reduce((s, x) => s + Number(x.duration_seconds), 0);
						const pct = (sceneStart / totalDuration) * 100;
						if (i === 0) return null;
						return (
							<div
								key={sc.id}
								className="absolute top-0 w-[2px] h-full bg-[#555]"
								style={{ left: `${pct}%` }}
							/>
						);
					})}
				</div>
			</div>

			<div className="flex items-center justify-between px-3 py-2">
				<div className="flex items-center gap-1">
					<button
						type="button"
						aria-label="이전 씬"
						className="w-8 h-8 flex items-center justify-center text-[#fff] hover:bg-[#333] rounded-full cursor-pointer bg-transparent border-0"
						onClick={() => {
							goToScene(currentIndex - 1 >= 0 ? currentIndex - 1 : 0);
						}}
					>
						<SkipBack size={16} />
					</button>
					<button
						type="button"
						aria-label={playing ? "일시정지" : "재생"}
						className="w-10 h-10 flex items-center justify-center text-[#fff] hover:bg-[#333] rounded-full cursor-pointer bg-transparent border-0"
						onClick={togglePlay}
					>
						{playing ? <Pause size={20} /> : <Play size={20} />}
					</button>
					<button
						type="button"
						aria-label="다음 씬"
						className="w-8 h-8 flex items-center justify-center text-[#fff] hover:bg-[#333] rounded-full cursor-pointer bg-transparent border-0"
						onClick={() => {
							goToScene(currentIndex + 1);
						}}
					>
						<SkipForward size={16} />
					</button>
				</div>

				<div className="text-[#999] text-[12px]">
					{formatTime(globalElapsed)} / {formatTime(totalDuration)}
				</div>
			</div>
		</div>
	);
}
