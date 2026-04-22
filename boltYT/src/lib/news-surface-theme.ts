import type { CSSProperties } from "react";
import type { SceneMood } from "../remotion/types";
import type { SceneShotKind } from "./scene-shot-types";

export type NewsSurfaceVariant = "breaking" | "dossier" | "archive";
export type NewsSurfaceTone = "generic" | "witness" | "evidence" | "timeline";

interface SurfacePalette {
	accent: string;
	accentSoft: string;
	panel: string;
	panelStrong: string;
	paper: string;
	paperBorder: string;
	text: string;
	muted: string;
	darkText: string;
	darkMuted: string;
}

export interface NewsCardTheme {
	variant: NewsSurfaceVariant;
	tone: NewsSurfaceTone;
	accentColor: string;
	datePlacement: "meta" | "badge";
	label: {
		text: string;
		style: CSSProperties;
	};
	dateBadge?: CSSProperties;
	card: CSSProperties;
	metaRow: CSSProperties;
	source: CSSProperties;
	date: CSSProperties;
	title: CSSProperties;
	excerpt: CSSProperties;
}

export interface LowerThirdTheme {
	variant: NewsSurfaceVariant;
	tone: NewsSurfaceTone;
	shell: CSSProperties;
	rail: CSSProperties;
	panel: CSSProperties;
	badge: {
		text: string;
		style: CSSProperties;
	};
	source: CSSProperties;
	date: CSSProperties;
	separator: CSSProperties;
}

const PALETTES: Record<SceneMood, SurfacePalette> = {
	horror: {
		accent: "#a855f7",
		accentSoft: "rgba(168, 85, 247, 0.18)",
		panel: "rgba(10, 7, 18, 0.84)",
		panelStrong: "rgba(18, 10, 28, 0.92)",
		paper: "#f7f1ff",
		paperBorder: "rgba(196, 181, 253, 0.4)",
		text: "#f5f3ff",
		muted: "rgba(233, 213, 255, 0.78)",
		darkText: "#241332",
		darkMuted: "#6b4d7c",
	},
	mystery: {
		accent: "#f59e0b",
		accentSoft: "rgba(245, 158, 11, 0.18)",
		panel: "rgba(18, 12, 5, 0.84)",
		panelStrong: "rgba(28, 17, 6, 0.92)",
		paper: "#fff8e8",
		paperBorder: "rgba(253, 224, 71, 0.36)",
		text: "#fff7db",
		muted: "rgba(255, 238, 194, 0.78)",
		darkText: "#34220f",
		darkMuted: "#8b6d36",
	},
	news: {
		accent: "#ef4444",
		accentSoft: "rgba(239, 68, 68, 0.18)",
		panel: "rgba(22, 14, 16, 0.84)",
		panelStrong: "rgba(32, 16, 18, 0.92)",
		paper: "#fff7f7",
		paperBorder: "rgba(248, 113, 113, 0.36)",
		text: "#fff1f2",
		muted: "rgba(255, 214, 219, 0.78)",
		darkText: "#2b1114",
		darkMuted: "#8b4a52",
	},
	neutral: {
		accent: "#38bdf8",
		accentSoft: "rgba(56, 189, 248, 0.18)",
		panel: "rgba(8, 12, 18, 0.82)",
		panelStrong: "rgba(10, 16, 24, 0.9)",
		paper: "#f8fafc",
		paperBorder: "rgba(148, 163, 184, 0.32)",
		text: "#f8fafc",
		muted: "rgba(203, 213, 225, 0.78)",
		darkText: "#17202b",
		darkMuted: "#64748b",
	},
	warm: {
		accent: "#fb923c",
		accentSoft: "rgba(251, 146, 60, 0.18)",
		panel: "rgba(24, 13, 6, 0.82)",
		panelStrong: "rgba(31, 16, 8, 0.9)",
		paper: "#fff8f0",
		paperBorder: "rgba(253, 186, 116, 0.34)",
		text: "#fff7ed",
		muted: "rgba(254, 215, 170, 0.78)",
		darkText: "#2f1e12",
		darkMuted: "#8a5a37",
	},
};

function getVariant(
	mood: SceneMood = "neutral",
	hookBoost = false,
): NewsSurfaceVariant {
	if (hookBoost || mood === "news") return "breaking";
	if (mood === "horror" || mood === "mystery") return "dossier";
	return "archive";
}

export function inferNewsSurfaceTone(params: {
	narration?: string;
	newsTitle?: string;
	newsExcerpt?: string;
	shotKind?: SceneShotKind;
}): NewsSurfaceTone {
	const { narration = "", newsTitle = "", newsExcerpt = "", shotKind } = params;
	const text = `${newsTitle}\n${newsExcerpt}\n${narration}`.toLowerCase();

	if (shotKind === "evidence") return "evidence";
	if (shotKind === "quote") return "witness";
	if (
		shotKind === "context" &&
		/timeline|연표|타임라인|당일|직후|이후|며칠 뒤|순서/u.test(text)
	) {
		return "timeline";
	}

	if (
		/증거|evidence|녹취|메모|cctv|포렌식|기록|문건|통화|편지|clue|record/u.test(
			text,
		)
	) {
		return "evidence";
	}

	if (/목격|증언|진술|제보|witness|statement|interview|testimony/u.test(text)) {
		return "witness";
	}

	if (
		/타임라인|timeline|연표|당일|직후|이후|며칠 뒤|수시간 뒤|순서/u.test(text)
	) {
		return "timeline";
	}

	return "generic";
}

function headlineLabel(tone: NewsSurfaceTone) {
	switch (tone) {
		case "witness":
			return "WITNESS ALERT";
		case "evidence":
			return "EVIDENCE DROP";
		case "timeline":
			return "TIMELINE NOW";
		default:
			return "NEWS FLASH";
	}
}

function dossierLabel(tone: NewsSurfaceTone) {
	switch (tone) {
		case "witness":
			return "WITNESS LOG";
		case "evidence":
			return "EVIDENCE FILE";
		case "timeline":
			return "CASE TIMELINE";
		default:
			return "CASE FILE";
	}
}

function archiveLabel(tone: NewsSurfaceTone) {
	switch (tone) {
		case "witness":
			return "WITNESS NOTE";
		case "evidence":
			return "ARCHIVE EVIDENCE";
		case "timeline":
			return "ARCHIVE TIMELINE";
		default:
			return "ARCHIVE";
	}
}

export function getNewsCardTheme(params: {
	mood?: SceneMood;
	hookBoost?: boolean;
	tone?: NewsSurfaceTone;
}): NewsCardTheme {
	const { mood = "neutral", hookBoost = false, tone = "generic" } = params;
	const palette = PALETTES[mood] ?? PALETTES.neutral;
	const variant = getVariant(mood, hookBoost);

	if (variant === "breaking") {
		return {
			variant,
			tone,
			accentColor: palette.accent,
			datePlacement: tone === "timeline" ? "badge" : "meta",
			label: {
				text: headlineLabel(tone),
				style: {
					display: "inline-flex",
					alignItems: "center",
					alignSelf: "flex-start",
					padding: "6px 12px",
					marginBottom: 14,
					borderRadius: 999,
					background: palette.accent,
					color: "#ffffff",
					fontSize: 11,
					fontWeight: 800,
					letterSpacing: "0.14em",
					textTransform: "uppercase",
					boxShadow: `0 12px 30px ${palette.accentSoft}`,
				},
			},
			card: {
				background: "rgba(255,255,255,0.96)",
				borderRadius: 18,
				padding: "34px 30px 32px",
				maxWidth: "95%",
				width: "100%",
				boxShadow: "0 18px 54px rgba(0,0,0,0.36)",
				borderLeft:
					tone === "evidence"
						? `8px solid ${palette.accent}`
						: `6px solid ${palette.accent}`,
				borderTop: `1px solid ${palette.paperBorder}`,
			},
			dateBadge:
				tone === "timeline"
					? {
							display: "inline-flex",
							alignItems: "center",
							alignSelf: "flex-start",
							padding: "6px 10px",
							marginBottom: 12,
							borderRadius: 999,
							background: "rgba(239, 68, 68, 0.12)",
							border: `1px solid ${palette.paperBorder}`,
							color: palette.accent,
							fontSize: 12,
							fontWeight: 800,
							letterSpacing: "0.1em",
							textTransform: "uppercase",
						}
					: undefined,
			metaRow: {
				display: "flex",
				alignItems: "center",
				flexWrap: "wrap",
				gap: 12,
				marginBottom: 16,
			},
			source: {
				fontSize: 16,
				fontWeight: 800,
				color: palette.accent,
				letterSpacing: "0.08em",
				textTransform: "uppercase",
				fontStyle: tone === "witness" ? "italic" : "normal",
			},
			date: {
				fontSize: 14,
				fontWeight: 700,
				color: palette.darkMuted,
				padding: "5px 10px",
				borderRadius: 999,
				background: "rgba(239, 68, 68, 0.08)",
			},
			title: {
				fontSize: tone === "timeline" ? 36 : 40,
				fontWeight: 850,
				color: palette.darkText,
				lineHeight: 1.24,
				margin: 0,
				fontFamily: "'Noto Sans KR', -apple-system, sans-serif",
				fontStyle: tone === "witness" ? "italic" : "normal",
			},
			excerpt: {
				fontSize: tone === "witness" ? 21 : 22,
				color: palette.darkMuted,
				lineHeight: 1.58,
				margin: 0,
				fontFamily: "'Noto Sans KR', -apple-system, sans-serif",
				fontStyle: tone === "witness" ? "italic" : "normal",
			},
		};
	}

	if (variant === "dossier") {
		return {
			variant,
			tone,
			accentColor: palette.accent,
			datePlacement: tone === "timeline" ? "badge" : "meta",
			label: {
				text: dossierLabel(tone),
				style: {
					display: "inline-flex",
					alignItems: "center",
					alignSelf: "flex-start",
					padding: "5px 10px",
					marginBottom: 12,
					borderRadius: 7,
					background: palette.accentSoft,
					border: `1px solid ${palette.paperBorder}`,
					color: palette.text,
					fontSize: 11,
					fontWeight: 800,
					letterSpacing: "0.16em",
					textTransform: "uppercase",
					fontFamily: "'JetBrains Mono', 'Noto Sans KR', monospace",
				},
			},
			card: {
				background: `linear-gradient(180deg, ${palette.panelStrong} 0%, ${palette.panel} 100%)`,
				borderRadius: 16,
				padding: "30px 28px 28px",
				maxWidth: "95%",
				width: "100%",
				boxShadow: "0 18px 54px rgba(0,0,0,0.42)",
				border: `1px solid ${palette.paperBorder}`,
				outline:
					tone === "evidence" ? `1px solid ${palette.accentSoft}` : "none",
				outlineOffset: tone === "evidence" ? -6 : undefined,
			},
			dateBadge:
				tone === "timeline"
					? {
							display: "inline-flex",
							alignItems: "center",
							alignSelf: "flex-start",
							padding: "5px 9px",
							marginBottom: 10,
							borderRadius: 6,
							background: palette.accentSoft,
							border: `1px solid ${palette.paperBorder}`,
							color: palette.text,
							fontSize: 12,
							fontWeight: 800,
							letterSpacing: "0.12em",
							textTransform: "uppercase",
							fontFamily: "'JetBrains Mono', 'Noto Sans KR', monospace",
						}
					: undefined,
			metaRow: {
				display: "flex",
				alignItems: "center",
				flexWrap: "wrap",
				gap: 10,
				marginBottom: 16,
			},
			source: {
				fontSize: 14,
				fontWeight: 700,
				color: palette.text,
				letterSpacing: "0.12em",
				textTransform: "uppercase",
				fontFamily: "'JetBrains Mono', 'Noto Sans KR', monospace",
			},
			date: {
				fontSize: 13,
				fontWeight: 700,
				color: palette.muted,
				letterSpacing: "0.12em",
				textTransform: "uppercase",
				fontFamily: "'JetBrains Mono', 'Noto Sans KR', monospace",
			},
			title: {
				fontSize: tone === "timeline" ? 35 : 37,
				fontWeight: 800,
				color: palette.text,
				lineHeight: 1.28,
				margin: 0,
				fontFamily: "'Noto Sans KR', -apple-system, sans-serif",
				fontStyle: tone === "witness" ? "italic" : "normal",
			},
			excerpt: {
				fontSize: 21,
				color: palette.muted,
				lineHeight: tone === "timeline" ? 1.54 : 1.62,
				margin: 0,
				fontFamily: "'Noto Sans KR', -apple-system, sans-serif",
			},
		};
	}

	return {
		variant,
		tone,
		accentColor: palette.accent,
		datePlacement: tone === "timeline" ? "badge" : "meta",
		label: {
			text: archiveLabel(tone),
			style: {
				display: "inline-flex",
				alignItems: "center",
				alignSelf: "flex-start",
				padding: "5px 10px",
				marginBottom: 14,
				borderRadius: 999,
				background: "rgba(255,255,255,0.56)",
				border: `1px solid ${palette.paperBorder}`,
				color: palette.darkMuted,
				fontSize: 11,
				fontWeight: 800,
				letterSpacing: "0.14em",
				textTransform: "uppercase",
			},
		},
		card: {
			background: `${palette.paper}`,
			borderRadius: 18,
			padding: "34px 30px 30px",
			maxWidth: "95%",
			width: "100%",
			boxShadow: "0 18px 54px rgba(0,0,0,0.3)",
			borderTop:
				tone === "timeline"
					? `6px solid ${palette.accent}`
					: `4px solid ${palette.accent}`,
			borderRight: `1px solid ${palette.paperBorder}`,
			borderBottom: `1px solid ${palette.paperBorder}`,
			borderLeft: `1px solid ${palette.paperBorder}`,
		},
		dateBadge:
			tone === "timeline"
				? {
						display: "inline-flex",
						alignItems: "center",
						alignSelf: "flex-start",
						padding: "5px 10px",
						marginBottom: 12,
						borderRadius: 999,
						background: "rgba(255,255,255,0.74)",
						border: `1px solid ${palette.paperBorder}`,
						color: palette.darkText,
						fontSize: 12,
						fontWeight: 800,
						letterSpacing: "0.1em",
						textTransform: "uppercase",
					}
				: undefined,
		metaRow: {
			display: "flex",
			alignItems: "center",
			flexWrap: "wrap",
			gap: 12,
			marginBottom: 14,
		},
		source: {
			fontSize: 15,
			fontWeight: 800,
			color: palette.darkText,
			letterSpacing: "0.08em",
			textTransform: "uppercase",
			fontStyle: tone === "witness" ? "italic" : "normal",
		},
		date: {
			fontSize: 14,
			fontWeight: 700,
			color: palette.darkMuted,
		},
		title: {
			fontSize: tone === "timeline" ? 34 : 38,
			fontWeight: 820,
			color: palette.darkText,
			lineHeight: 1.28,
			margin: 0,
			fontFamily: "'Noto Sans KR', -apple-system, sans-serif",
			fontStyle: tone === "witness" ? "italic" : "normal",
		},
		excerpt: {
			fontSize: tone === "timeline" ? 20 : 22,
			color: palette.darkMuted,
			lineHeight: tone === "timeline" ? 1.5 : 1.6,
			margin: 0,
			fontFamily: "'Noto Sans KR', -apple-system, sans-serif",
		},
	};
}

export function getLowerThirdTheme(params: {
	mood?: SceneMood;
	hookBoost?: boolean;
	tone?: NewsSurfaceTone;
}): LowerThirdTheme {
	const { mood = "neutral", hookBoost = false, tone = "generic" } = params;
	const palette = PALETTES[mood] ?? PALETTES.neutral;
	const variant = getVariant(mood, hookBoost);

	if (variant === "breaking") {
		return {
			variant,
			tone,
			shell: {
				display: "flex",
				alignItems: "stretch",
				gap: 0,
			},
			rail: {
				width: 6,
				background: palette.accent,
				boxShadow: `0 0 18px ${palette.accentSoft}`,
				borderRadius: "4px 0 0 4px",
			},
			panel: {
				display: "flex",
				alignItems: "center",
				gap: 12,
				background: "rgba(10, 10, 12, 0.82)",
				backdropFilter: "blur(12px)",
				padding: "12px 18px 12px 14px",
				borderRadius: "0 10px 10px 0",
				border: `1px solid ${palette.paperBorder}`,
				borderLeft: "none",
			},
			badge: {
				text:
					tone === "witness"
						? "WITNESS"
						: tone === "evidence"
							? "PROOF"
							: tone === "timeline"
								? "NOW"
								: "LIVE",
				style: {
					padding: "4px 8px",
					borderRadius: 999,
					background: palette.accent,
					color: "#fff",
					fontSize: 10,
					fontWeight: 800,
					letterSpacing: "0.14em",
					textTransform: "uppercase",
				},
			},
			source: {
				fontSize: 15,
				fontWeight: 800,
				color: "#fff",
				letterSpacing: "0.04em",
				fontStyle: tone === "witness" ? "italic" : "normal",
			},
			date: {
				fontSize: 13,
				fontWeight: 600,
				color: "rgba(255,255,255,0.68)",
			},
			separator: {
				color: "rgba(255,255,255,0.28)",
				fontSize: 12,
			},
		};
	}

	if (variant === "dossier") {
		return {
			variant,
			tone,
			shell: {
				display: "flex",
				alignItems: "stretch",
				gap: 10,
			},
			rail: {
				width: 3,
				background: palette.accent,
				borderRadius: 999,
				boxShadow: `0 0 12px ${palette.accentSoft}`,
			},
			panel: {
				display: "flex",
				alignItems: "center",
				gap: 10,
				background: palette.panel,
				backdropFilter: "blur(16px)",
				padding: "11px 16px",
				borderRadius: 12,
				border: `1px solid ${palette.paperBorder}`,
			},
			badge: {
				text:
					tone === "witness"
						? "WITNESS"
						: tone === "evidence"
							? "EVIDENCE"
							: tone === "timeline"
								? "TIMELINE"
								: "SOURCE",
				style: {
					padding: "3px 8px",
					borderRadius: 6,
					background: palette.accentSoft,
					color: palette.text,
					fontSize: 10,
					fontWeight: 800,
					letterSpacing: "0.14em",
					textTransform: "uppercase",
					fontFamily: "'JetBrains Mono', 'Noto Sans KR', monospace",
				},
			},
			source: {
				fontSize: 14,
				fontWeight: 700,
				color: palette.text,
				letterSpacing: "0.08em",
				textTransform: "uppercase",
				fontFamily: "'JetBrains Mono', 'Noto Sans KR', monospace",
				fontStyle: tone === "witness" ? "italic" : "normal",
			},
			date: {
				fontSize: 12,
				fontWeight: 700,
				color: palette.muted,
				letterSpacing: "0.08em",
				fontFamily: "'JetBrains Mono', 'Noto Sans KR', monospace",
			},
			separator: {
				color: palette.muted,
				fontSize: 11,
			},
		};
	}

	return {
		variant,
		tone,
		shell: {
			display: "flex",
			alignItems: "stretch",
			gap: 0,
		},
		rail: {
			width: 4,
			background: palette.accent,
			borderRadius: "2px 0 0 2px",
		},
		panel: {
			display: "flex",
			alignItems: "center",
			gap: 10,
			background: "rgba(248,250,252,0.88)",
			backdropFilter: "blur(10px)",
			padding: "10px 16px 10px 14px",
			borderRadius: "0 10px 10px 0",
			border: `1px solid ${palette.paperBorder}`,
			borderLeft: "none",
		},
		badge: {
			text:
				tone === "witness"
					? "NOTE"
					: tone === "evidence"
						? "FILE"
						: tone === "timeline"
							? "SEQ"
							: "ARCHIVE",
			style: {
				padding: "3px 8px",
				borderRadius: 999,
				background: "rgba(255,255,255,0.7)",
				color: palette.darkMuted,
				fontSize: 10,
				fontWeight: 800,
				letterSpacing: "0.14em",
				textTransform: "uppercase",
			},
		},
		source: {
			fontSize: 15,
			fontWeight: 700,
			color: palette.darkText,
			fontStyle: tone === "witness" ? "italic" : "normal",
		},
		date: {
			fontSize: 13,
			fontWeight: 600,
			color: palette.darkMuted,
		},
		separator: {
			color: palette.darkMuted,
			fontSize: 11,
		},
	};
}
