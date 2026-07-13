import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
	articleGroundedSceneIndices,
	assertGroundedClaimsForPlan,
	audioStretchFactor,
	buildEconomyRealDescription,
	buildEconomyRealFingerprint,
	buildEconomyRealSrt,
	buildGroundedBeats,
	buildHookVisualPlan,
	buildLegacyEconomyRealFingerprintV3,
	buildSourceSnapshotHash,
	canReuseGeneratedAssets,
	chartSceneFigureViolations,
	economyRealOutputPaths,
	economyRealRenderConfigKey,
	estimateRenderedShortsSec,
	finalQcFailures,
	findGroundingModalityViolations,
	findYmylViolation,
	firstExistingPath,
	generationPlanMatchesManifest,
	groundedNarrations,
	hookVisualContractFailures,
	isMainModule,
	isStrongRenderQcAcceptable,
	loadGenerationPlanJson,
	looksLikeAdvice,
	meloTtsCandidates,
	parseEconomyRealArgs,
	parseGenerationPlanJson,
	parseLegacyGenerationPlanJson,
	parseLegacyManifestJson,
	parseSourceFileJson,
	readSourceArticle,
	refreshGenerationPlanRenderContract,
	requireLegacyGroundingBody,
	resolveEconomyRealWorkDir,
	shortsAudioNormalizationTarget,
} from "./make-economy-real.ts";
import type { VerifyReport } from "./verify-output.ts";

const ARTICLE = {
	title: "한국은행 기준금리 동결",
	link: "https://example.com/economy/1",
	description: "물가와 성장 경로를 함께 점검했다.",
	pubDate: "2026-07-10",
};

describe("CLI / 고정 source-file", () => {
	let dir = "";
	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
		dir = "";
	});

	it("공용 parseArgs 의미대로 --source-file 과 --out 을 읽는다", () => {
		expect(
			parseEconomyRealArgs([
				"--source-file",
				"source.json",
				"--out",
				"renders/job-1",
			]),
		).toEqual({
			sample: false,
			sourceFile: "source.json",
			out: "renders/job-1",
		});
	});

	it("값 누락과 sample/source 충돌은 조용히 폴백하지 않는다", () => {
		expect(() => parseEconomyRealArgs(["--source-file"])).toThrow(/값/);
		expect(() => parseEconomyRealArgs(["--out"])).toThrow(/값/);
		expect(() =>
			parseEconomyRealArgs(["--sample", "--source-file", "source.json"]),
		).toThrow(/함께/);
	});

	it("{article:{...}} JSON의 기사를 그대로 반환한다", () => {
		expect(parseSourceFileJson(JSON.stringify({ article: ARTICLE }))).toEqual(
			ARTICLE,
		);
	});

	it("파일 읽기 경계도 동일한 검증기를 사용한다", () => {
		dir = mkdtempSync(join(tmpdir(), "economy-real-source-"));
		const path = join(dir, "source.json");
		writeFileSync(path, JSON.stringify({ article: ARTICLE }));
		expect(readSourceArticle(path)).toEqual(ARTICLE);
		expect(() => readSourceArticle(join(dir, "missing.json"))).toThrow(
			/source-file 읽기 실패/,
		);
	});

	it("깨진 JSON/비 HTTP 기사 URL은 fail-closed", () => {
		expect(() => parseSourceFileJson("{")).toThrow(/JSON 파싱 실패/);
		expect(() =>
			parseSourceFileJson(
				JSON.stringify({ article: { ...ARTICLE, link: "file:///tmp/a" } }),
			),
		).toThrow(/형식 오류/);
	});

	it("공용 공개 HTTPS 정책과 64KiB 파일 상한을 우회하지 않는다", () => {
		for (const link of [
			"http://example.com/economy/1",
			"https://localhost/economy/1",
			"https://127.0.0.1/economy/1",
			"https://user:pass@example.com/economy/1",
			"https://example.com:444/economy/1",
		]) {
			expect(() =>
				parseSourceFileJson(JSON.stringify({ article: { ...ARTICLE, link } })),
			).toThrow(/public HTTPS/);
		}
		dir = mkdtempSync(join(tmpdir(), "economy-real-large-source-"));
		const path = join(dir, "source.json");
		writeFileSync(path, " ".repeat(65 * 1024));
		expect(() => readSourceArticle(path)).toThrow(/64 KiB/);
	});
});

describe("출력 경로 / 재실행 계획", () => {
	it("--out 은 timestamp 하위가 아니라 지정 디렉터리 자체로 고정", () => {
		expect(
			resolveEconomyRealWorkDir({
				out: "runs/fixed",
				sample: false,
				stamp: "202607101200",
				projectRoot: "/repo/boltYT",
				cwd: "/workspace",
			}),
		).toBe("/workspace/runs/fixed");
	});

	it("--out 미지정은 기존 timestamp 디렉터리 규칙 유지", () => {
		expect(
			resolveEconomyRealWorkDir({
				sample: true,
				stamp: "202607101200",
				projectRoot: "/repo/boltYT",
				cwd: "/workspace",
			}),
		).toBe("/repo/boltYT/output/economy-real/sam-202607101200");
	});

	it("영상/SRT/썸네일/title/description/platform_meta 경로가 같은 stem", () => {
		const paths = economyRealOutputPaths("/tmp/job");
		expect(paths.video).toBe("/tmp/job/economy-real-short.mp4");
		expect(paths.srt).toBe("/tmp/job/economy-real-short.srt");
		expect(paths.thumbnail).toBe("/tmp/job/economy-real-short_thumb.jpg");
		expect(paths.title).toBe("/tmp/job/economy-real-short.title.txt");
		expect(paths.description).toBe(
			"/tmp/job/economy-real-short.description.txt",
		);
		expect(paths.platformMeta).toBe(
			"/tmp/job/economy-real-short.platform_meta.json",
		);
		expect(paths.renderQc).toBe("/tmp/job/economy-real-short.render_qc.json");
	});

	it("저장 계획은 다섯 나레이션과 기사/YMYL을 다시 검증", () => {
		const plan = {
			version: 1,
			mode: "grounded",
			article: ARTICLE,
			videoTitle: ARTICLE.title,
			attribution: "Example",
			narrations: ["하나", "둘", "셋", "넷", "다섯"],
		};
		const migrated = parseGenerationPlanJson(JSON.stringify(plan));
		expect(migrated.article).toEqual(ARTICLE);
		expect(migrated.version).toBe(3);
		expect(migrated.fingerprint).toMatch(/^[a-f0-9]{64}$/);
		expect(() =>
			parseGenerationPlanJson(
				JSON.stringify({ ...plan, narrations: ["하나", "둘"] }),
			),
		).toThrow(/나레이션/);
		expect(() =>
			parseGenerationPlanJson(
				JSON.stringify({
					...plan,
					version: 3,
					grounding: { body: ARTICLE.description, related: [] },
				}),
			),
		).toThrow(/fingerprint 계약 누락/);
	});

	it("구버전 manifest의 기사/나레이션을 재실행 계획으로 승격", () => {
		const plan = parseLegacyManifestJson(
			JSON.stringify({
				grounded: false,
				title: "삼성전자 시장은 어떻게 볼까?",
				attribution: "Example",
				articleUrl: ARTICLE.link,
				beats: ["하나", "둘", "셋", "넷", "다섯"].map((narration) => ({
					narration,
				})),
			}),
		);
		expect(plan.mode).toBe("sample");
		expect(plan.article.link).toBe(ARTICLE.link);
		expect(plan.narrations).toEqual(["하나", "둘", "셋", "넷", "다섯"]);
	});

	it("마지막 manifest와 계획의 대본이 다르면 음성/렌더 재사용 금지", () => {
		const plan = parseGenerationPlanJson(
			JSON.stringify({
				version: 1,
				mode: "grounded",
				article: ARTICLE,
				videoTitle: ARTICLE.title,
				attribution: "Example",
				narrations: ["하나", "둘", "셋", "넷", "다섯"],
			}),
		);
		const manifest = (secondNarration: string) =>
			JSON.stringify({
				fingerprint: plan.fingerprint,
				sourceSnapshotHash: plan.sourceSnapshotHash,
				title: ARTICLE.title,
				article: ARTICLE,
				beats: ["하나", secondNarration, "셋", "넷", "다섯"].map(
					(narration) => ({ narration }),
				),
				assetContract: {
					fingerprint: plan.fingerprint,
					renderConfigKey: plan.renderConfigKey,
					assets: plan.narrations.map((_, index) => ({
						id: String(index),
						fingerprint: plan.fingerprint,
					})),
				},
			});
		expect(generationPlanMatchesManifest(manifest("둘"), plan)).toBe(true);
		expect(
			generationPlanMatchesManifest(manifest("40조 원을 조달합니다"), plan),
		).toBe(false);
		expect(canReuseGeneratedAssets(plan, manifest("둘"))).toBe(true);
		expect(canReuseGeneratedAssets(plan, undefined)).toBe(false);
		expect(canReuseGeneratedAssets(plan, "")).toBe(false);
		const staleAsset = JSON.parse(manifest("둘")) as {
			assetContract: { assets: Array<{ fingerprint: string }> };
		};
		staleAsset.assetContract.assets[0].fingerprint = "stale";
		expect(canReuseGeneratedAssets(plan, JSON.stringify(staleAsset))).toBe(
			false,
		);
	});

	it("source/prompt-plan/narration/render config fingerprint가 결정적으로 stale을 무효화", () => {
		const sourceA = buildSourceSnapshotHash(ARTICLE, "기사 본문 A");
		const sourceB = buildSourceSnapshotHash(ARTICLE, "기사 본문 B");
		const renderA = economyRealRenderConfigKey({ TTS_SPEED: "0.9" });
		const renderB = economyRealRenderConfigKey({ TTS_SPEED: "1.0" });
		const base = {
			article: ARTICLE,
			videoTitle: ARTICLE.title,
			attribution: "Example 경제",
			sourceSnapshotHash: sourceA,
			narrations: ["하나", "둘", "셋", "넷", "다섯"],
			renderConfigKey: renderA,
		};
		const fingerprint = buildEconomyRealFingerprint(base);
		expect(buildEconomyRealFingerprint(base)).toBe(fingerprint);
		expect(
			buildEconomyRealFingerprint({ ...base, sourceSnapshotHash: sourceB }),
		).not.toBe(fingerprint);
		expect(
			buildEconomyRealFingerprint({
				...base,
				narrations: ["하나", "변경", "셋", "넷", "다섯"],
			}),
		).not.toBe(fingerprint);
		expect(
			buildEconomyRealFingerprint({ ...base, renderConfigKey: renderB }),
		).not.toBe(fingerprint);
		expect(
			buildEconomyRealFingerprint({
				...base,
				videoTitle: "기준금리 동결의 시장 영향",
			}),
		).not.toBe(fingerprint);
		// attribution(출처 로워서드)만 달라져도 지문이 갱신되어야 낡은 출처표기 영상 재사용을 막는다.
		expect(
			buildEconomyRealFingerprint({ ...base, attribution: "다른 언론사" }),
		).not.toBe(fingerprint);
		expect(
			buildEconomyRealFingerprint({
				...base,
				article: { ...ARTICLE, description: "수정된 source snapshot" },
			}),
		).not.toBe(fingerprint);
	});

	it("구형 v3 지문과 변경된 Melo/title 계약은 로드하되 자산을 불신하고 갱신", () => {
		const body = ARTICLE.description;
		const related: never[] = [];
		const sourceSnapshotHash = buildSourceSnapshotHash(
			ARTICLE,
			JSON.stringify({ body, related }),
		);
		const oldRenderConfigKey =
			'{"bgm":"sfx/dark-ambient.mp3","canvas":"1080x1920","compositionId":"YouTubeShorts","contract":"economy-real-render-v3-hook-offthread-qc","fps":30,"hookVisual":"three-phase-0-1-2s","jpegQuality":100,"offthreadVideo":true,"renderScale":1,"subtitles":"chunked-pill-gold","ttsSpeed":0.9}';
		const narrations = ["하나", "둘", "셋", "넷", "다섯"];
		const fingerprint = buildLegacyEconomyRealFingerprintV3({
			article: ARTICLE,
			sourceSnapshotHash,
			narrations,
			renderConfigKey: oldRenderConfigKey,
		});
		const storedPlan = {
			version: 3,
			mode: "grounded",
			article: ARTICLE,
			videoTitle: ARTICLE.title,
			attribution: "Example",
			narrations,
			grounding: { body, related },
			sourceSnapshotHash,
			renderConfigKey: oldRenderConfigKey,
			fingerprint,
		};
		const currentRenderConfigKey = economyRealRenderConfigKey({
			MELO_TTS: "/opt/new-melo/tts-melo.sh",
		});
		const loaded = loadGenerationPlanJson(
			JSON.stringify(storedPlan),
			currentRenderConfigKey,
		);
		expect(loaded.fingerprintContract).toBe("legacy-v3");
		expect(loaded.trustedForAssetReuse).toBe(false);
		expect(loaded.plan.fingerprint).not.toBe(fingerprint);

		const refreshed = refreshGenerationPlanRenderContract(
			loaded.plan,
			currentRenderConfigKey,
		);
		expect(refreshed.renderConfigKey).toBe(currentRenderConfigKey);
		const oldManifest = JSON.stringify({
			fingerprint,
			sourceSnapshotHash,
			title: ARTICLE.title,
			article: ARTICLE,
			beats: narrations.map((narration) => ({ narration })),
			assetContract: {
				fingerprint,
				renderConfigKey: oldRenderConfigKey,
				assets: narrations.map((_, index) => ({
					id: String(index),
					fingerprint,
				})),
			},
		});
		const trustedAssetReuse =
			loaded.trustedForAssetReuse &&
			canReuseGeneratedAssets(refreshed, oldManifest);
		expect(trustedAssetReuse).toBe(false);
		expect(canReuseGeneratedAssets(refreshed, oldManifest)).toBe(false);
		expect(() =>
			loadGenerationPlanJson(
				JSON.stringify({
					...storedPlan,
					narrations: ["변조된 하나", "둘", "셋", "넷", "다섯"],
				}),
				currentRenderConfigKey,
			),
		).toThrow(/fingerprint 불일치/);
	});
});

describe("sample 백엔드-free LLM 게이트 분기", () => {
	const grounding = { primary: ARTICLE, body: "기사 본문", related: [] };

	it("sample 계획은 LLM 백스톱(assertGroundedEconomyClaims)을 호출하지 않음", async () => {
		let calls = 0;
		await assertGroundedClaimsForPlan(
			{ mode: "sample", grounding },
			["아무 나레이션"],
			async () => {
				calls += 1;
			},
		);
		expect(calls).toBe(0);
	});

	it("grounded 계획은 LLM 백스톱을 호출함", async () => {
		let calls = 0;
		await assertGroundedClaimsForPlan(
			{ mode: "grounded", grounding },
			["아무 나레이션"],
			async () => {
				calls += 1;
			},
		);
		expect(calls).toBe(1);
	});
});

describe("YMYL / 비트 / 업로드 텍스트", () => {
	it("사실 서술형 수급은 허용하고 권유·예측은 차단", () => {
		expect(looksLikeAdvice("외국인 순매수와 기관 매도세가 엇갈렸다")).toBe(
			false,
		);
		expect(looksLikeAdvice("지금 매수하세요")).toBe(true);
		expect(
			findYmylViolation({
				title: "시장 정리",
				narrations: ["사실을 봅니다", "반드시 오를 전망입니다"],
			}),
		).toBe("narration:2");
	});

	it("명령형 매수/매도(해야·하라)는 차단하되 수급 사실은 허용", () => {
		// 명령형 권유는 잡는다 (기존 정규식은 '하세요'만 잡고 '해야/하라'는 놓쳤다).
		expect(looksLikeAdvice("지금 우량주를 매수해야 합니다")).toBe(true);
		expect(looksLikeAdvice("이 종목은 매도해야 합니다")).toBe(true);
		expect(looksLikeAdvice("지금 당장 매수하라")).toBe(true);
		expect(looksLikeAdvice("보유 물량을 전부 매도하라")).toBe(true);
		// 사실 서술형 수급 용어는 계속 허용(오탐 금지).
		expect(looksLikeAdvice("외국인 순매수가 이어졌다")).toBe(false);
		expect(looksLikeAdvice("기관 매도세가 강했다")).toBe(false);
		expect(looksLikeAdvice("외국인 순매수와 기관 매도세가 엇갈렸다")).toBe(
			false,
		);
	});

	it("출처의 기대/추진 기업 이벤트를 완료 사실로 승격하지 않음", () => {
		const source = {
			title: "하이닉스 ADR 상장 기대, 40조 조달 추진",
			description: "해외 자금 유입 가능성도 거론됐다.",
		};
		expect(
			findGroundingModalityViolations(source, [
				"회사는 40조 원을 조달합니다.",
				"ADR에 상장됩니다.",
				"해외 자금이 유입됩니다.",
			]),
		).toEqual([0, 1, 2]);
		expect(
			findGroundingModalityViolations(source, [
				"회사는 40조 원 조달을 추진합니다.",
				"ADR 상장이 기대됩니다.",
				"해외 자금 유입 가능성이 거론됩니다.",
			]),
		).toEqual([]);
		// 기업 이벤트가 아닌 확정된 시장 관측은 오탐하지 않는다.
		expect(
			findGroundingModalityViolations(source, ["원·달러 환율이 하락했습니다."]),
		).toEqual([]);
		const bodyOnlyGrounding = {
			primary: {
				...ARTICLE,
				title: "기업 신규 공장 관련 보도",
				description: "생산 능력 확대 방안을 살폈다.",
			},
			body: "회사는 신규 공장 투자를 검토하고 있다고 밝혔다.",
			related: [],
		};
		expect(
			findGroundingModalityViolations(bodyOnlyGrounding, [
				"회사는 신규 공장에 투자합니다.",
			]),
		).toEqual([0]);
	});

	it("재사용 generation-plan도 출처 확실성 위반이면 fail-closed", () => {
		const unsafePlan = {
			version: 1,
			mode: "grounded",
			article: {
				...ARTICLE,
				title: "ADR 상장 기대, 40조 조달 추진",
				description: "대규모 자금 조달 가능성이 거론됐다.",
			},
			videoTitle: "ADR 상장 추진 배경",
			attribution: "Example",
			narrations: ["회사는 40조 원을 조달합니다.", "둘", "셋", "넷", "다섯"],
		};
		expect(() => parseGenerationPlanJson(JSON.stringify(unsafePlan))).toThrow(
			/출처 확실성 위반/,
		);
		const legacyStructural = parseLegacyGenerationPlanJson(
			JSON.stringify(unsafePlan),
		);
		expect(legacyStructural.version).toBe(3);
		expect(
			findGroundingModalityViolations(
				{
					primary: unsafePlan.article,
					body: "회사는 ADR 상장을 검토하고 최대 40조 원 조달을 추진 중이다.",
					related: [],
				},
				legacyStructural.narrations,
			),
		).toEqual([0]);
		const bodyOnlyUnsafePlan = {
			...unsafePlan,
			article: {
				...ARTICLE,
				title: "기업 신규 공장 관련 보도",
				description: "생산 능력 확대 방안을 살폈다.",
			},
			videoTitle: "기업 신규 공장 검토 배경",
			grounding: {
				body: "회사는 신규 공장 투자를 검토하고 있다고 밝혔다.",
				related: [],
			},
			narrations: ["회사는 신규 공장에 투자합니다.", "둘", "셋", "넷", "다섯"],
		};
		expect(() =>
			parseGenerationPlanJson(JSON.stringify(bodyOnlyUnsafePlan)),
		).toThrow(/출처 확실성 위반/);
	});

	it("재사용 generation-plan에 출처 없는 숫자가 있으면 fail-closed", () => {
		const unsafePlan = {
			version: 1,
			mode: "grounded",
			article: {
				...ARTICLE,
				title: "코스피 1% 상승",
				description: "코스피가 1% 상승했다.",
			},
			videoTitle: "코스피 1% 상승",
			attribution: "Example",
			narrations: ["코스피가 20% 상승했습니다.", "둘", "셋", "넷", "다섯"],
		};
		expect(() => parseGenerationPlanJson(JSON.stringify(unsafePlan))).toThrow(
			/출처 숫자 위반/,
		);
	});

	it("legacy 계획은 본문 재수집이 비면 primary-only 근거로 승격하지 않음", () => {
		expect(() => requireLegacyGroundingBody(" \n\t ")).toThrow(
			/primary-only.*승격.*fail-closed/,
		);
		expect(requireLegacyGroundingBody("  실제   기사 본문  ")).toBe(
			"실제 기사 본문",
		);
	});

	it("고정 기사의 URL은 article 비트에 정확히 배선되고 chart 비트는 유지", () => {
		const beats = buildGroundedBeats(
			["하나", "둘", "셋", "넷", "다섯"],
			ARTICLE.link,
		);
		const articleBeat = beats.find((beat) => beat.asset.kind === "article");
		expect(articleBeat?.asset).toEqual({ kind: "article", url: ARTICLE.link });
		expect(beats.filter((beat) => beat.asset.kind === "chart")).toHaveLength(2);
	});

	it("설명문에 실제 기사 URL과 투자조언 면책이 함께 남는다", () => {
		const description = buildEconomyRealDescription({
			title: ARTICLE.title,
			attribution: "Example 경제",
			article: ARTICLE,
		});
		expect(description).toContain(ARTICLE.link);
		expect(description).toContain("Example 경제");
		expect(description).toContain("투자 조언이 아닙니다");
	});

	it("첫 3초에 대형 핵심 텍스트와 2회 시각 전환을 강제", () => {
		const hook = buildHookVisualPlan(
			"기준금리 3.5% 동결",
			"기준금리 숫자가 오늘 시장을 읽는 출발점입니다.",
		);
		expect(hook.frames[0].headline).toBe("3.5%");
		expect(hook.frames.map((frame) => frame.atSec)).toEqual([0, 1, 2]);
		expect(hookVisualContractFailures(hook)).toEqual([]);
		expect(
			hookVisualContractFailures({ ...hook, frames: hook.frames.slice(0, 2) }),
		).toContain("hook-visual-changes");
	});
});

describe("SRT / 출고 QC", () => {
	it("Shorts 카드 오프셋 없이 0초부터 누적 SRT 생성", () => {
		const srt = buildEconomyRealSrt([
			{ narration: "첫 장면", durationSec: 1.5 },
			{ narration: "둘째 장면", durationSec: 2.25 },
		]);
		expect(srt).toContain("00:00:00,000 --> 00:00:01,500");
		expect(srt).toContain("00:00:01,500 --> 00:00:03,750");
		expect(srt).toContain("첫 장면");
		expect(srt.endsWith("\n")).toBe(true);
	});

	const report = (checks: VerifyReport["checks"], ok = true): VerifyReport => ({
		ok,
		checks,
		reportPath: "/tmp/report.json",
	});
	const allChecks: VerifyReport["checks"] = [
		{ name: "video-duration", ok: true },
		{ name: "srt-tail", ok: true },
		{ name: "cut-count", ok: true },
		{ name: "contact-sheet", ok: true },
	];

	it("60초/자막/컷/contact sheet가 모두 있어야 통과", () => {
		expect(finalQcFailures(report(allChecks), 59.9)).toEqual([]);
		expect(finalQcFailures(report(allChecks), 44.99)).toContain(
			"duration-under:44.99",
		);
		expect(finalQcFailures(report(allChecks), 60.01)).toContain(
			"duration:60.01",
		);
		expect(
			finalQcFailures(
				report(
					allChecks.map((check) =>
						check.name === "contact-sheet" ? { ...check, ok: false } : check,
					),
				),
				59,
			),
		).toContain("contact-sheet");
		expect(
			finalQcFailures(
				report(allChecks.filter((check) => check.name !== "srt-tail")),
				59,
			),
		).toContain("srt-tail");
	});

	it("짧은 음성은 46초 목표 atempo로 보정하고 긴 음성은 건드리지 않음", () => {
		expect(audioStretchFactor(34.5)).toBeCloseTo(0.75);
		expect(audioStretchFactor(46)).toBe(1);
		expect(audioStretchFactor(52)).toBe(1);
	});

	it("59.9초 음성도 비트별 frame ceil을 반영해 안전 목표로 보정", () => {
		const durations = Array.from({ length: 5 }, () => 11.98);
		expect(durations.reduce((sum, duration) => sum + duration, 0)).toBeCloseTo(
			59.9,
		);
		// 각 11.98s → ceil(359.4f)=360f, 다섯 비트 실렌더는 정확히 60s.
		expect(estimateRenderedShortsSec(durations)).toBe(60);
		expect(shortsAudioNormalizationTarget(durations)).toBe(58);
		const factor = 59.9 / 58;
		const normalized = durations.map((duration) => duration / factor);
		expect(estimateRenderedShortsSec(normalized)).toBeLessThanOrEqual(59.8);
	});

	it("심층 렌더 QC는 85점 이상·issues 0건을 모두 요구", () => {
		const report = (
			width: number,
			height: number,
			score = 100,
			issues: string[] = [],
		) => ({ score, issues, metrics: { video: { width, height } } });
		expect(isStrongRenderQcAcceptable(report(1080, 1920, 85))).toBe(true);
		expect(isStrongRenderQcAcceptable(report(1080, 1920, 84))).toBe(false);
		expect(
			isStrongRenderQcAcceptable(report(1080, 1920, 100, ["black_segment"])),
		).toBe(false);
		// generic QC는 가로 1920x1080도 platform-ready로 보지만 real Shorts는 거부한다.
		expect(isStrongRenderQcAcceptable(report(1920, 1080))).toBe(false);
		expect(
			isStrongRenderQcAcceptable({
				score: 100,
				issues: [],
				metrics: { video: null },
			}),
		).toBe(false);
	});
});

describe("MeloTTS 탐색 / import guard", () => {
	it("실행 경로·언어·voice selector 변경은 render config key를 무효화", () => {
		const executableA = economyRealRenderConfigKey({
			MELO_TTS: "/opt/melo-a/tts-melo.sh",
			MELO_LANGUAGE: "kr",
			MELO_VOICE: "speaker-a",
		});
		const executableB = economyRealRenderConfigKey({
			MELO_TTS: "/opt/melo-b/tts-melo.sh",
			MELO_LANGUAGE: "kr",
			MELO_VOICE: "speaker-a",
		});
		expect(executableA).not.toBe(executableB);
		expect(JSON.parse(executableA)).toMatchObject({
			meloTtsOverride: "/opt/melo-a/tts-melo.sh",
			meloLanguage: "kr",
			meloVoice: "speaker-a",
		});
		expect(
			economyRealRenderConfigKey({
				MELO_TTS: "/opt/melo-a/tts-melo.sh",
				MELO_LANGUAGE: "en",
				TTS_VOICE: "speaker-b",
			}),
		).not.toBe(executableA);
	});

	it("환경변수 다음 repo/local 후보 순서이고 사용자명 하드코딩이 없다", () => {
		const candidates = meloTtsCandidates({
			envPath: "/custom/melo.sh",
			projectRoot: "/workspace/boltYT",
			homeDir: "/home/tester",
		});
		expect(candidates[0]).toBe("/custom/melo.sh");
		expect(candidates[1]).toBe("/workspace/boltYT/scripts/tts-melo.sh");
		expect(candidates).toContain("/home/tester/.local/bin/tts-melo.sh");
		expect(candidates.join(" ")).not.toContain("/Users/jjuni");
		expect(
			firstExistingPath(candidates, (path) =>
				path.endsWith("/.local/bin/tts-melo.sh"),
			),
		).toBe("/home/tester/.local/bin/tts-melo.sh");
	});

	it("실행 엔트리와 import를 절대경로로 구분", () => {
		const file = "/workspace/scripts/make-economy-real.ts";
		expect(isMainModule(pathToFileURL(file).href, file)).toBe(true);
		expect(
			isMainModule(pathToFileURL(file).href, "/workspace/scripts/test.ts"),
		).toBe(false);
		expect(isMainModule(pathToFileURL(file).href, undefined)).toBe(false);
	});
});

describe("groundedNarrations 재생성 루프(YMYL 게이트 fail-closed)", () => {
	const grounding = {
		primary: {
			title: "삼성전자 공장 가동",
			link: "https://n.news.naver.com/x",
			description: "요약",
			pubDate: "",
		},
		// 본문에 modality 마커(기대/전망/추진 등) 없음 → 확실성 게이트는 항상 통과.
		body: "삼성전자가 신규 공장 가동을 시작했다 생산량이 늘었다고 회사가 밝혔다 시장 관계자들이 논평했다",
		related: [],
	};
	// 숫자·투자조언 없음 → 결정적 게이트 통과.
	const clean = [
		"삼성전자가 공장 가동을 시작했다",
		"생산량이 늘었다고 회사가 밝혔다",
		"시장이 반응했다",
		"전문가들이 분석했다",
		"투자자들이 주목했다",
	];

	it("결정적·LLM 게이트를 모두 통과하면 첫 시도에 반환한다", async () => {
		let gen = 0;
		let aud = 0;
		const out = await groundedNarrations(grounding, {
			generate: async () => {
				gen++;
				return clean;
			},
			audit: async () => {
				aud++;
				return [];
			},
		});
		expect(out).toEqual(clean);
		expect(gen).toBe(1);
		expect(aud).toBe(1);
	});

	it("LLM 대조 실패 시 위반을 피드백해 재생성하고 통과하면 반환한다", async () => {
		let gen = 0;
		// index 4 = payoff(card, 기사-근거 씬) — 차트 씬이 아니어야 재생성이 유발된다.
		const auditResults: number[][] = [[4], []];
		const out = await groundedNarrations(grounding, {
			generate: async () => {
				gen++;
				return clean;
			},
			audit: async () => auditResults.shift() ?? [],
			log: () => {},
		});
		expect(out).toEqual(clean);
		expect(gen).toBe(2);
	});

	it("본문에 없는 수치는 숫자 게이트가 잡아 재생성하고, 그 시도엔 LLM 대조를 부르지 않는다", async () => {
		let aud = 0;
		const gens: string[][] = [
			["삼성전자가 87654억을 조달했다", ...clean.slice(1)],
			clean,
		];
		const out = await groundedNarrations(grounding, {
			generate: async () => gens.shift() ?? clean,
			audit: async () => {
				aud++;
				return [];
			},
			log: () => {},
		});
		expect(out).toEqual(clean);
		expect(aud).toBe(1);
	});

	it("결정적 게이트(투자조언) 실패 시 그 시도에선 비싼 LLM 대조를 호출하지 않는다", async () => {
		let aud = 0;
		const gens: string[][] = [["지금 사야 합니다", ...clean.slice(1)], clean];
		const out = await groundedNarrations(grounding, {
			generate: async () => gens.shift() ?? clean,
			audit: async () => {
				aud++;
				return [];
			},
			log: () => {},
		});
		expect(out).toEqual(clean);
		expect(aud).toBe(1);
	});

	it("maxAttempts 내에 통과 못하면 fail-closed 로 throw 한다(미근거 나레이션 렌더 금지)", async () => {
		let gen = 0;
		await expect(
			groundedNarrations(grounding, {
				generate: async () => {
					gen++;
					return clean;
				},
				audit: async () => [1],
				maxAttempts: 3,
				log: () => {},
			}),
		).rejects.toThrow(/fail-closed/);
		expect(gen).toBe(3);
	});

	it("articleGroundedSceneIndices 는 차트 씬(코스피/코스닥)을 근거 게이트에서 제외한다", () => {
		const idx = articleGroundedSceneIndices();
		expect(idx.has(0)).toBe(true); // hook (card)
		expect(idx.has(1)).toBe(true); // evidence (article)
		expect(idx.has(2)).toBe(false); // chart-kospi
		expect(idx.has(3)).toBe(false); // chart-kosdaq
		expect(idx.has(4)).toBe(true); // payoff (card)
	});

	it("차트 씬에 구체 수치가 있으면 미검증 수치로 재생성한다(조작 차단)", async () => {
		let gen = 0;
		// index 2 = chart-kospi 에 숫자 → 기사·차트로 검증 불가한 구체 수치는 금지.
		const chartDirty = [
			clean[0],
			clean[1],
			"코스피가 87654포인트를 기록했다",
			clean[3],
			clean[4],
		];
		const gens: string[][] = [chartDirty, clean];
		const out = await groundedNarrations(grounding, {
			generate: async () => {
				gen++;
				return gens.shift() ?? clean;
			},
			audit: async () => [],
			log: () => {},
		});
		expect(out).toEqual(clean);
		expect(gen).toBe(2);
	});

	it("chartSceneFigureViolations 는 차트 씬 숫자만 잡고 기사 씬 숫자는 무시한다", () => {
		const narr = [
			"삼성전자가 3조를 조달했다", // 0 hook(기사 씬) — 여기 숫자는 기사 대조 대상
			clean[1],
			"코스피 2500 돌파", // 2 chart-kospi — 미검증 수치 위반
			clean[3],
			clean[4],
		];
		expect(chartSceneFigureViolations(narr)).toEqual([2]);
	});

	it("차트 씬만 LLM 미대조로 지목되면 무시하고 통과한다", async () => {
		let gen = 0;
		const out = await groundedNarrations(grounding, {
			generate: async () => {
				gen++;
				return clean;
			},
			audit: async () => [2, 3], // 차트 씬만 → 필터링돼 통과
			log: () => {},
		});
		expect(out).toEqual(clean);
		expect(gen).toBe(1);
	});
});
