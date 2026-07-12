import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildSeniorSrt,
	containsUnsafeSeniorClaim,
	isOfficialSourceUrl,
	loadSeniorEpisodeSpec,
	longformIntroBridgeFilter,
	mergeArtifactRecords,
	previousArtifacts,
	type SeniorArtifactRecord,
	seniorArtifactPaths,
	seniorAssetFingerprint,
	seniorFormatFingerprint,
	seniorRenderFingerprint,
	shouldRegenerateSeniorAssets,
	validateSeniorEpisodeSpec,
} from "./make-senior-money.ts";

describe("시니어 머니체크 에피소드 spec", () => {
	it("기본 에피소드는 안전 검사와 스키마 검사를 통과한다", () => {
		const spec = loadSeniorEpisodeSpec();
		expect(() => validateSeniorEpisodeSpec(spec)).not.toThrow();
		expect(spec.formats.shorts.scenes).toHaveLength(8);
		expect(spec.formats.longform.scenes.length).toBeGreaterThanOrEqual(10);
		expect(
			spec.sources.every((source) => source.url.startsWith("https://")),
		).toBe(true);
	});

	it("기초연금 지급액·자동 수급을 단정하는 표현을 거부한다", () => {
		expect(containsUnsafeSeniorClaim("247만 원을 지급합니다")).toBe(true);
		expect(containsUnsafeSeniorClaim("월급이 적으면 무조건 받습니다")).toBe(
			true,
		);
		expect(containsUnsafeSeniorClaim("신청 안 해도 자동 지급됩니다")).toBe(
			true,
		);
		expect(containsUnsafeSeniorClaim("1355 무료 상담", ["1355 무료"])).toBe(
			true,
		);
		expect(containsUnsafeSeniorClaim("247만 원은 지급액이 아닙니다")).toBe(
			false,
		);
	});

	it("공식 기관이 아닌 HTTPS 출처와 잘못된 중첩 스키마를 거부한다", () => {
		expect(isOfficialSourceUrl("https://www.nps.or.kr/example")).toBe(true);
		expect(isOfficialSourceUrl("https://example.com/policy")).toBe(false);

		const badSource = structuredClone(loadSeniorEpisodeSpec());
		badSource.sources[0].url = "https://example.com/policy";
		expect(() => validateSeniorEpisodeSpec(badSource)).toThrow(/공식 HTTPS/);

		const badLayout = structuredClone(loadSeniorEpisodeSpec());
		(badLayout.formats.shorts.scenes[0] as { layout: string }).layout =
			"unknown-layout";
		expect(() => validateSeniorEpisodeSpec(badLayout)).toThrow(/layout/);

		const unsafeClaim = structuredClone(loadSeniorEpisodeSpec());
		unsafeClaim.formats.shorts.scenes[0].narration =
			"349700원을 누구나 지급받습니다";
		expect(() => validateSeniorEpisodeSpec(unsafeClaim)).toThrow(/YMYL/);
	});

	it("spec 내용이 바뀌면 캐시 지문도 바뀐다", () => {
		const original = loadSeniorEpisodeSpec();
		const changed = structuredClone(original);
		changed.formats.shorts.scenes[0].narration += " 확인 문장";
		expect(seniorFormatFingerprint(original, "shorts")).not.toBe(
			seniorFormatFingerprint(changed, "shorts"),
		);
	});

	it("필수 사실은 쇼츠와 롱폼 각각에 존재해야 한다", () => {
		const spec = structuredClone(loadSeniorEpisodeSpec());
		spec.safety.requiredFacts.push("롱폼에만 있는 필수 사실");
		spec.formats.longform.scenes[0].narration += " 롱폼에만 있는 필수 사실";
		expect(() => validateSeniorEpisodeSpec(spec)).toThrow(/shorts 필수/);
	});

	it("공식 URL이어도 위험한 출처 제목은 거부한다", () => {
		const spec = structuredClone(loadSeniorEpisodeSpec());
		spec.sources[0].title = "100만 원을 누구나 지급합니다";
		expect(() => validateSeniorEpisodeSpec(spec)).toThrow(/YMYL/);
	});

	it("[HIGH] 금지 문구가 여러 조각에 분할돼도 장면 단위로 차단한다", () => {
		// forbiddenClaims 경로: UNSAFE_PATTERNS에 안 걸리는 문구를 두 줄로 쪼갠다.
		const spec = structuredClone(loadSeniorEpisodeSpec());
		spec.formats.shorts.scenes[1].lines.push(
			{ text: "특별", tone: "white", size: "md" },
			{ text: "배당금", tone: "white", size: "md" },
		);
		spec.safety.forbiddenClaims.push("특별 배당금");
		expect(() => validateSeniorEpisodeSpec(spec)).toThrow(/YMYL/);
		expect(() => validateSeniorEpisodeSpec(spec)).toThrow(/scenes\[1\]/);
	});

	it("[HIGH] 주어+지급동사가 조각으로 갈려도 합쳐서 UNSAFE 패턴에 걸린다", () => {
		const spec = structuredClone(loadSeniorEpisodeSpec());
		spec.formats.longform.scenes[0].lines.push(
			{ text: "누구나", tone: "white", size: "md" },
			{ text: "받습니다", tone: "white", size: "md" },
		);
		expect(() => validateSeniorEpisodeSpec(spec)).toThrow(/YMYL/);
	});

	it("[MEDIUM] 필수 사실이 설명·해시태그에만 있으면 화면 누락으로 거부한다", () => {
		const spec = structuredClone(loadSeniorEpisodeSpec());
		spec.safety.requiredFacts.push("전용확인문구");
		// 화면/나레이션이 아니라 유튜브 설명란·태그에만 존재 → 근거로 인정 안 됨
		spec.formats.shorts.description += " 전용확인문구";
		spec.formats.shorts.hashtags.push("전용확인문구");
		spec.formats.longform.description += " 전용확인문구";
		spec.formats.longform.hashtags.push("전용확인문구");
		expect(() => validateSeniorEpisodeSpec(spec)).toThrow(/필수 근거/);
	});

	it("[MEDIUM] 필수 사실이 실제 화면·나레이션에 있으면 통과한다", () => {
		const spec = structuredClone(loadSeniorEpisodeSpec());
		spec.safety.requiredFacts.push("전용확인문구");
		spec.formats.shorts.scenes[0].narration += " 전용확인문구";
		spec.formats.longform.scenes[0].narration += " 전용확인문구";
		expect(() => validateSeniorEpisodeSpec(spec)).not.toThrow();
	});

	it("[LOW] 구두점만인 금지 문구는 무시한다(조각 전면 오차단 방지)", () => {
		expect(containsUnsafeSeniorClaim("정상적인 문장입니다", ["···"])).toBe(
			false,
		);
		expect(containsUnsafeSeniorClaim("정상적인 문장입니다", ["!!!"])).toBe(
			false,
		);
		expect(containsUnsafeSeniorClaim("정상적인 문장입니다", ["—"])).toBe(false);
		// 실제 금지 문구가 함께 있으면 여전히 차단
		expect(
			containsUnsafeSeniorClaim("특별 배당금 안내", ["···", "특별 배당금"]),
		).toBe(true);
	});

	it("[LOW] 구두점만인 금지 문구가 전체 빌드를 오차단하지 않는다", () => {
		const spec = structuredClone(loadSeniorEpisodeSpec());
		spec.safety.forbiddenClaims.push("···");
		expect(() => validateSeniorEpisodeSpec(spec)).not.toThrow();
	});

	it("렌더 설정 변경은 TTS·카드 지문을 바꾸지 않는다", () => {
		const spec = loadSeniorEpisodeSpec();
		const oldScale = process.env.RENDER_SCALE;
		try {
			process.env.RENDER_SCALE = "1";
			const assetAtOne = seniorAssetFingerprint(spec, "longform");
			const renderAtOne = seniorRenderFingerprint(spec, "longform", assetAtOne);
			process.env.RENDER_SCALE = "2";
			const assetAtTwo = seniorAssetFingerprint(spec, "longform");
			const renderAtTwo = seniorRenderFingerprint(spec, "longform", assetAtTwo);
			expect(assetAtTwo).toBe(assetAtOne);
			expect(renderAtTwo).not.toBe(renderAtOne);
		} finally {
			if (oldScale === undefined) delete process.env.RENDER_SCALE;
			else process.env.RENDER_SCALE = oldScale;
		}
	});

	it("[P2] melo 엔드포인트(MELO_URL) 변경은 자산 지문을 무효화한다", () => {
		const spec = loadSeniorEpisodeSpec();
		const prevProvider = process.env.TTS_PROVIDER;
		const prevUrl = process.env.MELO_URL;
		try {
			process.env.TTS_PROVIDER = "melo";
			process.env.MELO_URL = "http://melo-a:8000/tts";
			const a = seniorAssetFingerprint(spec, "shorts");
			process.env.MELO_URL = "http://melo-b:9000/tts";
			const b = seniorAssetFingerprint(spec, "shorts");
			expect(a).not.toBe(b);
			// melo가 아니면 MELO_URL 변경은 지문에 영향이 없어야 한다(불필요 재생성 방지).
			process.env.TTS_PROVIDER = "edge";
			process.env.MELO_URL = "http://melo-a:8000/tts";
			const c = seniorAssetFingerprint(spec, "shorts");
			process.env.MELO_URL = "http://melo-b:9000/tts";
			const d = seniorAssetFingerprint(spec, "shorts");
			expect(c).toBe(d);
		} finally {
			if (prevProvider === undefined) delete process.env.TTS_PROVIDER;
			else process.env.TTS_PROVIDER = prevProvider;
			if (prevUrl === undefined) delete process.env.MELO_URL;
			else process.env.MELO_URL = prevUrl;
		}
	});
});

describe("시니어 영상 산출물 계약", () => {
	it("롱폼 SRT에 인트로 오프셋을 반영한다", () => {
		const srt = buildSeniorSrt(
			[
				{ narration: "첫 장면", durationSec: 2.5 },
				{ narration: "둘째 장면", durationSec: 3 },
			],
			3,
		);
		expect(srt).toContain("00:00:03,000 --> 00:00:05,500");
		expect(srt).toContain("00:00:05,500 --> 00:00:08,500");
	});

	it("쇼츠와 롱폼 파일 이름이 충돌하지 않는다", () => {
		const shorts = seniorArtifactPaths("/tmp/out", "episode", "shorts");
		const longform = seniorArtifactPaths("/tmp/out", "episode", "longform");
		expect(shorts.video).not.toBe(longform.video);
		expect(shorts.chapters).toBeUndefined();
		expect(longform.chapters).toContain("longform.chapters.txt");
		expect(shorts.verifyReport).toContain("shorts.verify_report.json");
	});

	it("롱폼 인트로 브리지는 검은 페이드 구간만 덮는다", () => {
		const filter = longformIntroBridgeFilter();
		expect(filter).toContain("st=2.50");
		expect(filter).toContain("between(t,2.50,3.20)");
		expect(filter).toContain("scale2ref=w=rw:h=rh");
		expect(filter).toContain("[video]");
		expect(() =>
			execFileSync(
				"ffmpeg",
				[
					"-v",
					"error",
					"-f",
					"lavfi",
					"-i",
					"color=blue:s=320x180:d=0.1:r=30",
					"-f",
					"lavfi",
					"-i",
					"color=red:s=640x360:d=0.1:r=30",
					"-filter_complex",
					filter,
					"-map",
					"[video]",
					"-frames:v",
					"1",
					"-f",
					"null",
					"-",
				],
				{ timeout: 5_000 },
			),
		).not.toThrow();
	});

	it("형식별 manifest 레코드를 덮어쓰지 않고 병합한다", () => {
		const record = (
			format: "shorts" | "longform",
			status: SeniorArtifactRecord["status"],
		): SeniorArtifactRecord => ({
			format,
			status,
			fingerprint: format,
			paths: { video: `/tmp/${format}.mp4` },
			durationSec: 10,
		});
		const merged = mergeArtifactRecords(
			[record("shorts", "verified")],
			[record("longform", "assets_ready")],
		);
		expect(merged.map((artifact) => artifact.format)).toEqual([
			"shorts",
			"longform",
		]);
		expect(merged[0].status).toBe("verified");
	});

	it("이전 manifest의 삭제된 경로를 제거하고 상태를 낮춘다", () => {
		const root = mkdtempSync(join(tmpdir(), "senior-manifest-"));
		try {
			const title = join(root, "title.txt");
			const manifest = join(root, "episode.manifest.json");
			writeFileSync(title, "title");
			writeFileSync(
				manifest,
				JSON.stringify({
					specFingerprint: "spec",
					artifacts: [
						{
							format: "longform",
							status: "verified",
							fingerprint: "render",
							paths: { title, video: join(root, "missing.mp4") },
							durationSec: 10,
						},
					],
				}),
			);
			const [artifact] = previousArtifacts(manifest, "spec");
			expect(artifact.status).toBe("assets_ready");
			expect(artifact.paths.video).toBeUndefined();
			expect(artifact.paths.title).toBe(title);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("[MEDIUM] --adopt-existing 지문 가드", () => {
	const base = {
		force: false,
		adoptExisting: true,
		existingSceneAssets: true,
		thumbnailExists: true,
		storedFingerprintPresent: true,
	};

	it("지문이 존재하는데 불일치하면 낡은 자산을 채택하지 않고 재생성한다", () => {
		expect(shouldRegenerateSeniorAssets({ ...base, assetsMatch: false })).toBe(
			true,
		);
	});

	it("지문 파일이 없으면(레거시 마이그레이션) adopt-existing으로 기존 자산을 채택한다", () => {
		expect(
			shouldRegenerateSeniorAssets({
				...base,
				assetsMatch: false,
				storedFingerprintPresent: false,
			}),
		).toBe(false);
	});

	it("지문이 없어도 adopt-existing이 아니면 재생성한다", () => {
		expect(
			shouldRegenerateSeniorAssets({
				...base,
				adoptExisting: false,
				assetsMatch: false,
				storedFingerprintPresent: false,
			}),
		).toBe(true);
	});

	it("지문 일치 시 재생성하지 않는다", () => {
		expect(shouldRegenerateSeniorAssets({ ...base, assetsMatch: true })).toBe(
			false,
		);
	});

	it("force면 지문이 일치해도 재생성한다", () => {
		expect(
			shouldRegenerateSeniorAssets({
				...base,
				assetsMatch: true,
				force: true,
			}),
		).toBe(true);
	});

	it("adopt-existing 없이 지문 불일치면 재생성한다", () => {
		expect(
			shouldRegenerateSeniorAssets({
				...base,
				adoptExisting: false,
				assetsMatch: false,
			}),
		).toBe(true);
	});

	it("adopt-existing이라도 디스크 자산이 없으면 재생성한다", () => {
		expect(
			shouldRegenerateSeniorAssets({
				...base,
				assetsMatch: false,
				existingSceneAssets: false,
			}),
		).toBe(true);
	});
});
