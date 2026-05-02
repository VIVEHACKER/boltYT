import { storeLocalFile } from "./local-db";
import type { SceneShot, SceneShotVisualRole } from "./scene-shot-types";

export interface SourceCardInput {
	title?: string;
	source?: string;
	date?: string;
	caption?: string;
	narration?: string;
	visualRole?: SceneShotVisualRole;
	locale?: "ko" | "en";
}

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1920;

const ROLE_LABEL: Record<SceneShotVisualRole, string> = {
	evidence: "EVIDENCE",
	archive: "ARCHIVE",
	reconstruction: "RECONSTRUCTION",
	map: "TIMELINE MAP",
	document: "DOCUMENT",
	data: "DATA",
	context: "CONTEXT",
	transition: "CONTEXT",
	ending: "CONCLUSION",
};

const ROLE_ACCENT: Record<SceneShotVisualRole, string> = {
	evidence: "#f59e0b",
	archive: "#38bdf8",
	reconstruction: "#a78bfa",
	map: "#22c55e",
	document: "#e5e7eb",
	data: "#60a5fa",
	context: "#94a3b8",
	transition: "#94a3b8",
	ending: "#f97316",
};

function normalizeText(value?: string): string {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function truncate(value: string, max: number): string {
	if (value.length <= max) return value;
	return `${value.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function wrapText(value: string, maxChars: number, maxLines: number): string[] {
	const normalized = normalizeText(value);
	if (!normalized) return [];
	const words = normalized.includes(" ") ? normalized.split(" ") : normalized.split("");
	const lines: string[] = [];
	let line = "";

	for (const word of words) {
		const candidate = normalized.includes(" ") ? [line, word].filter(Boolean).join(" ") : line + word;
		if (candidate.length > maxChars && line) {
			lines.push(line);
			line = word;
		} else {
			line = candidate;
		}
		if (lines.length >= maxLines) break;
	}

	if (line && lines.length < maxLines) lines.push(line);
	if (lines.length === maxLines) {
		lines[maxLines - 1] = truncate(lines[maxLines - 1], maxChars);
	}
	return lines;
}

function sourceLine(input: SourceCardInput): string {
	const source = normalizeText(input.source);
	const date = normalizeText(input.date);
	if (source && date) return `${date} · ${source}`;
	return source || date || (input.locale === "en" ? "source-based visual" : "자료 기반 화면");
}

function primaryText(input: SourceCardInput): string {
	return (
		normalizeText(input.caption) ||
		normalizeText(input.title) ||
		normalizeText(input.narration) ||
		(input.locale === "en" ? "Verified context" : "확인된 맥락")
	);
}

export function buildSourceCardSvg(input: SourceCardInput): string {
	const visualRole = input.visualRole ?? "document";
	const accent = ROLE_ACCENT[visualRole];
	const label = ROLE_LABEL[visualRole];
	const title = truncate(
		normalizeText(input.title) || (input.locale === "en" ? "Source note" : "자료 확인"),
		64,
	);
	const headlineLines = wrapText(primaryText(input), 16, 4);
	const narrationLines = wrapText(normalizeText(input.narration), 24, 3);
	const meta = truncate(sourceLine(input), 64);

	const headlineSvg = headlineLines
		.map(
			(line, index) =>
				`<text x="96" y="${700 + index * 88}" class="headline">${escapeXml(line)}</text>`,
		)
		.join("\n");
	const narrationSvg = narrationLines
		.map(
			(line, index) =>
				`<text x="100" y="${1210 + index * 48}" class="body">${escapeXml(line)}</text>`,
		)
		.join("\n");

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#111827"/>
      <stop offset="0.55" stop-color="#172033"/>
      <stop offset="1" stop-color="#0f172a"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="24" stdDeviation="28" flood-color="#000000" flood-opacity="0.34"/>
    </filter>
  </defs>
  <style>
    .label{font:800 34px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:4px;fill:${accent}}
    .meta{font:600 28px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;fill:#cbd5e1}
    .title{font:800 40px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;fill:#f8fafc}
    .headline{font:900 76px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;fill:#ffffff}
    .body{font:600 34px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;fill:#cbd5e1}
    .small{font:700 24px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;fill:#94a3b8}
  </style>
  <rect width="1080" height="1920" fill="url(#bg)"/>
  <rect x="56" y="76" width="968" height="1768" rx="34" fill="rgba(15,23,42,0.64)" stroke="rgba(226,232,240,0.18)" filter="url(#shadow)"/>
  <rect x="96" y="128" width="206" height="54" rx="27" fill="rgba(255,255,255,0.08)" stroke="${accent}"/>
  <text x="128" y="165" class="label">${escapeXml(label)}</text>
  <text x="96" y="258" class="meta">${escapeXml(meta)}</text>
  <text x="96" y="344" class="title">${escapeXml(title)}</text>
  <line x1="96" y1="430" x2="984" y2="430" stroke="${accent}" stroke-width="8" stroke-linecap="round"/>
  <g opacity="0.12">
    <rect x="106" y="500" width="868" height="18" rx="9" fill="#ffffff"/>
    <rect x="106" y="548" width="640" height="18" rx="9" fill="#ffffff"/>
    <rect x="106" y="596" width="792" height="18" rx="9" fill="#ffffff"/>
  </g>
  ${headlineSvg}
  <rect x="96" y="1100" width="888" height="260" rx="24" fill="rgba(15,23,42,0.72)" stroke="rgba(148,163,184,0.28)"/>
  ${narrationSvg}
  <g transform="translate(96 1475)">
    <circle cx="28" cy="28" r="28" fill="${accent}" opacity="0.9"/>
    <text x="80" y="38" class="small">${escapeXml(input.locale === "en" ? "Source card generated from script metadata" : "실제 자료 부족 시 생성된 출처 기반 카드")}</text>
  </g>
  <text x="96" y="1762" class="small">${escapeXml(visualRole === "reconstruction" ? "AI reconstruction disclosure required" : "Not a claimed original photo/video")}</text>
</svg>`;
}

export function canUseSourceCard(shot?: Pick<SceneShot, "visual_role">): boolean {
	return shot?.visual_role !== "reconstruction" && shot?.visual_role !== "transition";
}

export async function generateSourceCardToPath(
	storagePath: string,
	input: SourceCardInput,
): Promise<string> {
	const svg = buildSourceCardSvg(input);
	const bytes = new TextEncoder().encode(svg);
	return storeLocalFile(storagePath.replace(/\.[a-z0-9]+$/i, ".svg"), bytes, "image/svg+xml");
}
