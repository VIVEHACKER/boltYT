import {
	closeSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildStudioJobs,
	canCommitEpisode,
	commitEpisodeReservation,
	createReservationSignalHandler,
	type EpisodeManifest,
	isReservationLeaseActive,
	normalizeStudioOptions,
	parseReservationLedger,
	parseUsedLedger,
	type ReservedEpisode,
	reclaimStaleLockFile,
	releaseEpisodeReservation,
	reserveEpisodeSource,
	resolveEpisodePaths,
	resolveServiceEndpoints,
	resolveStudioLedgerPaths,
	stopStartedServices,
} from "./economy-studio.ts";

const SOURCE = "/tmp/economy/source.json";
const RUN = "/tmp/economy/run-1";

afterEach(() => vi.unstubAllEnvs());

function sourceJson(link: string, title = "경제 기사 제목"): string {
	return `${JSON.stringify(
		{
			version: 1,
			selectedAt: "2026-07-10T00:00:00.000Z",
			article: {
				title,
				link,
				description: "기사 요약",
				pubDate: "2026-07-10T00:00:00.000Z",
			},
			feeds: ["https://example.com/feed.xml"],
		},
		null,
		2,
	)}\n`;
}

function writeCompleteManifest(reserved: ReservedEpisode): void {
	mkdirSync(dirname(reserved.paths.manifestFile), { recursive: true });
	const timestamp = "2026-07-10T00:00:00.000Z";
	writeFileSync(
		reserved.paths.manifestFile,
		`${JSON.stringify({
			version: 1,
			id: reserved.id,
			leaseId: reserved.reservation.leaseId,
			createdAt: timestamp,
			updatedAt: timestamp,
			status: "complete",
			sourceFile: reserved.paths.sourceFile,
			article: reserved.source.article,
			requestedFormats: ["shorts", "longform"],
			outputs: {
				shorts: {
					status: "complete",
					style: "illustrated",
					video: "/tmp/s.mp4",
					srt: "/tmp/s.srt",
					thumbnail: "/tmp/s_thumb.jpg",
					metadata: "/tmp/s.platform_meta.json",
					renderQc: "/tmp/s.render_qc.json",
					verifyReport: "/tmp/s.verify_report.json",
				},
				longform: {
					status: "complete",
					style: "illustrated",
					video: "/tmp/l.mp4",
					srt: "/tmp/l.srt",
					thumbnail: "/tmp/l_thumb.jpg",
					metadata: "/tmp/l.platform_meta.json",
					renderQc: "/tmp/l.render_qc.json",
					verifyReport: "/tmp/l.verify_report.json",
				},
			},
		})}\n`,
	);
}

describe("normalizeStudioOptions", () => {
	it("기본은 같은 기사로 쇼츠+롱폼 한 세트", () => {
		const options = normalizeStudioOptions([]);
		expect(options.format).toBe("both");
		expect(options.shortsStyle).toBe("illustrated");
		expect(options.minutes).toBe(8);
	});

	it("포맷·스타일·길이·토픽을 정규화", () => {
		const options = normalizeStudioOptions([
			"--format",
			"shorts",
			"--shorts-style",
			"real",
			"--minutes",
			"12",
			"--topic",
			"금리",
		]);
		expect(options).toMatchObject({
			format: "shorts",
			shortsStyle: "real",
			minutes: 12,
			topic: "금리",
		});
	});

	it("지원하지 않는 포맷과 비정상 길이는 즉시 거부", () => {
		expect(() => normalizeStudioOptions(["--format", "reels"])).toThrow(
			/format/i,
		);
		expect(() => normalizeStudioOptions(["--minutes", "0"])).toThrow(
			/minutes/i,
		);
	});
});

describe("buildStudioJobs", () => {
	it("illustrated both는 동일 source-file과 stamp로 두 포맷 생성", () => {
		const options = normalizeStudioOptions([
			"--channel",
			"경제 한입",
			"--minutes",
			"6",
		]);
		const jobs = buildStudioJobs(options, {
			runDir: RUN,
			sourceFile: SOURCE,
			stamp: 1234,
		});
		expect(jobs.map((job) => job.format)).toEqual(["shorts", "longform"]);
		for (const job of jobs) {
			expect(job.args).toContain(SOURCE);
			expect(job.env.SOURCE_DATE_EPOCH).toBe("1234");
		}
		expect(jobs[0].args).toContain("true");
		expect(jobs[1].args).toContain("false");
	});

	it("real shorts는 실사 생성기를 사용하고 longform은 grounded 생성기 유지", () => {
		const jobs = buildStudioJobs(
			normalizeStudioOptions(["--shorts-style", "real"]),
			{ runDir: RUN, sourceFile: SOURCE, stamp: 42 },
		);
		expect(jobs[0].script).toMatch(/make-economy-real\.ts$/);
		expect(jobs[1].script).toMatch(/make-economy\.ts$/);
	});

	it("서비스 URL trailing slash를 제거해 모든 자식 잡 env에 전달", () => {
		vi.stubEnv("API_PROXY_URL", "http://localhost:4567///");
		vi.stubEnv("COMFY_URL", "http://localhost:9000/");
		const jobs = buildStudioJobs(normalizeStudioOptions([]), {
			runDir: RUN,
			sourceFile: SOURCE,
			stamp: 42,
		});
		for (const job of jobs) {
			expect(job.env.API_PROXY_URL).toBe("http://localhost:4567");
			expect(job.env.COMFY_URL).toBe("http://localhost:9000");
		}
	});

	it("모든 자식 잡 env에 RENDER_OUTPUT_QC=1을 강제해 QC opt-out 상속을 차단한다", () => {
		vi.stubEnv("RENDER_OUTPUT_QC", "0");
		const jobs = buildStudioJobs(normalizeStudioOptions([]), {
			runDir: RUN,
			sourceFile: SOURCE,
			stamp: 7,
		});
		for (const job of jobs) expect(job.env.RENDER_OUTPUT_QC).toBe("1");
	});
});

describe("episode commit contract", () => {
	const completeOutput = (stem: string) => ({
		status: "complete" as const,
		style: "illustrated" as const,
		video: `/tmp/${stem}.mp4`,
		srt: `/tmp/${stem}.srt`,
		thumbnail: `/tmp/${stem}_thumb.jpg`,
		metadata: `/tmp/${stem}.platform_meta.json`,
		qcReport: `/tmp/${stem}.render_qc.json`,
		renderQc: `/tmp/${stem}.render_qc.json`,
		verifyReport: `/tmp/${stem}.verify_report.json`,
	});
	const base = (): EpisodeManifest => ({
		version: 1,
		id: "episode-1",
		createdAt: "2026-07-10T00:00:00.000Z",
		updatedAt: "2026-07-10T00:00:00.000Z",
		status: "running",
		sourceFile: SOURCE,
		article: {
			title: "경제 기사 제목",
			link: "https://example.com/a",
			description: "",
			pubDate: "",
		},
		requestedFormats: ["shorts", "longform"],
		outputs: {
			shorts: { status: "pending", style: "illustrated" },
			longform: { status: "pending", style: "illustrated" },
		},
	});

	it("요청한 모든 포맷이 complete일 때만 ledger commit 허용", () => {
		const manifest = base();
		expect(canCommitEpisode(manifest)).toBe(false);
		manifest.outputs.shorts = completeOutput("s");
		expect(canCommitEpisode(manifest)).toBe(false);
		manifest.outputs.longform = completeOutput("l");
		expect(canCommitEpisode(manifest)).toBe(true);
		delete manifest.outputs.longform.thumbnail;
		expect(canCommitEpisode(manifest)).toBe(false);
	});

	it("ledger 손상은 빈 원장으로 안전 폴백하고 중복 제거", () => {
		expect(parseUsedLedger("not json")).toEqual({ version: 1, links: [] });
		expect(
			parseUsedLedger(JSON.stringify({ links: ["a", "a", "b", 7] })),
		).toEqual({ version: 1, links: ["a", "b"] });
	});

	it("reservation 손상·중복 항목을 제거", () => {
		expect(parseReservationLedger("not json")).toEqual({
			version: 1,
			reservations: [],
		});
		const valid = {
			id: "ep-1",
			link: "https://example.com/a",
			reservedAt: "2026-07-10T00:00:00.000Z",
			manifestFile: "/tmp/ep-1/manifest.json",
		};
		expect(
			parseReservationLedger(
				JSON.stringify({ reservations: [valid, valid, { id: 7 }] }),
			),
		).toEqual({ version: 1, reservations: [valid] });
	});
});

describe("service endpoint + cleanup contract", () => {
	it("환경 URL에서 health URL과 자동 시작 host/port를 함께 계산", () => {
		const endpoints = resolveServiceEndpoints({
			API_PROXY_URL: "http://127.0.0.1:4567/api/",
			COMFY_URL: "http://0.0.0.0:9000/comfy/",
		});
		expect(endpoints.apiProxy).toMatchObject({
			baseUrl: "http://127.0.0.1:4567/api",
			healthUrl: "http://127.0.0.1:4567/api/health",
			host: "127.0.0.1",
			listenHost: "127.0.0.1",
			port: 4567,
			protocol: "http:",
			pathPrefix: "/api",
			autoStartSupported: false,
		});
		expect(endpoints.comfy).toMatchObject({
			healthUrl: "http://0.0.0.0:9000/comfy/system_stats",
			listenHost: "0.0.0.0",
			port: 9000,
			autoStartSupported: false,
		});
	});

	it("localhost는 로컬 listen 주소로 정규화하고 잘못된 protocol은 거부", () => {
		const endpoints = resolveServiceEndpoints({});
		expect(endpoints.apiProxy).toMatchObject({
			baseUrl: "http://localhost:3459",
			healthUrl: "http://localhost:3459/health",
			listenHost: "127.0.0.1",
			port: 3459,
			autoStartSupported: true,
		});
		expect(() =>
			resolveServiceEndpoints({
				API_PROXY_URL: "file:///tmp/proxy",
			}),
		).toThrow(/protocol/i);
	});

	it("HTTPS·path-prefix·remote URL은 health 대상으로 유지하되 managed start는 금지", () => {
		const endpoints = resolveServiceEndpoints({
			API_PROXY_URL: "https://api.example.com/proxy///",
			COMFY_URL: "http://render.example.com:8188/",
		});
		expect(endpoints.apiProxy).toMatchObject({
			baseUrl: "https://api.example.com/proxy",
			healthUrl: "https://api.example.com/proxy/health",
			autoStartSupported: false,
		});
		expect(endpoints.apiProxy.autoStartReason).toMatch(
			/HTTPS|path prefix|remote host/,
		);
		expect(endpoints.comfy).toMatchObject({
			baseUrl: "http://render.example.com:8188",
			healthUrl: "http://render.example.com:8188/system_stats",
			autoStartSupported: false,
		});
		expect(endpoints.comfy.autoStartReason).toMatch(/remote host/);
	});

	it("부분 시작 실패 롤백은 stop 오류가 있어도 모든 서비스를 역순 정리", async () => {
		const stopped: string[] = [];
		const services = [
			{ stop: async () => void stopped.push("api") },
			{
				stop: async () => {
					stopped.push("comfy");
					throw new Error("stop failed");
				},
			},
			{ stop: async () => void stopped.push("other") },
		];
		await expect(stopStartedServices(services)).rejects.toThrow(/서비스 종료/);
		expect(stopped).toEqual(["other", "comfy", "api"]);
	});
});

describe("reservation lease + signal cleanup", () => {
	const reservation = {
		id: "lease-1",
		link: "https://example.com/lease",
		reservedAt: "2026-07-10T00:00:00.000Z",
		manifestFile: "/tmp/lease-1/manifest.json",
		ownerPid: 4242,
		ownerHost: "studio-host",
		leaseId: "lease-token",
	};

	it("같은 host의 dead owner는 즉시 회수하고 살아있는 owner는 stale 이전에는 유지", () => {
		expect(
			isReservationLeaseActive(reservation, {
				nowMs: Date.parse("2026-07-10T00:01:00.000Z"),
				currentHost: "studio-host",
				isPidAlive: () => false,
			}),
		).toBe(false);
		expect(
			isReservationLeaseActive(reservation, {
				nowMs: Date.parse("2026-07-10T00:05:00.000Z"),
				currentHost: "studio-host",
				isPidAlive: () => true,
			}),
		).toBe(true);
	});

	it("같은 host라도 reservedAt이 staleMs를 넘으면 PID 생존과 무관하게 회수", () => {
		// 크래시 후 OS가 PID를 재사용해 isPidAlive가 영구 true여도 stale 예약은 회수돼야 한다.
		expect(
			isReservationLeaseActive(reservation, {
				nowMs: Date.parse("2026-07-10T00:03:00.000Z"),
				staleMs: 120_000,
				currentHost: "studio-host",
				isPidAlive: () => true,
			}),
		).toBe(false);
		// staleMs 이내에서는 PID 생존 결과를 그대로 따른다(회귀 방지).
		expect(
			isReservationLeaseActive(reservation, {
				nowMs: Date.parse("2026-07-10T00:01:00.000Z"),
				staleMs: 120_000,
				currentHost: "studio-host",
				isPidAlive: () => true,
			}),
		).toBe(true);
		expect(
			isReservationLeaseActive(reservation, {
				nowMs: Date.parse("2026-07-10T00:01:00.000Z"),
				staleMs: 120_000,
				currentHost: "studio-host",
				isPidAlive: () => false,
			}),
		).toBe(false);
	});

	it("원격/legacy lease는 PID를 추측하지 않고 stale 시간으로 회수", () => {
		expect(
			isReservationLeaseActive(reservation, {
				nowMs: Date.parse("2026-07-10T00:01:00.000Z"),
				staleMs: 120_000,
				currentHost: "different-host",
				isPidAlive: () => false,
			}),
		).toBe(true);
		expect(
			isReservationLeaseActive(reservation, {
				nowMs: Date.parse("2026-07-10T00:03:00.000Z"),
				staleMs: 120_000,
				currentHost: "different-host",
			}),
		).toBe(false);
	});

	it("중복 signal에도 cleanup과 terminate를 한 번만 실행", async () => {
		let cleanupCount = 0;
		const terminated: string[] = [];
		const handler = createReservationSignalHandler({
			cleanup: async () => {
				cleanupCount += 1;
				await Promise.resolve();
			},
			terminate: (signal) => void terminated.push(signal),
		});
		await Promise.all([handler("SIGINT"), handler("SIGTERM")]);
		expect(cleanupCount).toBe(1);
		expect(terminated).toEqual(["SIGINT"]);
	});
});

describe("concurrent article reservation", () => {
	it("stale owner와 같은 ID로 갱신된 lease를 이전 owner가 commit/release하지 못함", async () => {
		const root = mkdtempSync(join(tmpdir(), "economy-studio-renewed-lease-"));
		try {
			const sourceFile = join(root, "source.json");
			writeFileSync(sourceFile, sourceJson("https://example.com/renewed"));
			const options = normalizeStudioOptions(
				["--source-file", sourceFile, "--out", "out", "--id", "same-id"],
				root,
			);
			const stale = await reserveEpisodeSource(options);
			const ledgerPaths = resolveStudioLedgerPaths(options.outRoot);
			const raw = JSON.parse(
				readFileSync(ledgerPaths.reservationsFile, "utf8"),
			) as { reservations: Array<{ ownerPid?: number; ownerHost?: string }> };
			raw.reservations[0].ownerPid = 2_147_483_647;
			raw.reservations[0].ownerHost = hostname();
			writeFileSync(ledgerPaths.reservationsFile, JSON.stringify(raw));

			const renewed = await reserveEpisodeSource(options);
			expect(renewed.id).toBe(stale.id);
			expect(renewed.reservation.leaseId).not.toBe(stale.reservation.leaseId);
			await expect(
				releaseEpisodeReservation(options.outRoot, stale.reservation),
			).rejects.toThrow(/lease 소유권/);
			await expect(
				commitEpisodeReservation(options.outRoot, stale.reservation),
			).rejects.toThrow(/lease 소유권/);
			const active = parseReservationLedger(
				readFileSync(ledgerPaths.reservationsFile, "utf8"),
			).reservations;
			expect(active).toHaveLength(1);
			expect(active[0]?.leaseId).toBe(renewed.reservation.leaseId);

			writeCompleteManifest(renewed);
			await commitEpisodeReservation(options.outRoot, renewed.reservation);
			await expect(
				commitEpisodeReservation(options.outRoot, stale.reservation),
			).rejects.toThrow(/커밋된 기사 lease 소유권/);
			await expect(
				releaseEpisodeReservation(options.outRoot, stale.reservation),
			).rejects.toThrow(/커밋된 기사 lease 소유권/);
			await expect(
				commitEpisodeReservation(options.outRoot, renewed.reservation),
			).resolves.toBeUndefined();
			const committed = parseUsedLedger(
				readFileSync(ledgerPaths.ledgerFile, "utf8"),
			);
			expect(committed.committedLeases?.[renewed.source.article.link]).toBe(
				renewed.reservation.leaseId,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("같은 host에서 owner PID가 죽은 예약은 24시간을 기다리지 않고 회수", async () => {
		const root = mkdtempSync(join(tmpdir(), "economy-studio-dead-owner-"));
		try {
			const sourceFile = join(root, "source.json");
			writeFileSync(sourceFile, sourceJson("https://example.com/dead-owner"));
			const firstOptions = normalizeStudioOptions(
				["--source-file", sourceFile, "--out", "out", "--id", "dead-first"],
				root,
			);
			const secondOptions = normalizeStudioOptions(
				["--source-file", sourceFile, "--out", "out", "--id", "dead-second"],
				root,
			);
			await reserveEpisodeSource(firstOptions);
			const ledgerPaths = resolveStudioLedgerPaths(firstOptions.outRoot);
			const raw = JSON.parse(
				readFileSync(ledgerPaths.reservationsFile, "utf8"),
			) as { reservations: Array<{ ownerPid?: number; ownerHost?: string }> };
			raw.reservations[0].ownerPid = 2_147_483_647;
			raw.reservations[0].ownerHost = hostname();
			writeFileSync(ledgerPaths.reservationsFile, JSON.stringify(raw));
			const second = await reserveEpisodeSource(secondOptions);
			expect(second.id).toBe("dead-second");
			await releaseEpisodeReservation(
				secondOptions.outRoot,
				second.reservation,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("동일 기사의 동시 실행은 하나만 예약하고 실패 시 해제 가능", async () => {
		const root = mkdtempSync(join(tmpdir(), "economy-studio-reserve-"));
		try {
			const sourceFile = join(root, "source.json");
			writeFileSync(sourceFile, sourceJson("https://example.com/same"));
			const first = normalizeStudioOptions(
				["--source-file", sourceFile, "--out", "out", "--id", "first"],
				root,
			);
			const second = normalizeStudioOptions(
				["--source-file", sourceFile, "--out", "out", "--id", "second"],
				root,
			);
			const ledgerPaths = resolveStudioLedgerPaths(first.outRoot);
			mkdirSync(dirname(ledgerPaths.ledgerFile), { recursive: true });
			writeFileSync(
				ledgerPaths.ledgerFile,
				JSON.stringify({
					version: 1,
					links: ["https://example.com/same"],
				}),
			);
			const results = await Promise.allSettled([
				reserveEpisodeSource(first),
				reserveEpisodeSource(second),
			]);
			expect(
				results.filter((result) => result.status === "fulfilled"),
			).toHaveLength(1);
			const rejected = results.find((result) => result.status === "rejected");
			expect(rejected).toMatchObject({ status: "rejected" });
			expect(String((rejected as PromiseRejectedResult).reason)).toMatch(
				/제작 중/,
			);
			const fulfilled = results.find(
				(result): result is PromiseFulfilledResult<ReservedEpisode> =>
					result.status === "fulfilled",
			);
			await releaseEpisodeReservation(
				first.outRoot,
				fulfilled?.value.reservation ?? {
					id: "missing",
					link: "https://example.com/missing",
					leaseId: "missing",
				},
			);
			const reservationFile = ledgerPaths.reservationsFile;
			expect(
				parseReservationLedger(readFileSync(reservationFile, "utf8"))
					.reservations,
			).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("동시 완료 커밋도 used 원장 갱신을 잃지 않고 예약을 정리", async () => {
		const root = mkdtempSync(join(tmpdir(), "economy-studio-commit-"));
		try {
			const sourceA = join(root, "source-a.json");
			const sourceB = join(root, "source-b.json");
			writeFileSync(sourceA, sourceJson("https://example.com/a", "기사 A"));
			writeFileSync(sourceB, sourceJson("https://example.com/b", "기사 B"));
			const optionsA = normalizeStudioOptions(
				["--source-file", sourceA, "--out", "out", "--id", "ep-a"],
				root,
			);
			const optionsB = normalizeStudioOptions(
				["--source-file", sourceB, "--out", "out", "--id", "ep-b"],
				root,
			);
			const [reservedA, reservedB] = await Promise.all([
				reserveEpisodeSource(optionsA),
				reserveEpisodeSource(optionsB),
			]);
			writeCompleteManifest(reservedA);
			writeCompleteManifest(reservedB);
			await Promise.all([
				commitEpisodeReservation(optionsA.outRoot, reservedA.reservation),
				commitEpisodeReservation(optionsB.outRoot, reservedB.reservation),
			]);
			const ledgerPaths = resolveStudioLedgerPaths(optionsA.outRoot);
			expect(
				parseUsedLedger(
					readFileSync(ledgerPaths.ledgerFile, "utf8"),
				).links.sort(),
			).toEqual(["https://example.com/a", "https://example.com/b"]);
			expect(
				parseReservationLedger(
					readFileSync(ledgerPaths.reservationsFile, "utf8"),
				).reservations,
			).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("완료 manifest 뒤 중단되어도 다음 잠금에서 used 원장을 복구", async () => {
		const root = mkdtempSync(join(tmpdir(), "economy-studio-recover-"));
		try {
			const sourceA = join(root, "source-a.json");
			const sourceB = join(root, "source-b.json");
			writeFileSync(sourceA, sourceJson("https://example.com/recover-a"));
			writeFileSync(sourceB, sourceJson("https://example.com/recover-b"));
			const optionsA = normalizeStudioOptions(
				["--source-file", sourceA, "--out", "out", "--id", "recover-a"],
				root,
			);
			const optionsB = normalizeStudioOptions(
				["--source-file", sourceB, "--out", "out", "--id", "recover-b"],
				root,
			);
			const reservedA = await reserveEpisodeSource(optionsA);
			writeCompleteManifest(reservedA);
			const reservedB = await reserveEpisodeSource(optionsB);
			const ledgerPaths = resolveStudioLedgerPaths(optionsA.outRoot);
			expect(
				parseUsedLedger(readFileSync(ledgerPaths.ledgerFile, "utf8")).links,
			).toContain("https://example.com/recover-a");
			expect(
				parseReservationLedger(
					readFileSync(ledgerPaths.reservationsFile, "utf8"),
				).reservations.map((reservation) => reservation.id),
			).toEqual([reservedB.id]);
			await releaseEpisodeReservation(optionsB.outRoot, reservedB.reservation);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("resolveEpisodePaths", () => {
	it("쇼츠·롱폼·source·manifest 경로를 한 run 디렉터리 아래 고정", () => {
		const paths = resolveEpisodePaths("/tmp/root", "ep-1");
		expect(paths.runDir).toBe("/tmp/root/ep-1");
		expect(paths.shortsDir).toBe("/tmp/root/ep-1/shorts");
		expect(paths.longformDir).toBe("/tmp/root/ep-1/longform");
		expect(paths.sourceFile).toBe("/tmp/root/ep-1/source.json");
		expect(paths.manifestFile).toBe("/tmp/root/ep-1/manifest.json");
	});
});

describe("reclaimStaleLockFile", () => {
	it("검사~rename 사이 남이 획득한 fresh 잠금을 옮겼으면 원복하고 unlink하지 않음", () => {
		// 옮긴 파일 inode가 observed와 다르면 = 남의 갓 만든 유효 잠금을 잘못 옮긴 것.
		const calls: string[] = [];
		const result = reclaimStaleLockFile(
			"/tmp/x.lock",
			111,
			"/tmp/x.lock.stale-1-abc",
			{
				rename: (from, to) => calls.push(`rename ${from} ${to}`),
				statIno: () => 222,
				unlink: (p) => calls.push(`unlink ${p}`),
			},
		);
		expect(result).toBe("restored");
		expect(calls).toEqual([
			"rename /tmp/x.lock /tmp/x.lock.stale-1-abc",
			"rename /tmp/x.lock.stale-1-abc /tmp/x.lock",
		]);
		expect(calls.some((call) => call.startsWith("unlink"))).toBe(false);
	});

	it("옮긴 inode가 observed와 같으면 stale 잠금을 unlink로 회수", () => {
		const calls: string[] = [];
		const result = reclaimStaleLockFile(
			"/tmp/x.lock",
			111,
			"/tmp/x.lock.stale-1-abc",
			{
				rename: (from, to) => calls.push(`rename ${from} ${to}`),
				statIno: () => 111,
				unlink: (p) => calls.push(`unlink ${p}`),
			},
		);
		expect(result).toBe("reclaimed");
		expect(calls).toEqual([
			"rename /tmp/x.lock /tmp/x.lock.stale-1-abc",
			"unlink /tmp/x.lock.stale-1-abc",
		]);
	});

	it("실제 파일에서 stale 잠금을 회수(happy path)", () => {
		const dir = mkdtempSync(join(tmpdir(), "economy-studio-lock-"));
		try {
			const lockPath = join(dir, "x.lock");
			closeSync(openSync(lockPath, "wx"));
			const observedIno = Number(statSync(lockPath).ino);
			const stalePath = `${lockPath}.stale-test`;
			expect(reclaimStaleLockFile(lockPath, observedIno, stalePath)).toBe(
				"reclaimed",
			);
			expect(existsSync(lockPath)).toBe(false);
			expect(existsSync(stalePath)).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
