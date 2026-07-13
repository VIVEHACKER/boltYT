/**
 * 시니어 머니체크 영상 팩토리.
 *
 * 공식 정책 자료를 바탕으로 같은 주제의 세로 쇼츠와 가로 롱폼을 함께 만든다.
 * 콘텐츠는 JSON으로 분리되어 있어 다음 편은 코드 수정 없이 --spec만 바꾸면 된다.
 *
 * 실행:
 *   TTS_PROVIDER=edge TTS_SPEED=1 npm run senior:money
 *   npm run senior:money:shorts -- --spec content/senior-money/my-episode.json
 */

import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateRenderOutput } from "../server/lib/render-output-qc.ts";
import { buildPlatformMeta } from "../src/lib/platform-meta.ts";
import {
	END_CARD_FRAMES,
	TITLE_CARD_FRAMES,
} from "../src/remotion/cards/card-frames.ts";
import {
	renderVlogRemotion,
	type VlogSceneInput,
} from "./remotion-vlog-render.ts";
import { runVerifyOutput, WARN_CHECKS } from "./verify-output.ts";
import {
	buildChapterMarkers,
	COMFY_PYTHON,
	dur,
	EDGE_VOICE,
	exec,
	floatEnv,
	log,
	parseArgs,
	posIntEnv,
	resolveTtsProvider,
	srtTime,
	TTS_SPEED,
	tts,
} from "./vlog-shared.ts";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SPEC = join(
	PROJECT_ROOT,
	"content",
	"senior-money",
	"basic-pension-2026.json",
);
const DEFAULT_OUTPUT_ROOT = join(PROJECT_ROOT, "output", "senior-money");

export type SeniorFormat = "shorts" | "longform";
export type SeniorLayout =
	| "headline"
	| "split"
	| "formula"
	| "checklist"
	| "steps";
export type TextTone = "white" | "yellow" | "red" | "green" | "blue";
export type TextSize = "xl" | "lg" | "md" | "sm";

export interface SeniorTextLine {
	text: string;
	tone: TextTone;
	size: TextSize;
}

export interface SeniorMetric {
	label: string;
	value: string;
}

export interface SeniorSceneSpec {
	kicker: string;
	layout: SeniorLayout;
	lines: SeniorTextLine[];
	body?: string;
	items?: string[];
	metrics?: SeniorMetric[];
	chapter?: string;
	narration: string;
}

export interface SeniorSource {
	name: string;
	title: string;
	date?: string;
	url: string;
}

export interface SeniorFormatSpec {
	description: string;
	hashtags: string[];
	scenes: SeniorSceneSpec[];
}

export interface SeniorEpisodeSpec {
	id: string;
	brand: string;
	topic: string;
	factualAsOf: string;
	presentation: {
		sourceBadge: string;
		screenDisclosure: string;
		thumbnailKicker: string;
		thumbnailBody: string;
		introTitle: string;
		introSubtitle: string;
		outroCta: string;
	};
	safety: {
		requiredFacts: string[];
		forbiddenClaims: string[];
	};
	titles: Record<SeniorFormat, string>;
	thumbnail: Record<SeniorFormat, SeniorTextLine[]>;
	reference: {
		channel: string;
		channelUrl: string;
		referenceVideoUrl?: string;
		patternsOnly: string[];
		copyrightBoundary: string;
	};
	sources: SeniorSource[];
	disclosure: string;
	formats: Record<SeniorFormat, SeniorFormatSpec>;
}

export interface PreparedScene extends VlogSceneInput {
	spec: SeniorSceneSpec;
}

export interface SeniorArtifactPaths {
	video: string;
	srt: string;
	thumbnail: string;
	title: string;
	description: string;
	chapters?: string;
	platformMeta: string;
	verifyReport: string;
	contactSheet: string;
	renderQc: string;
}

export interface SeniorArtifactRecord {
	format: SeniorFormat;
	status: "assets_ready" | "verified";
	fingerprint: string;
	paths: Partial<SeniorArtifactPaths>;
	durationSec: number;
	qcScore?: number;
}

interface SeniorEpisodeManifest {
	generatedAt: string;
	id: string;
	brand: string;
	topic: string;
	factualAsOf: string;
	specFingerprint: string;
	reference: SeniorEpisodeSpec["reference"];
	sources: SeniorSource[];
	disclosure: string;
	artifacts: SeniorArtifactRecord[];
}

const FACTORY_VERSION = 3;

function sortedJsonValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortedJsonValue);
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, nested]) => [key, sortedJsonValue(nested)]),
		);
	return value;
}

function sha256(value: unknown): string {
	return createHash("sha256")
		.update(JSON.stringify(sortedJsonValue(value)))
		.digest("hex");
}

export function seniorAssetFingerprint(
	spec: SeniorEpisodeSpec,
	format: SeniorFormat,
): string {
	const ttsProvider = resolveTtsProvider();
	return sha256({
		factoryVersion: FACTORY_VERSION,
		format,
		brand: spec.brand,
		presentation: spec.presentation,
		thumbnail: spec.thumbnail[format],
		scenes: spec.formats[format].scenes,
		tts: {
			provider: ttsProvider,
			speed: TTS_SPEED,
			voice: process.env.TTS_VOICE ?? "EXAVITQu4vr4xnSDxMaL",
			edgeVoice: EDGE_VOICE,
			clovaSpeaker: process.env.CLOVA_SPEAKER ?? "nara",
			fallback: (process.env.TTS_FALLBACK ?? "edge").toLowerCase(),
			// melo 는 엔드포인트가 모델/보이스를 좌우하므로 MELO_URL 변경 시 재생성.
			// 다른 provider 의 지문은 바뀌지 않도록 melo 일 때만 포함한다.
			...(ttsProvider === "melo"
				? { meloUrl: process.env.MELO_URL ?? "" }
				: {}),
		},
	});
}

export function seniorRenderFingerprint(
	spec: SeniorEpisodeSpec,
	format: SeniorFormat,
	assetFingerprint = seniorAssetFingerprint(spec, format),
): string {
	return sha256({
		factoryVersion: FACTORY_VERSION,
		format,
		assetFingerprint,
		render: {
			renderScale: Math.min(4, floatEnv("RENDER_SCALE", 1)),
			jpegQuality: Math.min(100, posIntEnv("JPEG_QUALITY", 100)),
			composition: format === "shorts" ? "YouTubeShorts" : "YouTubeVideo",
			cameraMove: "static",
			noSubtitle: true,
		},
	});
}

/** 하위 호환 이름: 카드·음성 캐시 지문을 반환한다. */
export function seniorFormatFingerprint(
	spec: SeniorEpisodeSpec,
	format: SeniorFormat,
): string {
	return seniorAssetFingerprint(spec, format);
}

export function seniorEpisodeFingerprint(spec: SeniorEpisodeSpec): string {
	return sha256({ factoryVersion: FACTORY_VERSION, spec });
}

function temporarySibling(path: string): string {
	const extension = extname(path);
	const stem = extension ? path.slice(0, -extension.length) : path;
	return `${stem}.tmp-${process.pid}-${Date.now()}${extension}`;
}

function writeTextAtomic(path: string, text: string): void {
	const temporary = temporarySibling(path);
	try {
		writeFileSync(temporary, text);
		renameSync(temporary, path);
	} finally {
		rmSync(temporary, { force: true });
	}
}

async function writeFileAtomic(
	path: string,
	producer: (temporaryPath: string) => Promise<void>,
): Promise<void> {
	const temporary = temporarySibling(path);
	try {
		await producer(temporary);
		renameSync(temporary, path);
	} finally {
		rmSync(temporary, { force: true });
	}
}

function readFingerprint(path: string): string | null {
	try {
		return readFileSync(path, "utf8").trim() || null;
	} catch {
		return null;
	}
}

function formatFingerprintPaths(
	outDir: string,
	specId: string,
	format: SeniorFormat,
): { assets: string; render: string } {
	return {
		assets: join(outDir, "assets", format, ".content.sha256"),
		render: join(outDir, `senior-money-${specId}-${format}.render.sha256`),
	};
}

function existingArtifactPaths(
	paths: SeniorArtifactPaths,
	assetsOnly: boolean,
): Partial<SeniorArtifactPaths> {
	const keys: Array<keyof SeniorArtifactPaths> = assetsOnly
		? ["srt", "thumbnail", "title", "description", "chapters", "platformMeta"]
		: [
				"video",
				"srt",
				"thumbnail",
				"title",
				"description",
				"chapters",
				"platformMeta",
				"verifyReport",
				"contactSheet",
				"renderQc",
			];
	const output: Record<string, string> = {};
	for (const key of keys) {
		const value = paths[key];
		if (typeof value === "string" && existsSync(value)) output[key] = value;
	}
	return output as Partial<SeniorArtifactPaths>;
}

const UNSAFE_PATTERNS: RegExp[] = [
	/\d[\d,.]*\s*(만\s*)?원\s*(을|를)?\s*(지급합니다|드립니다|받습니다|지급됩니다)/,
	/(무조건|반드시|누구나|전\s*국민|모두)[^.!?\n]{0,20}(받습니다|지급됩니다|수급됩니다|대상입니다)/,
	/(신청|심사)[^.!?\n]{0,8}(없이|안\s*해도)[^.!?\n]{0,12}(자동|바로)[^.!?\n]{0,8}(지급|수급|받)/,
	/\d[\d,.]*\s*(만\s*)?원[^.!?\n]{0,18}(누구나|모두)[^.!?\n]{0,10}(지급|받)/,
	/(원금|수익)\s*(완전\s*)?보장|확정\s*수익/,
];

const OFFICIAL_SOURCE_DOMAINS = [
	"korea.kr",
	"nps.or.kr",
	"nhis.or.kr",
	"bokjiro.go.kr",
	"bok.or.kr",
	"fss.or.kr",
	"law.go.kr",
] as const;
const LAYOUTS = new Set<SeniorLayout>([
	"headline",
	"split",
	"formula",
	"checklist",
	"steps",
]);
const TONES = new Set<TextTone>(["white", "yellow", "red", "green", "blue"]);
const SIZES = new Set<TextSize>(["xl", "lg", "md", "sm"]);

function normalizedClaim(text: string): string {
	return text.toLowerCase().replace(/[\s·,._|｜:;!?"'()[\]{}-]+/g, "");
}

export function containsUnsafeSeniorClaim(
	text: string,
	forbiddenClaims: string[] = [],
): boolean {
	const oneLine = text.replace(/\n/g, " ");
	if (UNSAFE_PATTERNS.some((pattern) => pattern.test(oneLine))) return true;
	const normalized = normalizedClaim(oneLine);
	return forbiddenClaims.some((claim) => {
		// 구두점만인 금지 문구는 normalizedClaim이 ''가 되어 includes('')===true로
		// 모든 조각을 오차단하므로 건너뛴다.
		const needle = normalizedClaim(claim);
		return needle.length > 0 && normalized.includes(needle);
	});
}

function assertString(value: unknown, label: string): asserts value is string {
	if (typeof value !== "string" || value.trim().length === 0)
		throw new Error(`${label}은(는) 비어 있지 않은 문자열이어야 합니다.`);
}

function assertStringArray(
	value: unknown,
	label: string,
	minLength = 1,
): asserts value is string[] {
	if (!Array.isArray(value) || value.length < minLength)
		throw new Error(
			`${label}은(는) ${minLength}개 이상의 문자열 배열이어야 합니다.`,
		);
	for (const [index, item] of value.entries())
		assertString(item, `${label}[${index}]`);
}

export function isOfficialSourceUrl(value: string): boolean {
	try {
		const url = new URL(value);
		if (url.protocol !== "https:") return false;
		const host = url.hostname.toLowerCase();
		return (
			host.endsWith(".go.kr") ||
			OFFICIAL_SOURCE_DOMAINS.some(
				(domain) => host === domain || host.endsWith(`.${domain}`),
			)
		);
	} catch {
		return false;
	}
}

function validateTextLine(value: unknown, label: string): void {
	if (!value || typeof value !== "object")
		throw new Error(`${label}은(는) 텍스트 객체여야 합니다.`);
	const line = value as Partial<SeniorTextLine>;
	assertString(line.text, `${label}.text`);
	if (!TONES.has(line.tone as TextTone))
		throw new Error(`${label}.tone 값이 올바르지 않습니다.`);
	if (!SIZES.has(line.size as TextSize))
		throw new Error(`${label}.size 값이 올바르지 않습니다.`);
}

function assertHttpsUrl(
	value: unknown,
	label: string,
): asserts value is string {
	assertString(value, label);
	try {
		if (new URL(value).protocol !== "https:") throw new Error("not https");
	} catch {
		throw new Error(`${label}은(는) 유효한 HTTPS 주소여야 합니다.`);
	}
}

/** 외부 JSON도 안전하게 양산 레인에 넣기 위한 최소 스키마·YMYL 검사. */
export function validateSeniorEpisodeSpec(
	value: unknown,
): asserts value is SeniorEpisodeSpec {
	if (!value || typeof value !== "object")
		throw new Error("에피소드 spec은 JSON 객체여야 합니다.");
	const spec = value as Partial<SeniorEpisodeSpec>;
	assertString(spec.id, "id");
	if (!/^[a-z0-9][a-z0-9-]*$/.test(spec.id))
		throw new Error("id는 영문 소문자·숫자·하이픈만 사용할 수 있습니다.");
	assertString(spec.brand, "brand");
	assertString(spec.topic, "topic");
	assertString(spec.factualAsOf, "factualAsOf");
	if (!/^\d{4}-\d{2}-\d{2}$/.test(spec.factualAsOf))
		throw new Error("factualAsOf는 YYYY-MM-DD 형식이어야 합니다.");
	assertString(spec.disclosure, "disclosure");
	const presentation = spec.presentation;
	if (!presentation || typeof presentation !== "object")
		throw new Error("presentation 객체가 필요합니다.");
	for (const key of [
		"sourceBadge",
		"screenDisclosure",
		"thumbnailKicker",
		"thumbnailBody",
		"introTitle",
		"introSubtitle",
		"outroCta",
	] as const)
		assertString(presentation[key], `presentation.${key}`);
	if (!spec.safety || typeof spec.safety !== "object")
		throw new Error("safety 객체가 필요합니다.");
	assertStringArray(spec.safety.requiredFacts, "safety.requiredFacts");
	assertStringArray(spec.safety.forbiddenClaims, "safety.forbiddenClaims");
	if (!spec.reference || typeof spec.reference !== "object")
		throw new Error("reference 객체가 필요합니다.");
	assertString(spec.reference.channel, "reference.channel");
	assertHttpsUrl(spec.reference.channelUrl, "reference.channelUrl");
	if (spec.reference.referenceVideoUrl !== undefined)
		assertHttpsUrl(
			spec.reference.referenceVideoUrl,
			"reference.referenceVideoUrl",
		);
	assertStringArray(spec.reference.patternsOnly, "reference.patternsOnly");
	assertString(spec.reference.copyrightBoundary, "reference.copyrightBoundary");
	if (!Array.isArray(spec.sources) || spec.sources.length === 0)
		throw new Error("공식 출처가 한 건 이상 필요합니다.");
	for (const [index, source] of spec.sources.entries()) {
		if (!source || typeof source !== "object")
			throw new Error(`sources[${index}]은(는) 출처 객체여야 합니다.`);
		assertString(source.name, `sources[${index}].name`);
		assertString(source.title, `sources[${index}].title`);
		if (source.date !== undefined)
			assertString(source.date, `sources[${index}].date`);
		if (!isOfficialSourceUrl(source.url))
			throw new Error(
				`sources[${index}].url은 정부·공공기관 공식 HTTPS 도메인이어야 합니다.`,
			);
	}
	const textPieces: string[] = [
		spec.brand,
		spec.topic,
		spec.disclosure,
		...Object.values(presentation),
		...spec.sources.flatMap((source) => [
			source.name,
			source.title,
			source.date ?? "",
		]),
	];
	for (const format of ["shorts", "longform"] as const) {
		assertString(spec.titles?.[format], `titles.${format}`);
		textPieces.push(spec.titles[format]);
		const thumbnail = spec.thumbnail?.[format];
		if (!Array.isArray(thumbnail) || thumbnail.length === 0)
			throw new Error(`thumbnail.${format}이 비어 있습니다.`);
		thumbnail.forEach((line, index) => {
			validateTextLine(line, `thumbnail.${format}[${index}]`);
			textPieces.push(line.text);
		});
		const formatSpec = spec.formats?.[format];
		if (!formatSpec?.scenes?.length)
			throw new Error(`formats.${format}.scenes가 비어 있습니다.`);
		assertString(formatSpec.description, `formats.${format}.description`);
		assertStringArray(formatSpec.hashtags, `formats.${format}.hashtags`);
		textPieces.push(formatSpec.description, ...formatSpec.hashtags);
		// 필수 근거(requiredFacts)는 실제 화면 노출·나레이션 텍스트에서만 확인한다.
		// description/hashtags(유튜브 설명란·태그)는 근거원에서 제외.
		const sceneScreenTexts: string[] = [];
		for (const [index, scene] of formatSpec.scenes.entries()) {
			if (!scene || typeof scene !== "object")
				throw new Error(
					`${format}.scenes[${index}]은(는) 장면 객체여야 합니다.`,
				);
			assertString(scene.kicker, `${format}.scenes[${index}].kicker`);
			assertString(scene.narration, `${format}.scenes[${index}].narration`);
			if (!LAYOUTS.has(scene.layout))
				throw new Error(
					`${format}.scenes[${index}].layout 값이 올바르지 않습니다.`,
				);
			if (!scene.lines?.length)
				throw new Error(`${format}.scenes[${index}].lines가 비어 있습니다.`);
			for (const [lineIndex, line] of scene.lines.entries())
				validateTextLine(
					line,
					`${format}.scenes[${index}].lines[${lineIndex}]`,
				);
			if (scene.body !== undefined)
				assertString(scene.body, `${format}.scenes[${index}].body`);
			if (scene.chapter !== undefined)
				assertString(scene.chapter, `${format}.scenes[${index}].chapter`);
			if (scene.items !== undefined)
				assertStringArray(scene.items, `${format}.scenes[${index}].items`);
			if (["formula", "checklist", "steps"].includes(scene.layout))
				assertStringArray(scene.items, `${format}.scenes[${index}].items`);
			if (scene.layout === "split") {
				if (!Array.isArray(scene.metrics) || scene.metrics.length < 2)
					throw new Error(
						`${format}.scenes[${index}].metrics가 두 개 이상 필요합니다.`,
					);
				for (const [metricIndex, metric] of scene.metrics.entries()) {
					assertString(
						metric?.label,
						`${format}.scenes[${index}].metrics[${metricIndex}].label`,
					);
					assertString(
						metric?.value,
						`${format}.scenes[${index}].metrics[${metricIndex}].value`,
					);
				}
			}
			const sceneScreenPieces = [
				scene.kicker,
				scene.narration,
				scene.body ?? "",
				...scene.lines.map((line) => line.text),
				...(scene.items ?? []),
				...(scene.metrics ?? []).flatMap((metric) => [
					metric.label,
					metric.value,
				]),
			];
			textPieces.push(...sceneScreenPieces);
			// 조각별 검사(아래 for-loop)만으로는 금지 문구가 여러 조각에 분할되면
			// 우회되므로, 한 장면의 화면 노출 텍스트를 합쳐서도 검사한다.
			const sceneScreenText = sceneScreenPieces
				.filter((piece) => piece.length > 0)
				.join(" ");
			if (
				containsUnsafeSeniorClaim(sceneScreenText, spec.safety.forbiddenClaims)
			)
				throw new Error(
					`YMYL 안전 검사 실패(${format}.scenes[${index}]): ${sceneScreenText.slice(0, 60)}`,
				);
			sceneScreenTexts.push(sceneScreenText);
		}
		const normalizedFormat = normalizedClaim(sceneScreenTexts.join(" "));
		for (const fact of spec.safety.requiredFacts) {
			// 구두점만인 필수 문구는 normalizedClaim이 ''가 되어 includes('')===true로
			// 항상 충족(fail-open)되므로 검사 대상에서 건너뛴다.
			const needle = normalizedClaim(fact);
			if (needle.length === 0) continue;
			if (!normalizedFormat.includes(needle))
				throw new Error(`${format} 필수 근거 문구가 누락됐습니다: ${fact}`);
		}
	}
	for (const piece of textPieces)
		if (containsUnsafeSeniorClaim(piece, spec.safety.forbiddenClaims))
			throw new Error(`YMYL 안전 검사 실패: ${piece.slice(0, 60)}`);
}

export function loadSeniorEpisodeSpec(path = DEFAULT_SPEC): SeniorEpisodeSpec {
	const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
	validateSeniorEpisodeSpec(parsed);
	return parsed;
}

export function seniorArtifactPaths(
	outDir: string,
	specId: string,
	format: SeniorFormat,
): SeniorArtifactPaths {
	const stem = `senior-money-${specId}-${format}`;
	return {
		video: join(outDir, `${stem}.mp4`),
		srt: join(outDir, `${stem}.srt`),
		thumbnail: join(outDir, `${stem}-thumbnail.jpg`),
		title: join(outDir, `${stem}.title.txt`),
		description: join(outDir, `${stem}.description.txt`),
		...(format === "longform"
			? { chapters: join(outDir, `${stem}.chapters.txt`) }
			: {}),
		platformMeta: join(outDir, `${stem}.platform_meta.json`),
		verifyReport: join(outDir, `${stem}.verify_report.json`),
		contactSheet: join(outDir, `${stem}.contact_sheet.png`),
		renderQc: join(outDir, `${stem}.render_qc.json`),
	};
}

export function buildSeniorSrt(
	scenes: Array<Pick<PreparedScene, "narration" | "durationSec">>,
	introOffsetSec = 0,
): string {
	let cursor = introOffsetSec;
	return scenes
		.map((scene, index) => {
			const start = cursor;
			cursor += scene.durationSec;
			return `${index + 1}\n${srtTime(start)} --> ${srtTime(cursor)}\n${scene.narration}\n`;
		})
		.join("\n");
}

/**
 * Remotion TitleCard는 마지막 0.3초를 검게 페이드하고 본문은 3초부터 시작한다.
 * 두 레이어 사이를 첫 본문 카드로 메워 타임라인·오디오를 바꾸지 않고 검은 틈만 없앤다.
 */
export function longformIntroBridgeFilter(): string {
	return [
		"[0:v][1:v]scale2ref=w=rw:h=rh[bridgeSource][base]",
		"[bridgeSource]format=rgba",
		"fade=t=in:st=2.50:d=0.18:alpha=1",
		"fade=t=out:st=3.05:d=0.15:alpha=1[bridge]",
		"[base][bridge]overlay=enable='between(t,2.50,3.20)'[video]",
	]
		.join(",")
		.replace(",[bridgeSource]", ";[bridgeSource]")
		.replace(",[base]", ";[base]");
}

export async function patchLongformIntroBridge(
	videoPath: string,
	firstSceneImage: string,
): Promise<void> {
	const tempPath = videoPath.replace(/\.mp4$/i, ".intro-bridge.mp4");
	rmSync(tempPath, { force: true });
	try {
		await exec("ffmpeg", [
			"-y",
			"-loop",
			"1",
			"-framerate",
			"30",
			"-i",
			firstSceneImage,
			"-i",
			videoPath,
			"-filter_complex",
			longformIntroBridgeFilter(),
			"-map",
			"[video]",
			"-map",
			"1:a:0?",
			"-c:v",
			"libx264",
			"-preset",
			"fast",
			"-crf",
			"18",
			"-c:a",
			"copy",
			"-movflags",
			"+faststart",
			"-shortest",
			tempPath,
		]);
		renameSync(tempPath, videoPath);
	} finally {
		rmSync(tempPath, { force: true });
	}
}

const CARD_PYTHON = `
import json, math, os, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

out, width, height, payload_json, index, total, thumb = sys.argv[1:8]
W, H = int(width), int(height)
payload = json.loads(payload_json)
scene = payload["scene"]
context = payload["context"]
brand = context["brand"]
source_label = context["sourceBadge"]
screen_disclosure = context["screenDisclosure"]
index, total, thumb = int(index), int(total), thumb == "1"
vertical = H > W

FONT_PATHS = [
    "/System/Library/Fonts/AppleSDGothicNeo.ttc",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
]
FONT_PATH = next((p for p in FONT_PATHS if os.path.exists(p)), FONT_PATHS[0])

def font(size):
    return ImageFont.truetype(FONT_PATH, max(18, int(size)), index=0)

COLORS = {
    "white": "#F8FAFC",
    "yellow": "#FFE03A",
    "red": "#FF4D4F",
    "green": "#3BE49B",
    "blue": "#69B7FF",
}

# 짙은 남색 그라데이션. 레퍼런스의 고대비 문법은 쓰되 화면과 자산은 새로 만든다.
im = Image.new("RGB", (W, H), "#07111F")
pix = im.load()
for y in range(H):
    t = y / max(1, H - 1)
    r = int(5 + 8 * t)
    g = int(15 + 13 * t)
    b = int(29 + 20 * t)
    for x in range(W):
        glow = max(0.0, 1.0 - math.hypot((x-W*0.78)/(W*0.75), (y-H*0.18)/(H*0.52)))
        pix[x, y] = (r + int(8*glow), g + int(15*glow), b + int(22*glow))

d = ImageDraw.Draw(im)
scale = W / (1080 if vertical else 1920)
border = max(6, int(9 * scale))
margin = int((34 if vertical else 46) * scale)
d.rounded_rectangle(
    (margin, margin, W-margin, H-margin),
    radius=int(28*scale), outline="#E9B949", width=border
)

# 작은 격자와 원형 장식은 신뢰형 정보 카드의 시각 리듬을 만든다.
grid_step = max(70, int(W * 0.07))
for x in range(margin + grid_step, W-margin, grid_step):
    d.line((x, margin+10, x, H-margin-10), fill=(36, 54, 76), width=1)
for y in range(margin + grid_step, H-margin, grid_step):
    d.line((margin+10, y, W-margin-10, y), fill=(36, 54, 76), width=1)
d.ellipse((W*0.73, -H*0.08, W*1.05, H*0.24), outline="#2B4C73", width=max(2, int(5*scale)))
d.ellipse((-W*0.12, H*0.72, W*0.18, H*1.03), outline="#243E5C", width=max(2, int(4*scale)))

def text_width(text, f, stroke=0):
    box = d.textbbox((0, 0), text, font=f, stroke_width=stroke)
    return box[2] - box[0]

def fit_font(text, target_size, max_width, min_size=28):
    size = int(target_size)
    while size > min_size:
        f = font(size)
        if text_width(text, f, max(1, int(size*0.035))) <= max_width:
            return f
        size -= 3
    return font(min_size)

def centered(text, y, size, color, max_width=None, stroke=True, accent_band=False):
    max_width = max_width or int(W * 0.82)
    f = fit_font(text, size, max_width)
    sw = max(2, int(size * 0.035)) if stroke else 0
    if accent_band:
        bb = d.textbbox((W/2, y), text, font=f, anchor="mm", stroke_width=sw)
        px, py = int(22*scale), int(13*scale)
        d.rounded_rectangle((bb[0]-px, bb[1]-py, bb[2]+px, bb[3]+py),
                            radius=int(16*scale), fill="#3A1018")
    d.text((W/2, y), text, font=f, fill=color, anchor="mm",
           stroke_width=sw, stroke_fill="#02060C")
    box = d.textbbox((W/2, y), text, font=f, anchor="mm", stroke_width=sw)
    return box[3] - box[1]

def wrap_pixels(text, f, max_width):
    lines, cur = [], ""
    for ch in text:
        trial = cur + ch
        if cur and text_width(trial, f) > max_width:
            lines.append(cur)
            cur = ch
        else:
            cur = trial
    if cur:
        lines.append(cur)
    return lines

# 브랜드/근거 배지
pill_h = int((76 if vertical else 58) * scale)
pill_x = margin + int(30*scale)
pill_y = margin + int(28*scale)
pill_w = int((390 if vertical else 330) * scale)
d.rounded_rectangle((pill_x, pill_y, pill_x+pill_w, pill_y+pill_h),
                    radius=pill_h//2, fill="#FFE03A")
d.text((pill_x+pill_w/2, pill_y+pill_h/2), brand,
       font=fit_font(brand, (37 if vertical else 30)*scale, pill_w-int(34*scale), 18),
       fill="#101827", anchor="mm")
sf = fit_font(source_label, (27 if vertical else 25)*scale, W*0.33, 18)
d.text((W-margin-int(32*scale), pill_y+pill_h/2), source_label,
       font=sf, fill="#B8C8DB", anchor="rm")
if not thumb:
    d.text((W-margin-int(32*scale), pill_y+pill_h+int(34*scale)),
           f"{index:02d} / {total:02d}", font=font((25 if vertical else 23)*scale),
           fill="#6F8BA8", anchor="ra")

kicker_y = int(H * (0.175 if vertical else 0.17))
kicker = scene.get("kicker", "")
if kicker:
    centered(kicker, kicker_y, (47 if vertical else 41)*scale, "#AFC2D7", W*0.78, False)

layout = scene.get("layout", "headline")
lines = scene.get("lines", [])
size_map = ({"xl": 166, "lg": 106, "md": 72, "sm": 48}
            if vertical else {"xl": 160, "lg": 98, "md": 64, "sm": 42})

def draw_headlines(y_start, y_end):
    if not lines:
        return
    heights = []
    for line in lines:
        size = size_map.get(line.get("size", "lg"), 80) * scale
        f = fit_font(line.get("text", ""), size, W*0.82)
        box = d.textbbox((0, 0), line.get("text", ""), font=f, stroke_width=max(2, int(size*0.035)))
        heights.append((box[3]-box[1]) + int((32 if vertical else 20)*scale))
    total_h = sum(heights)
    y = max(y_start, (y_start+y_end-total_h)/2)
    for line, line_h in zip(lines, heights):
        tone = line.get("tone", "white")
        centered(line.get("text", ""), y+line_h/2,
                 size_map.get(line.get("size", "lg"), 80)*scale,
                 COLORS.get(tone, COLORS["white"]), W*0.84,
                 True, tone == "red")
        y += line_h

content_top = int(H * (0.22 if vertical else 0.23))
content_bottom = int(H * (0.73 if vertical else 0.73))

if layout == "headline":
    draw_headlines(content_top, content_bottom)

elif layout == "split":
    draw_headlines(content_top, int(H*0.36))
    metrics = scene.get("metrics", [])[:2]
    if vertical:
        panel_w, panel_h = int(W*0.76), int(H*0.16)
        x = (W-panel_w)//2
        ys = [int(H*0.39), int(H*0.58)]
        for n, metric in enumerate(metrics):
            y = ys[n]
            d.rounded_rectangle((x, y, x+panel_w, y+panel_h), radius=int(28*scale),
                                fill="#101F34", outline="#3A5877", width=max(2,int(3*scale)))
            d.text((x+int(42*scale), y+panel_h/2), metric["label"],
                   font=font(43*scale), fill="#D7E2EE", anchor="lm")
            d.text((x+panel_w-int(38*scale), y+panel_h/2), metric["value"],
                   font=fit_font(metric["value"], 76*scale, panel_w*0.54), fill="#FFE03A",
                   anchor="rm", stroke_width=max(2,int(3*scale)), stroke_fill="#02060C")
    else:
        gap, panel_w, panel_h = int(42*scale), int(W*0.37), int(H*0.31)
        start_x, y = (W-(panel_w*2+gap))//2, int(H*0.40)
        for n, metric in enumerate(metrics):
            x = start_x+n*(panel_w+gap)
            d.rounded_rectangle((x, y, x+panel_w, y+panel_h), radius=int(30*scale),
                                fill="#101F34", outline="#3A5877", width=max(2,int(3*scale)))
            d.text((x+panel_w/2, y+panel_h*0.31), metric["label"], font=font(42*scale),
                   fill="#D7E2EE", anchor="mm")
            d.text((x+panel_w/2, y+panel_h*0.66), metric["value"],
                   font=fit_font(metric["value"], 82*scale, panel_w*0.84), fill="#FFE03A",
                   anchor="mm", stroke_width=max(2,int(3*scale)), stroke_fill="#02060C")

elif layout == "formula":
    draw_headlines(content_top, int(H*0.39))
    items = scene.get("items", [])
    if vertical:
        y = int(H*0.42)
        for n, item in enumerate(items):
            if item == "+":
                centered(item, y, 72*scale, "#FF4D4F", W*0.3)
                y += int(H*0.08)
            else:
                x1, x2, ph = int(W*0.13), int(W*0.87), int(H*0.105)
                d.rounded_rectangle((x1, y-ph/2, x2, y+ph/2), radius=int(24*scale),
                                    fill="#12243B", outline="#3BE49B", width=max(2,int(3*scale)))
                centered(item, y, 53*scale, "#F8FAFC", x2-x1-int(40*scale))
                y += int(H*0.14)
    else:
        items = items[:3]
        widths = [int(W*0.28), int(W*0.08), int(W*0.34)]
        total_w = sum(widths) + int(W*0.04)*2
        x, y, ph = (W-total_w)//2, int(H*0.55), int(H*0.19)
        for n, item in enumerate(items):
            pw = widths[n] if n < len(widths) else int(W*0.25)
            if item == "+":
                centered(item, y, 86*scale, "#FF4D4F", pw)
            else:
                d.rounded_rectangle((x, y-ph/2, x+pw, y+ph/2), radius=int(26*scale),
                                    fill="#12243B", outline="#3BE49B", width=max(2,int(3*scale)))
                centered(item, y, 48*scale, "#F8FAFC", pw-int(30*scale))
            x += pw+int(W*0.04)

elif layout in ("checklist", "steps"):
    draw_headlines(content_top, int(H*(0.43 if vertical else 0.42)))
    items = scene.get("items", [])[:4]
    panel_x1, panel_x2 = int(W*0.11), int(W*0.89)
    panel_y1 = int(H*(0.44 if vertical else 0.43))
    panel_y2 = int(H*(0.76 if vertical else 0.77))
    d.rounded_rectangle((panel_x1, panel_y1, panel_x2, panel_y2), radius=int(30*scale),
                        fill="#0E1D31", outline="#304D6B", width=max(2,int(3*scale)))
    row_h = (panel_y2-panel_y1) / max(1, len(items))
    for n, item in enumerate(items):
        cy = panel_y1 + row_h*(n+0.5)
        cx = panel_x1 + int((58 if vertical else 54)*scale)
        radius = int((24 if vertical else 20)*scale)
        fill = "#3BE49B" if layout == "checklist" else "#FFE03A"
        d.ellipse((cx-radius, cy-radius, cx+radius, cy+radius), fill=fill)
        marker = "✓" if layout == "checklist" else str(n+1)
        d.text((cx, cy), marker, font=font((31 if vertical else 27)*scale),
               fill="#08121F", anchor="mm")
        tx = cx + int((53 if vertical else 48)*scale)
        f = fit_font(item, (43 if vertical else 39)*scale, panel_x2-tx-int(35*scale), 25)
        d.text((tx, cy), item, font=f, fill="#F8FAFC", anchor="lm")
        if n < len(items)-1:
            d.line((panel_x1+int(35*scale), panel_y1+row_h*(n+1),
                    panel_x2-int(35*scale), panel_y1+row_h*(n+1)), fill="#223A55", width=2)

body = scene.get("body", "")
if body:
    by = int(H * ((0.785 if layout == "headline" else 0.82) if vertical else (0.80 if layout == "headline" else 0.835)))
    bf = font((43 if vertical else 37)*scale)
    wrapped = wrap_pixels(body, bf, W*0.78)[:2]
    for n, line in enumerate(wrapped):
        d.text((W/2, by+n*int((48 if vertical else 42)*scale)), line,
               font=bf, fill="#B9C7D6", anchor="mm")

# 고정 안전 고지. 하단 자막이 올라와도 핵심 정보와 겹치지 않도록 가장자리 배치.
footer_h = int((72 if vertical else 58)*scale)
fy = H-margin-footer_h-int(18*scale)
d.rounded_rectangle((margin+int(24*scale), fy, W-margin-int(24*scale), fy+footer_h),
                    radius=int(16*scale), fill="#050B14")
footer = screen_disclosure
ff = fit_font(footer, (33 if vertical else 29)*scale, W*0.74, 18)
d.text((W/2, fy+footer_h/2), footer, font=ff, fill="#B9C7D6", anchor="mm")

if out.lower().endswith((".jpg", ".jpeg")):
    im.save(out, quality=94, subsampling=0)
else:
    im.save(out)
`;

/** Pillow 기반 원본 정보 카드. 기사 사진을 재사용하지 않아 저작권 경계를 지킨다. */
export async function renderSeniorCard(
	scene: SeniorSceneSpec,
	context: Pick<SeniorEpisodeSpec, "brand" | "presentation">,
	outPath: string,
	width: number,
	height: number,
	index: number,
	total: number,
	thumbnail = false,
): Promise<void> {
	await exec(COMFY_PYTHON, [
		"-c",
		CARD_PYTHON,
		outPath,
		String(width),
		String(height),
		JSON.stringify({
			scene,
			context: {
				brand: context.brand,
				sourceBadge: context.presentation.sourceBadge,
				screenDisclosure: context.presentation.screenDisclosure,
			},
		}),
		String(index),
		String(total),
		thumbnail ? "1" : "0",
	]);
}

function thumbnailScene(
	spec: SeniorEpisodeSpec,
	format: SeniorFormat,
): SeniorSceneSpec {
	return {
		kicker: spec.presentation.thumbnailKicker,
		layout: "headline",
		lines: spec.thumbnail[format],
		body: spec.presentation.thumbnailBody,
		narration: "",
	};
}

async function prepareScenes(
	spec: SeniorEpisodeSpec,
	format: SeniorFormat,
	outDir: string,
	regenerate: boolean,
): Promise<PreparedScene[]> {
	const sceneDir = join(outDir, "assets", format);
	mkdirSync(sceneDir, { recursive: true });
	const width = format === "shorts" ? 1080 : 1920;
	const height = format === "shorts" ? 1920 : 1080;
	const scenes = spec.formats[format].scenes;
	const prepared: PreparedScene[] = [];

	for (const [index, scene] of scenes.entries()) {
		const id = String(index + 1).padStart(2, "0");
		const imageUrl = join(sceneDir, `scene-${id}.png`);
		const audioUrl = join(sceneDir, `scene-${id}.mp3`);
		if (regenerate || !existsSync(imageUrl)) {
			log(`   카드 ${format} ${id}/${scenes.length}`);
			await writeFileAtomic(imageUrl, (temporaryPath) =>
				renderSeniorCard(
					scene,
					spec,
					temporaryPath,
					width,
					height,
					index + 1,
					scenes.length,
				),
			);
		}
		if (regenerate || !existsSync(audioUrl)) {
			log(`   음성 ${format} ${id}/${scenes.length}`);
			await writeFileAtomic(audioUrl, (temporaryPath) =>
				tts(scene.narration, temporaryPath),
			);
		}
		prepared.push({
			spec: scene,
			imageUrl,
			audioUrl,
			narration: scene.narration,
			durationSec: await dur(audioUrl),
		});
	}
	return prepared;
}

function sourceDescription(spec: SeniorEpisodeSpec): string {
	return spec.sources
		.map((source) =>
			[
				[source.date, source.name, source.title].filter(Boolean).join(" · "),
				source.url,
			]
				.filter(Boolean)
				.join("\n"),
		)
		.join("\n");
}

function chapterData(
	scenes: PreparedScene[],
	introOffsetSec: number,
): Array<{ title: string; startSec: number }> {
	let cursor = introOffsetSec;
	const chapters: Array<{ title: string; startSec: number }> = [];
	for (const scene of scenes) {
		if (scene.spec.chapter)
			chapters.push({ title: scene.spec.chapter, startSec: cursor });
		cursor += scene.durationSec;
	}
	return chapters;
}

function writeMetadata(
	spec: SeniorEpisodeSpec,
	format: SeniorFormat,
	paths: SeniorArtifactPaths,
	scenes: PreparedScene[],
	introOffsetSec: number,
): void {
	const formatSpec = spec.formats[format];
	const chapters =
		format === "longform" ? chapterData(scenes, introOffsetSec) : [];
	const chapterLines = buildChapterMarkers(chapters);
	const hashtags = formatSpec.hashtags.map(
		(tag) => `#${tag.replace(/^#/, "")}`,
	);
	const description = [
		formatSpec.description,
		"",
		...(chapterLines.length > 0 ? ["챕터", ...chapterLines, ""] : []),
		"공식 출처",
		sourceDescription(spec),
		"",
		spec.disclosure,
		"",
		hashtags.join(" "),
	].join("\n");

	writeTextAtomic(paths.title, `${spec.titles[format]}\n`);
	writeTextAtomic(paths.description, `${description}\n`);
	if (paths.chapters)
		writeTextAtomic(paths.chapters, `${chapterLines.join("\n")}\n`);
	writeTextAtomic(
		paths.platformMeta,
		`${JSON.stringify(
			buildPlatformMeta({
				title: spec.titles[format],
				description: formatSpec.description,
				tags: formatSpec.hashtags,
				hashtags: formatSpec.hashtags,
				isShorts: format === "shorts",
				...(chapters.length > 0
					? {
							chapters: chapters.map((chapter) => ({
								sec: chapter.startSec,
								label: chapter.title,
							})),
						}
					: {}),
				sourceList: spec.sources.map(
					(source) => `${source.name} · ${source.title} ${source.url}`,
				),
				disclosure: spec.disclosure,
			}),
			null,
			2,
		)}\n`,
	);
}

/**
 * 카드·음성 자산을 재생성할지 결정한다.
 *
 * --adopt-existing 은 "지문 도입 전 산출물 1회 등록" 마이그레이션 옵션이다.
 * 지문 파일이 아예 없으면(pre-fingerprint 산출물) 채택을 허용하고, 지문이
 * 존재하는데 불일치하면(=spec 텍스트 수정) 낡은 자산 채택이 화면·음성/자막·메타
 * 불일치를 유발하므로 채택하지 않고 재생성한다. 지문이 일치하면 그대로 채택한다.
 */
export function shouldRegenerateSeniorAssets(input: {
	force: boolean;
	adoptExisting: boolean;
	existingSceneAssets: boolean;
	thumbnailExists: boolean;
	assetsMatch: boolean;
	storedFingerprintPresent: boolean;
}): boolean {
	// 지문이 존재하는데 불일치 = spec 변경 → 채택 금지. 지문 부재 = 레거시 마이그레이션 → 허용.
	const fingerprintBlocksAdoption =
		input.storedFingerprintPresent && !input.assetsMatch;
	const canAdoptAssets =
		input.adoptExisting &&
		!fingerprintBlocksAdoption &&
		input.existingSceneAssets &&
		input.thumbnailExists;
	return input.force || (!input.assetsMatch && !canAdoptAssets);
}

async function renderFormat(
	spec: SeniorEpisodeSpec,
	format: SeniorFormat,
	outDir: string,
	force: boolean,
	assetsOnly: boolean,
	adoptExisting: boolean,
): Promise<SeniorArtifactRecord> {
	log(`\n[${format}] 카드·음성 준비`);
	const paths = seniorArtifactPaths(outDir, spec.id, format);
	const assetFingerprint = seniorAssetFingerprint(spec, format);
	const renderFingerprint = seniorRenderFingerprint(
		spec,
		format,
		assetFingerprint,
	);
	const fingerprintPaths = formatFingerprintPaths(outDir, spec.id, format);
	const sceneDir = join(outDir, "assets", format);
	const existingSceneAssets = spec.formats[format].scenes.every((_, index) => {
		const id = String(index + 1).padStart(2, "0");
		return (
			existsSync(join(sceneDir, `scene-${id}.png`)) &&
			existsSync(join(sceneDir, `scene-${id}.mp3`))
		);
	});
	const storedAssetFingerprint = readFingerprint(fingerprintPaths.assets);
	const assetsMatch = storedAssetFingerprint === assetFingerprint;
	const regenerateAssets = shouldRegenerateSeniorAssets({
		force,
		adoptExisting,
		existingSceneAssets,
		thumbnailExists: existsSync(paths.thumbnail),
		assetsMatch,
		storedFingerprintPresent: storedAssetFingerprint !== null,
	});
	if (regenerateAssets) rmSync(fingerprintPaths.render, { force: true });
	const scenes = await prepareScenes(spec, format, outDir, regenerateAssets);
	const audioSecTotal = scenes.reduce(
		(sum, scene) => sum + scene.durationSec,
		0,
	);
	if (format === "shorts" && audioSecTotal > 59.6 - scenes.length / 30)
		throw new Error(
			`쇼츠가 60초를 넘습니다: 오디오 ${audioSecTotal.toFixed(2)}초`,
		);
	if (format === "shorts" && audioSecTotal < 35)
		throw new Error(
			`쇼츠가 너무 짧습니다: 오디오 ${audioSecTotal.toFixed(2)}초 (최소 35초)`,
		);

	const introOffsetSec = format === "longform" ? TITLE_CARD_FRAMES / 30 : 0;
	writeTextAtomic(paths.srt, buildSeniorSrt(scenes, introOffsetSec));
	writeMetadata(spec, format, paths, scenes, introOffsetSec);

	const thumbWidth = format === "shorts" ? 1080 : 1280;
	const thumbHeight = format === "shorts" ? 1920 : 720;
	if (regenerateAssets || !existsSync(paths.thumbnail)) {
		log(`   썸네일 ${format}`);
		await writeFileAtomic(paths.thumbnail, (temporaryPath) =>
			renderSeniorCard(
				thumbnailScene(spec, format),
				spec,
				temporaryPath,
				thumbWidth,
				thumbHeight,
				1,
				1,
				true,
			),
		);
	}
	writeTextAtomic(fingerprintPaths.assets, `${assetFingerprint}\n`);

	if (assetsOnly)
		return {
			format,
			status: "assets_ready",
			fingerprint: assetFingerprint,
			paths: existingArtifactPaths(paths, true),
			durationSec: audioSecTotal + introOffsetSec,
		};

	const renderMatches =
		readFingerprint(fingerprintPaths.render) === renderFingerprint;
	const canAdoptRender =
		adoptExisting && existsSync(paths.video) && !regenerateAssets;
	const needsRender =
		force ||
		regenerateAssets ||
		!existsSync(paths.video) ||
		(!renderMatches && !canAdoptRender);
	if (needsRender) {
		log(`   Remotion ${format} 렌더 시작`);
		const temporaryVideo = temporarySibling(paths.video);
		try {
			await renderVlogRemotion({
				// 카드가 텍스트를 이미 소유 → 자막 오버레이 끔(중복·충돌 방지) + 카메라무빙 static
				// 고정(풀프레임 텍스트 카드에서 Ken Burns 줌이 상단 헤더를 잘라먹는 것 방지).
				scenes: scenes.map((s) => ({
					...s,
					cameraMove: "static" as const,
				})),
				outPath: temporaryVideo,
				projectRoot: PROJECT_ROOT,
				compositionId: format === "shorts" ? "YouTubeShorts" : "YouTubeVideo",
				runId: `senior-${spec.id}-${format}`,
				subtitleBgStyle: "stroke",
				noSubtitle: true,
				intro:
					format === "longform"
						? {
								title: spec.presentation.introTitle,
								subtitle: spec.presentation.introSubtitle,
								channelName: spec.brand,
							}
						: undefined,
				outro:
					format === "longform"
						? {
								channelName: spec.brand,
								ctaText: spec.presentation.outroCta,
							}
						: undefined,
				onProgress: (pct) => process.stdout.write(`\r   렌더 ${pct}%`),
			});
			process.stdout.write("\n");
			if (format === "longform") {
				log("   인트로→본문 검은 페이드 브리지 보정");
				await patchLongformIntroBridge(temporaryVideo, scenes[0].imageUrl);
			}
			renameSync(temporaryVideo, paths.video);
		} finally {
			rmSync(temporaryVideo, { force: true });
		}
	}

	log(`   ${format} 길이·자막·컨택트시트 검수`);
	const outroSec = format === "longform" ? END_CARD_FRAMES / 30 : 0;
	const report = await runVerifyOutput({
		videoPath: paths.video,
		srtPath: paths.srt,
		audioSecTotal,
		cutCount: scenes.length,
		introOffsetSec,
		outroSec,
		contactSheet: true,
		reportPath: paths.verifyReport,
	});
	for (const check of report.checks) {
		if (!check.ok)
			log(
				`   ${WARN_CHECKS.has(check.name) ? "⚠" : "✗"} ${check.name}: ${check.detail ?? check.actual ?? "실패"}`,
			);
	}
	if (!report.ok)
		throw new Error(`${format} 출력 검수 실패: ${paths.verifyReport}`);

	log(`   ${format} 해상도·오디오·모션 심층 QC`);
	const qc = await evaluateRenderOutput(paths.video, {
		windowSeconds: format === "shorts" ? 10 : 12,
	});
	writeTextAtomic(paths.renderQc, `${JSON.stringify(qc, null, 2)}\n`);
	log(`   QC ${qc.score}/100 · ${qc.verdict} · issues ${qc.issues.length}`);
	const criticalIssues = qc.issues.filter((issue) =>
		[
			"canvas_not_platform_ready",
			"fps_out_of_range",
			"missing_audio",
			"black_segment_detected",
		].includes(issue),
	);
	if (criticalIssues.length > 0 || qc.score < 80)
		throw new Error(
			`${format} 심층 QC 실패(${qc.score}/100): ${criticalIssues.join(", ") || qc.issues.join(", ")}`,
		);
	writeTextAtomic(fingerprintPaths.render, `${renderFingerprint}\n`);

	return {
		format,
		status: "verified",
		fingerprint: renderFingerprint,
		paths: existingArtifactPaths(paths, false),
		durationSec: audioSecTotal + introOffsetSec + outroSec,
		qcScore: qc.score,
	};
}

export function previousArtifacts(
	manifestPath: string,
	specFingerprint: string,
): SeniorArtifactRecord[] {
	try {
		const parsed = JSON.parse(
			readFileSync(manifestPath, "utf8"),
		) as Partial<SeniorEpisodeManifest>;
		if (
			parsed.specFingerprint !== specFingerprint ||
			!Array.isArray(parsed.artifacts)
		)
			return [];
		return parsed.artifacts.flatMap((artifact) => {
			if (
				!artifact ||
				(artifact.format !== "shorts" && artifact.format !== "longform") ||
				(artifact.status !== "assets_ready" &&
					artifact.status !== "verified") ||
				typeof artifact.fingerprint !== "string" ||
				!artifact.paths ||
				typeof artifact.paths !== "object"
			)
				return [];
			const existingPaths = Object.fromEntries(
				Object.entries(artifact.paths).filter(
					(entry): entry is [string, string] =>
						typeof entry[1] === "string" && existsSync(entry[1]),
				),
			) as Partial<SeniorArtifactPaths>;
			if (Object.keys(existingPaths).length === 0) return [];
			const stillVerified = Boolean(
				existingPaths.video &&
					existingPaths.verifyReport &&
					existingPaths.renderQc,
			);
			return [
				{
					...artifact,
					status: stillVerified ? "verified" : "assets_ready",
					paths: existingPaths,
				} as SeniorArtifactRecord,
			];
		});
	} catch {
		return [];
	}
}

export function mergeArtifactRecords(
	previous: SeniorArtifactRecord[],
	current: SeniorArtifactRecord[],
): SeniorArtifactRecord[] {
	const byFormat = new Map<SeniorFormat, SeniorArtifactRecord>();
	for (const artifact of previous) byFormat.set(artifact.format, artifact);
	for (const artifact of current) byFormat.set(artifact.format, artifact);
	return (["shorts", "longform"] as const)
		.map((format) => byFormat.get(format))
		.filter((artifact): artifact is SeniorArtifactRecord => Boolean(artifact));
}

export async function makeSeniorMoneyEpisode(
	spec: SeniorEpisodeSpec,
	options: {
		format?: SeniorFormat | "both";
		outDir?: string;
		force?: boolean;
		assetsOnly?: boolean;
		adoptExisting?: boolean;
	} = {},
): Promise<void> {
	validateSeniorEpisodeSpec(spec);
	const format = options.format ?? "both";
	const outDir = resolve(options.outDir ?? join(DEFAULT_OUTPUT_ROOT, spec.id));
	mkdirSync(outDir, { recursive: true });

	const selected: SeniorFormat[] =
		format === "both" ? ["shorts", "longform"] : [format];
	const artifacts: SeniorArtifactRecord[] = [];
	for (const item of selected)
		artifacts.push(
			await renderFormat(
				spec,
				item,
				outDir,
				options.force ?? false,
				options.assetsOnly ?? false,
				options.adoptExisting ?? false,
			),
		);

	const manifestPath = join(outDir, "episode.manifest.json");
	const specFingerprint = seniorEpisodeFingerprint(spec);
	const mergedArtifacts = mergeArtifactRecords(
		previousArtifacts(manifestPath, specFingerprint),
		artifacts,
	);
	writeTextAtomic(
		manifestPath,
		`${JSON.stringify(
			{
				generatedAt: new Date().toISOString(),
				id: spec.id,
				brand: spec.brand,
				topic: spec.topic,
				factualAsOf: spec.factualAsOf,
				specFingerprint,
				reference: spec.reference,
				sources: spec.sources,
				disclosure: spec.disclosure,
				artifacts: mergedArtifacts,
			},
			null,
			2,
		)}\n`,
	);
	log(`\n완성 폴더: ${outDir}`);
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const format = (args.format ?? "both") as SeniorFormat | "both";
	if (!["shorts", "longform", "both"].includes(format))
		throw new Error("--format은 shorts, longform, both 중 하나여야 합니다.");
	const specPath = resolve(args.spec ?? DEFAULT_SPEC);
	const spec = loadSeniorEpisodeSpec(specPath);
	await makeSeniorMoneyEpisode(spec, {
		format,
		outDir: args.out,
		force: args.force === "true",
		assetsOnly: args["assets-only"] === "true",
		adoptExisting: args["adopt-existing"] === "true",
	});
}

if (process.argv[1]?.endsWith("make-senior-money.ts")) {
	main().catch((error) => {
		process.stderr.write(
			`ERROR: ${error instanceof Error ? error.message : error}\n`,
		);
		process.exit(1);
	});
}
