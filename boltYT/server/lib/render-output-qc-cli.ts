import { access } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
	evaluateRenderOutput,
	profileFromRenderOutputQc,
} from "./render-output-qc.js";

function parseArgs(argv: string[]) {
	const args = {
		file: "",
		reference: "",
		windowSeconds: 10,
		json: false,
	};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--json") {
			args.json = true;
			continue;
		}
		if (arg === "--window") {
			const value = Number(argv[++i]);
			if (Number.isFinite(value) && value > 0) args.windowSeconds = value;
			continue;
		}
		if (arg === "--reference" || arg === "--ref") {
			args.reference = resolve(argv[++i] ?? "");
			continue;
		}
		if (!args.file) args.file = arg;
	}

	if (!args.file) {
		throw new Error(
			"Usage: npm run evaluate:render -- <generated.mp4> [--reference reference.mp4] [--window 10] [--json]",
		);
	}

	return { ...args, file: resolve(args.file) };
}

function printHuman(report: Awaited<ReturnType<typeof evaluateRenderOutput>>) {
	console.log(`${basename(report.file)}: ${report.verdict.toUpperCase()} (${report.score}/100)`);
	console.log(
		`video=${report.metrics.video?.width}x${report.metrics.video?.height}@${Number(report.metrics.video?.fps ?? 0).toFixed(2)}fps duration=${report.metrics.durationSeconds}s audio=${report.metrics.audio ? "yes" : "no"}`,
	);
	console.log(
		`visual avgDiff=${report.metrics.visualRegion.avgDiff} first3=${report.metrics.visualRegion.first3AvgDiff} cuts=${report.metrics.sceneCuts.estimatedCuts} black=${report.metrics.black.count}`,
	);
	console.log(
		`audio mean=${report.metrics.volume.meanDb ?? "n/a"}dB max=${report.metrics.volume.maxDb ?? "n/a"}dB`,
	);
	console.log(
		`loudness I=${report.metrics.loudness.integratedLufs ?? "n/a"}LUFS LRA=${report.metrics.loudness.loudnessRangeLu ?? "n/a"}LU TP=${report.metrics.loudness.truePeakDbfs ?? "n/a"}dBFS`,
	);
	if (report.issues.length > 0) {
		console.log("issues:");
		for (const issue of report.issues) console.log(`- ${issue}`);
	}
	if (report.requiredActions.length > 0) {
		console.log("requiredActions:");
		for (const action of report.requiredActions) console.log(`- ${action}`);
	}
	if (report.referenceComparison) {
		const cmp = report.referenceComparison;
		console.log(
			`reference=${cmp.passed ? "PASS" : "REVISE"} (${cmp.score}/100) cutRatio=${cmp.metrics.cutDensityRatio} hookRatio=${cmp.metrics.hookMotionRatio} motionRatio=${cmp.metrics.visualMotionRatio}`,
		);
		if (cmp.issues.length > 0) {
			console.log("referenceIssues:");
			for (const issue of cmp.issues) console.log(`- ${issue}`);
		}
	}
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	await access(args.file);
	let referenceProfile;
	if (args.reference) {
		await access(args.reference);
		const referenceReport = await evaluateRenderOutput(args.reference, {
			windowSeconds: args.windowSeconds,
		});
		referenceProfile = profileFromRenderOutputQc(referenceReport);
	}
	const report = await evaluateRenderOutput(args.file, {
		windowSeconds: args.windowSeconds,
		referenceProfile,
	});
	if (args.json) {
		console.log(JSON.stringify(report, null, 2));
		return;
	}
	printHuman(report);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
