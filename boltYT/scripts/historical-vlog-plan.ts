/**
 * 역사 시간여행 브이로그 채널 계획 CLI — 검증된 수익 포맷을 한 번에 계획.
 *
 * 사용:
 *   npm run vlog:plan
 *   npm run vlog:plan -- --channel my-history --locale ko --format longform
 *   npm run vlog:plan -- --eras ancient-rome-44ad,titanic-1912,ice-age --targets en-US
 *   npm run vlog:plan -- --json > plan.json
 *
 * 순수 계획만 출력한다(네트워크/DB 없음). 실제 제작은 이 계획을 ContentWizard/
 * 렌더 큐에 흘려보내면 된다. 호스트 잠금(referenceImagePath+seed)이 모든
 * 에피소드에 동일하게 부여되는지 한눈에 확인할 수 있다.
 */

import {
	type HistoricalVlogChannelInput,
	planHistoricalVlogChannel,
} from "../src/lib/historical-vlog-factory";
import type { VlogLocale } from "../src/lib/historical-vlog-format";
import type { BenchmarkFormat } from "../src/lib/market-benchmark";

function parseArgs(argv: string[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg.startsWith("--")) continue;
		const key = arg.slice(2);
		const next = argv[i + 1];
		if (next === undefined || next.startsWith("--")) {
			out[key] = "true";
		} else {
			out[key] = next;
			i++;
		}
	}
	return out;
}

function splitList(value: string | undefined): string[] | undefined {
	if (!value) return undefined;
	const list = value
		.split(",")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
	return list.length > 0 ? list : undefined;
}

function main(): void {
	const args = parseArgs(process.argv.slice(2));

	const locale: VlogLocale = args.locale === "en" ? "en" : "ko";
	const format: BenchmarkFormat =
		args.format === "shorts" ? "shorts" : "longform";

	const input: HistoricalVlogChannelInput = {
		channelId: args.channel ?? "demo-channel",
		locale,
		format,
		eras: splitList(args.eras),
		targetLocales: splitList(args.targets),
		hasMultiAudioAccess: args["multi-audio"] === "true",
	};

	const plan = planHistoricalVlogChannel(input);

	if (args.json === "true") {
		process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
		return;
	}

	const lines: string[] = [];
	lines.push("");
	lines.push("═══ 역사 시간여행 브이로그 채널 계획 ═══");
	lines.push(`채널: ${plan.channelId}`);
	lines.push(`요약: ${plan.summary}`);
	lines.push("");
	lines.push("── 고정 호스트 (모든 에피소드 동일 인물) ──");
	lines.push(`이름: ${plan.host.name}`);
	lines.push(`외형(잠금): ${plan.host.appearance}`);
	lines.push(
		`레퍼런스 시트(채널 1회 생성): ${plan.hostIdentity.referenceSheetPath}`,
	);
	lines.push(`고정 시드: ${plan.hostIdentity.styleSeed}`);
	lines.push(`시트 생성 프롬프트: ${plan.hostReferencePrompt}`);
	lines.push("");
	lines.push("── 시장 바 (historical_vlog) ──");
	lines.push(
		`source=${plan.benchmark.source} confidence=${plan.benchmark.confidence} cut=${plan.benchmark.editing.cutDensitySec}s hook=${plan.benchmark.script.hookSec}s chapter=${plan.benchmark.script.chapterEverySec ?? "-"}s`,
	);
	lines.push("");
	lines.push(`── 에피소드 ${plan.episodes.length}개 ──`);
	for (const ep of plan.episodes) {
		lines.push("");
		lines.push(`[${ep.index + 1}] ${ep.era.subjectKo} (${ep.era.id})`);
		lines.push(`   제목(KO): ${ep.title}`);
		lines.push(`   제목(EN): ${ep.titleEn}`);
		lines.push(
			`   썸네일: "${ep.thumbnail.bigText}" + ${ep.thumbnail.expression} 셀카`,
		);
		lines.push(`   챕터: ${ep.chapters.map((c) => c.role).join(" → ")}`);
		lines.push(
			`   호스트 잠금: seed=${ep.hostMediaLock.seed} ref=${ep.hostMediaLock.referenceImagePath}`,
		);
		if (ep.localization) {
			const variants = ep.localization.variants
				.map((v) => `${v.label}(RPM×${v.expectedRpmLift})`)
				.join(", ");
			lines.push(`   현지화: ${variants || "없음"}`);
		}
	}
	lines.push("");
	lines.push(
		`── 다양성: ${plan.variation.score}/100 (${plan.variation.verdict}) · 추정 산출: ${plan.estimatedOutputs}편 ──`,
	);
	if (plan.warnings.length > 0) {
		lines.push("");
		lines.push("⚠ 경고:");
		for (const w of plan.warnings) lines.push(`   - ${w}`);
	}
	lines.push("");

	process.stdout.write(`${lines.join("\n")}\n`);
}

main();
