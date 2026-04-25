/**
 * KeyboardShortcutsModal — 타임라인 단축키 레퍼런스 모달.
 * '?' 키로 토글.
 */

import { useEffect } from "react";

interface Props {
	open: boolean;
	onClose: () => void;
}

const SECTIONS: Array<{
	title: string;
	shortcuts: Array<{ keys: string[]; description: string }>;
}> = [
	{
		title: "편집",
		shortcuts: [
			{ keys: ["S"], description: "플레이헤드에서 클립 분할" },
			{ keys: ["Del", "⌫"], description: "선택 삭제" },
			{ keys: ["⇧", "Del"], description: "Ripple 삭제" },
			{ keys: ["⌘Z"], description: "실행 취소" },
			{ keys: ["⌘⇧Z"], description: "다시 실행" },
		],
	},
	{
		title: "선택",
		shortcuts: [
			{ keys: ["⌘A"], description: "전체 선택" },
			{ keys: ["Esc"], description: "선택 해제" },
			{ keys: ["⇧←", "⇧→"], description: "선택 ±1 프레임 이동" },
		],
	},
	{
		title: "탐색",
		shortcuts: [
			{ keys: ["←", "→"], description: "플레이헤드 ±1초" },
			{ keys: ["⌥←", "⌥→"], description: "플레이헤드 ±1 프레임" },
		],
	},
	{
		title: "기타",
		shortcuts: [
			{ keys: ["M"], description: "자석 스냅 토글" },
			{ keys: ["1–9"], description: "멀티캠 앵글 전환" },
			{ keys: ["?"], description: "단축키 도움말 열기/닫기" },
		],
	},
];

export function KeyboardShortcutsModal({ open, onClose }: Props) {
	useEffect(() => {
		if (!open) return;
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape" || e.key === "?") {
				e.preventDefault();
				onClose();
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, onClose]);

	if (!open) return null;

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="키보드 단축키"
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 9999,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			{/* backdrop */}
			<button
				type="button"
				aria-label="닫기"
				onClick={onClose}
				style={{
					position: "absolute",
					inset: 0,
					background: "rgba(0,0,0,0.7)",
					border: "none",
					cursor: "default",
				}}
			/>

			{/* panel */}
			<div
				style={{
					position: "relative",
					background: "#111",
					border: "1px solid #2a2a2a",
					borderRadius: 8,
					padding: "20px 24px",
					minWidth: 480,
					maxWidth: 640,
					maxHeight: "80vh",
					overflowY: "auto",
					color: "#e0e0e0",
				}}
			>
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						marginBottom: 16,
					}}
				>
					<span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>
						키보드 단축키
					</span>
					<button
						type="button"
						onClick={onClose}
						aria-label="닫기"
						style={{
							background: "none",
							border: "none",
							color: "rgba(255,255,255,0.4)",
							fontSize: 16,
							cursor: "pointer",
							lineHeight: 1,
						}}
					>
						✕
					</button>
				</div>

				<div
					style={{
						display: "grid",
						gridTemplateColumns: "1fr 1fr",
						gap: "16px 24px",
					}}
				>
					{SECTIONS.map((section) => (
						<div key={section.title}>
							<div
								style={{
									fontSize: 10,
									fontWeight: 700,
									letterSpacing: "0.08em",
									color: "rgba(255,255,255,0.35)",
									textTransform: "uppercase",
									marginBottom: 8,
								}}
							>
								{section.title}
							</div>
							<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
								{section.shortcuts.map((s) => (
									<div
										key={s.description}
										style={{
											display: "flex",
											alignItems: "center",
											justifyContent: "space-between",
											gap: 8,
										}}
									>
										<span
											style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}
										>
											{s.description}
										</span>
										<div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
											{s.keys.map((k) => (
												<kbd
													key={k}
													style={{
														display: "inline-block",
														padding: "1px 6px",
														fontSize: 11,
														fontFamily: "monospace",
														color: "#c8d3f0",
														background: "#1e1e2e",
														border: "1px solid #3a3a4e",
														borderRadius: 4,
														lineHeight: "18px",
													}}
												>
													{k}
												</kbd>
											))}
										</div>
									</div>
								))}
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
