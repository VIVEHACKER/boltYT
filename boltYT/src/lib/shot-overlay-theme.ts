import type { CSSProperties } from "react";
import type { SceneMood } from "../remotion/types";
import type { NewsSurfaceTone } from "./news-surface-theme";
import type { SceneShotOverlay } from "./scene-shot-types";

interface ShotOverlayPalette {
	accent: string;
	accentSoft: string;
	panel: string;
	panelStrong: string;
	border: string;
	text: string;
	muted: string;
}

export interface ShotOverlayTheme {
	container: CSSProperties;
	card: CSSProperties;
	tone: NewsSurfaceTone;
	label?: {
		text: string;
		style: CSSProperties;
	};
	metaRow: CSSProperties;
	date: CSSProperties;
	datePlacement: "meta" | "badge";
	title: CSSProperties;
	source: CSSProperties;
	quoteMark?: {
		text: string;
		style: CSSProperties;
	};
	showDate: boolean;
	showSource: boolean;
	sourcePlacement: "meta" | "footer";
}

const PALETTES: Record<SceneMood, ShotOverlayPalette> = {
	horror: {
		accent: "#a855f7",
		accentSoft: "rgba(168, 85, 247, 0.18)",
		panel: "rgba(9, 5, 16, 0.82)",
		panelStrong: "rgba(18, 8, 28, 0.9)",
		border: "rgba(196, 181, 253, 0.34)",
		text: "#f5f3ff",
		muted: "rgba(233, 213, 255, 0.78)",
	},
	mystery: {
		accent: "#f59e0b",
		accentSoft: "rgba(245, 158, 11, 0.16)",
		panel: "rgba(16, 11, 4, 0.82)",
		panelStrong: "rgba(24, 17, 6, 0.9)",
		border: "rgba(253, 224, 71, 0.34)",
		text: "#fff7db",
		muted: "rgba(255, 238, 194, 0.78)",
	},
	news: {
		accent: "#ef4444",
		accentSoft: "rgba(239, 68, 68, 0.16)",
		panel: "rgba(14, 12, 16, 0.82)",
		panelStrong: "rgba(24, 14, 16, 0.92)",
		border: "rgba(248, 113, 113, 0.34)",
		text: "#fff1f2",
		muted: "rgba(255, 214, 219, 0.8)",
	},
	neutral: {
		accent: "#38bdf8",
		accentSoft: "rgba(56, 189, 248, 0.16)",
		panel: "rgba(8, 12, 18, 0.8)",
		panelStrong: "rgba(9, 14, 24, 0.9)",
		border: "rgba(148, 163, 184, 0.32)",
		text: "#f8fafc",
		muted: "rgba(203, 213, 225, 0.78)",
	},
	warm: {
		accent: "#fb923c",
		accentSoft: "rgba(251, 146, 60, 0.16)",
		panel: "rgba(22, 11, 5, 0.82)",
		panelStrong: "rgba(31, 16, 8, 0.9)",
		border: "rgba(253, 186, 116, 0.34)",
		text: "#fff7ed",
		muted: "rgba(254, 215, 170, 0.78)",
	},
};

const BASE_META: CSSProperties = {
	display: "flex",
	alignItems: "center",
	flexWrap: "wrap",
	gap: 10,
	marginBottom: 10,
};

function createBaseTheme(
	palette: ShotOverlayPalette,
	hookBoost: boolean,
): ShotOverlayTheme {
	return {
		tone: "generic",
		container: {
			justifyContent: "flex-start",
			alignItems: "flex-start",
			padding: "48px 56px",
			pointerEvents: "none",
		},
		card: {
			maxWidth: 640,
			background: palette.panel,
			border: `1px solid ${palette.border}`,
			borderRadius: 18,
			padding: "14px 18px 18px",
			boxShadow: hookBoost
				? `0 22px 64px rgba(0,0,0,0.42), 0 0 0 1px ${palette.accentSoft}`
				: "0 18px 48px rgba(0,0,0,0.35)",
			backdropFilter: "blur(16px)",
		},
		metaRow: {
			...BASE_META,
			color: palette.muted,
		},
		date: {
			fontSize: 13,
			fontWeight: 600,
			color: palette.muted,
			letterSpacing: "0.08em",
			textTransform: "uppercase",
		},
		title: {
			fontSize: 25,
			lineHeight: 1.36,
			fontWeight: 700,
			color: palette.text,
			wordBreak: "keep-all",
		},
		source: {
			fontSize: 15,
			fontWeight: 600,
			color: palette.muted,
		},
		showDate: true,
		datePlacement: "meta",
		showSource: true,
		sourcePlacement: "footer",
	};
}

export function getShotOverlayTheme(params: {
	overlay: SceneShotOverlay;
	mood?: SceneMood;
	hookBoost?: boolean;
	tone?: NewsSurfaceTone;
}): ShotOverlayTheme {
	const {
		overlay,
		mood = "neutral",
		hookBoost = false,
		tone = "generic",
	} = params;
	const palette = PALETTES[mood] ?? PALETTES.neutral;
	const base = {
		...createBaseTheme(palette, hookBoost),
		tone,
	};

	switch (overlay) {
		case "headline":
			return {
				...base,
				label: {
					text: tone === "timeline" ? "TIMELINE" : "BREAKING",
					style: {
						display: "inline-flex",
						alignItems: "center",
						alignSelf: "flex-start",
						padding: "5px 10px",
						marginBottom: 12,
						borderRadius: 999,
						background: palette.accent,
						color: "#ffffff",
						fontSize: 11,
						fontWeight: 800,
						letterSpacing: "0.14em",
						textTransform: "uppercase",
						boxShadow: `0 10px 30px ${palette.accentSoft}`,
					},
				},
				card: {
					...base.card,
					maxWidth: 700,
					background: `linear-gradient(180deg, ${palette.panelStrong} 0%, ${palette.panel} 100%)`,
					borderLeft: `5px solid ${palette.accent}`,
					padding: "16px 20px 20px",
				},
				metaRow: {
					...base.metaRow,
					marginBottom: 12,
				},
				date: {
					...base.date,
					padding: "4px 9px",
					borderRadius: 999,
					background: palette.accentSoft,
					color: palette.text,
				},
				title: {
					...base.title,
					fontSize: 30,
					lineHeight: 1.28,
					fontWeight: 800,
				},
				source: {
					...base.source,
					marginTop: 12,
					fontSize: 16,
					color: palette.text,
					opacity: 0.86,
				},
				sourcePlacement: "footer",
			};
		case "quote":
			return {
				...base,
				container: {
					justifyContent: "center",
					alignItems: "center",
					padding: "0 14%",
					pointerEvents: "none",
				},
				card: {
					maxWidth: "100%",
					background: "rgba(4, 8, 14, 0.44)",
					border: `1px solid ${palette.border}`,
					borderRadius: 28,
					padding: "28px 32px 30px",
					boxShadow: `0 28px 70px rgba(0,0,0,0.42), inset 0 0 0 1px ${palette.accentSoft}`,
					backdropFilter: "blur(20px)",
				},
				title: {
					...base.title,
					fontSize: 40,
					lineHeight: 1.3,
					fontWeight: 800,
					textAlign: "center",
					color: "#ffffff",
					fontStyle: tone === "witness" ? "italic" : "normal",
				},
				label:
					tone === "witness"
						? {
								text: "WITNESS",
								style: {
									display: "inline-flex",
									alignItems: "center",
									alignSelf: "center",
									padding: "5px 10px",
									marginBottom: 12,
									borderRadius: 999,
									background: palette.accentSoft,
									border: `1px solid ${palette.border}`,
									color: palette.text,
									fontSize: 11,
									fontWeight: 800,
									letterSpacing: "0.14em",
									textTransform: "uppercase",
								},
							}
						: undefined,
				source: {
					fontSize: 16,
					fontWeight: 700,
					color: palette.muted,
					letterSpacing: "0.08em",
					textTransform: "uppercase",
					textAlign: "center",
					marginTop: 18,
					fontStyle: tone === "witness" ? "italic" : "normal",
				},
				quoteMark: {
					text: "“",
					style: {
						fontSize: 84,
						lineHeight: 0.8,
						fontWeight: 900,
						color: palette.accent,
						textAlign: "center",
						marginBottom: 10,
						textShadow: `0 8px 28px ${palette.accentSoft}`,
					},
				},
				showDate: false,
				showSource: true,
				sourcePlacement: "footer",
			};
		case "evidence":
			return {
				...base,
				container: {
					justifyContent: "flex-end",
					alignItems: "flex-start",
					padding: "40px 56px 88px",
					pointerEvents: "none",
				},
				card: {
					...base.card,
					maxWidth: 560,
					background: `linear-gradient(180deg, rgba(22, 16, 8, 0.94) 0%, rgba(11, 9, 5, 0.88) 100%)`,
					border: "1px solid rgba(255, 214, 102, 0.36)",
					borderRadius: 14,
					padding: "14px 16px 16px",
					boxShadow:
						"0 18px 46px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,214,102,0.08)",
				},
				label: {
					text: tone === "evidence" ? "EVIDENCE FILE" : "EVIDENCE",
					style: {
						display: "inline-flex",
						alignItems: "center",
						alignSelf: "flex-start",
						padding: "4px 9px",
						marginBottom: 10,
						borderRadius: 6,
						background: "rgba(255, 214, 102, 0.14)",
						border: "1px solid rgba(255, 214, 102, 0.28)",
						color: "#ffe8a3",
						fontSize: 11,
						fontWeight: 800,
						letterSpacing: "0.14em",
						textTransform: "uppercase",
						fontFamily: "'JetBrains Mono', 'Noto Sans KR', monospace",
					},
				},
				metaRow: {
					...BASE_META,
					marginBottom: 12,
				},
				date: {
					fontSize: 12,
					fontWeight: 700,
					color: "#ffe8a3",
					letterSpacing: "0.12em",
					textTransform: "uppercase",
					fontFamily: "'JetBrains Mono', 'Noto Sans KR', monospace",
				},
				title: {
					fontSize: 24,
					lineHeight: 1.42,
					fontWeight: 700,
					color: "#fff4cc",
					wordBreak: "keep-all",
					fontFamily: "'JetBrains Mono', 'Noto Sans KR', monospace",
				},
				source: {
					fontSize: 13,
					fontWeight: 700,
					color: "rgba(255, 232, 163, 0.74)",
					letterSpacing: "0.08em",
					textTransform: "uppercase",
					fontFamily: "'JetBrains Mono', 'Noto Sans KR', monospace",
					marginTop: 12,
				},
				sourcePlacement: "footer",
			};
		case "context":
			return {
				...base,
				container: {
					justifyContent: "flex-end",
					alignItems: "flex-end",
					padding: "40px 44px 92px",
					pointerEvents: "none",
				},
				card: {
					...base.card,
					maxWidth: 440,
					background: "rgba(9, 16, 26, 0.72)",
					border: "1px solid rgba(148, 163, 184, 0.28)",
					borderRadius: 22,
					padding: "16px 18px 18px",
				},
				label: {
					text: tone === "timeline" ? "TIMELINE" : "CONTEXT",
					style: {
						display: "inline-flex",
						alignItems: "center",
						alignSelf: "flex-start",
						padding: "5px 10px",
						marginBottom: 10,
						borderRadius: 999,
						background: "rgba(15, 23, 42, 0.82)",
						border: "1px solid rgba(148, 163, 184, 0.24)",
						color: "#cbd5e1",
						fontSize: 11,
						fontWeight: 800,
						letterSpacing: "0.14em",
						textTransform: "uppercase",
					},
				},
				metaRow: {
					...base.metaRow,
					marginBottom: 8,
				},
				date: {
					...base.date,
					fontSize: 12,
					color: tone === "timeline" ? palette.text : "#cbd5e1",
					padding: tone === "timeline" ? "5px 9px" : undefined,
					borderRadius: tone === "timeline" ? 999 : undefined,
					background: tone === "timeline" ? palette.accentSoft : undefined,
				},
				title: {
					...base.title,
					fontSize: tone === "timeline" ? 20 : 22,
					lineHeight: 1.45,
					fontWeight: 650,
				},
				source: {
					...base.source,
					fontSize: 13,
					color: "rgba(203, 213, 225, 0.68)",
				},
				showSource: false,
				datePlacement: tone === "timeline" ? "badge" : "meta",
				sourcePlacement: "footer",
			};
		default:
			return base;
	}
}
