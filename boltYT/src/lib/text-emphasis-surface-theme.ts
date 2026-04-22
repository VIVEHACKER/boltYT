import type { CSSProperties } from "react";
import type { NewsCardTheme, NewsSurfaceTone } from "./news-surface-theme";

export interface TextEmphasisSurfaceTheme {
	card: CSSProperties;
	metaRow: CSSProperties;
	titleBlock: CSSProperties;
	lineAlign: "center" | "flex-start";
}

function hexToRgba(hex: string, alpha: number) {
	const normalized = hex.replace("#", "");
	if (normalized.length !== 6) {
		return `rgba(255,255,255,${alpha})`;
	}

	const r = Number.parseInt(normalized.slice(0, 2), 16);
	const g = Number.parseInt(normalized.slice(2, 4), 16);
	const b = Number.parseInt(normalized.slice(4, 6), 16);

	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function getTextEmphasisSurfaceTheme(params: {
	theme: NewsCardTheme;
	tone?: NewsSurfaceTone;
	hookBoost?: boolean;
}): TextEmphasisSurfaceTheme {
	const { theme, tone = "generic", hookBoost = false } = params;
	const accentSoft = hexToRgba(theme.accentColor, 0.14);
	const accentMid = hexToRgba(theme.accentColor, 0.22);
	const accentStrong = hexToRgba(theme.accentColor, hookBoost ? 0.32 : 0.24);
	const isArchive = theme.variant === "archive";

	const baseCard: CSSProperties = {
		position: "relative",
		overflow: "hidden",
		isolation: "isolate",
	};

	const baseMetaRow: CSSProperties = {
		justifyContent: "center",
	};

	const baseTitleBlock: CSSProperties = {
		display: "flex",
		flexDirection: "column",
		gap: 16,
		alignItems: "center",
		textAlign: "center",
		padding: "8px 0 2px",
	};

	if (tone === "witness") {
		return {
			card: {
				...baseCard,
				borderLeft: `8px solid ${theme.accentColor}`,
				boxShadow:
					`${String(theme.card.boxShadow ?? "")}, 0 0 0 1px ${accentSoft}`.trim(),
				backgroundImage: [
					`linear-gradient(90deg, ${accentStrong} 0%, transparent 34%)`,
					`linear-gradient(180deg, ${isArchive ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.06)"} 0%, transparent 58%)`,
				].join(", "),
			},
			metaRow: {
				...baseMetaRow,
				justifyContent: "flex-start",
			},
			titleBlock: {
				...baseTitleBlock,
				alignItems: "flex-start",
				textAlign: "left",
				padding: "14px 0 4px 10px",
				borderLeft: `2px solid ${accentMid}`,
			},
			lineAlign: "flex-start",
		};
	}

	if (tone === "evidence") {
		return {
			card: {
				...baseCard,
				outline: `1px solid ${accentSoft}`,
				outlineOffset: -8,
				backgroundImage: [
					"repeating-linear-gradient(180deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 12px)",
					`linear-gradient(135deg, transparent 0 76%, ${accentSoft} 76% 100%)`,
				].join(", "),
			},
			metaRow: {
				...baseMetaRow,
				justifyContent: "flex-start",
			},
			titleBlock: {
				...baseTitleBlock,
				alignItems: "flex-start",
				textAlign: "left",
				padding: "16px 16px 10px",
				borderRadius: 14,
				background: isArchive
					? "rgba(255,255,255,0.5)"
					: "rgba(255,255,255,0.04)",
				border: `1px dashed ${accentMid}`,
			},
			lineAlign: "flex-start",
		};
	}

	if (tone === "timeline") {
		return {
			card: {
				...baseCard,
				boxShadow:
					`${String(theme.card.boxShadow ?? "")}, inset 0 5px 0 ${theme.accentColor}`.trim(),
				backgroundImage: [
					`linear-gradient(90deg, transparent 0 10%, ${accentSoft} 10% 90%, transparent 90% 100%)`,
					`linear-gradient(180deg, ${isArchive ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.04)"} 0%, transparent 46%)`,
				].join(", "),
			},
			metaRow: baseMetaRow,
			titleBlock: {
				...baseTitleBlock,
				padding: "18px 0 8px",
				borderTop: `1px solid ${accentMid}`,
				borderBottom: `1px solid ${accentMid}`,
			},
			lineAlign: "center",
		};
	}

	return {
		card: {
			...baseCard,
			boxShadow:
				`${String(theme.card.boxShadow ?? "")}, 0 0 0 1px ${accentSoft}`.trim(),
		},
		metaRow: baseMetaRow,
		titleBlock: baseTitleBlock,
		lineAlign: "center",
	};
}
