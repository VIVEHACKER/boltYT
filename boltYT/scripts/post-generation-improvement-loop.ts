import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
	POST_GENERATION_QUALITY_GATES,
	judgePostGenerationQuality,
	type QualityCheckResult,
	type QualityLoopReport,
} from "../src/lib/post-generation-quality.ts";
import { GENERATED_REFERENCE_TEMPLATES } from "../src/lib/generated-reference-template-presets.ts";
import {
	calculateGeneratedReferenceTemplateCoverage,
	cloneReferenceTemplateInput,
} from "../src/lib/reference-template-presets.ts";

const execFileP = promisify(execFile);
const REPORT_DIR = ".quality";
const REPORT_PATH = path.join(REPORT_DIR, "post-generation-report.md");

interface CliOptions {
	fix: boolean;
	refreshReferences: boolean;
	e2e: boolean;
	harness: boolean;
	json: boolean;
}

const options = parseArgs(process.argv.slice(2));
const checks: QualityCheckResult[] = [];

await main();

async function main() {
	if (options.fix) {
		await runCommand("lint-fix", "ESLint 자동 수정", "npx", [
			"eslint",
			".",
			"--fix",
		]);
	}

	if (options.refreshReferences) {
		await runCommand("reference-refresh", "자동 레퍼런스 갱신", "npx", [
			"tsx",
			"scripts/reference-batch-template.ts",
		]);
	}

	checks.push(checkReferenceCoverage());
	await runGate("build");
	await runGate("tests");
	await runGate("lint");
	await runGate("dead-exports");
	await runGate("production-pipeline-guard");
	if (options.e2e) await runGate("reference-e2e");
	if (options.harness) await runGate("harness");

	const report = judgePostGenerationQuality(checks);
	await writeMarkdownReport(report);

	if (options.json) {
		console.log(JSON.stringify(report, null, 2));
	} else {
		console.log(renderConsoleSummary(report));
		console.log(`report: ${REPORT_PATH}`);
	}

	if (report.verdict === "blocked") process.exitCode = 1;
}

async function runGate(id: string) {
	const gate = POST_GENERATION_QUALITY_GATES.find((item) => item.id === id);
	if (!gate?.command) return;
	const [command, ...args] = splitCommand(gate.command);
	await runCommand(gate.id, gate.label, command, args);
}

async function runCommand(
	id: string,
	label: string,
	command: string,
	args: string[],
) {
	const startedAt = Date.now();
	try {
		const { stdout, stderr } = await execFileP(command, args, {
			maxBuffer: 30 * 1024 * 1024,
		});
		checks.push({
			id,
			label,
			status: "pass",
			command: [command, ...args].join(" "),
			details: summarizeOutput(stdout, stderr) || "passed",
			durationMs: Date.now() - startedAt,
		});
	} catch (error) {
		const failure = error as Error & {
			stdout?: string;
			stderr?: string;
			code?: number;
		};
		checks.push({
			id,
			label,
			status: "fail",
			command: [command, ...args].join(" "),
			details:
				summarizeOutput(failure.stdout ?? "", failure.stderr ?? "") ||
				failure.message,
			durationMs: Date.now() - startedAt,
		});
	}
}

function checkReferenceCoverage(): QualityCheckResult {
	const coverage = calculateGeneratedReferenceTemplateCoverage(
		GENERATED_REFERENCE_TEMPLATES.map((template) =>
			cloneReferenceTemplateInput(template),
		),
	);
	const weak = coverage.categories.filter(
		(category) =>
			category.count < 20 ||
			category.deep !== category.count ||
			category.over20 > 0 ||
			category.qualityAvg < 88 ||
			category.knowledgeAvg < 88,
	);
	const pass =
		coverage.total >= 100 &&
		coverage.deep === coverage.total &&
		coverage.over20 === 0 &&
		coverage.qualityAvg >= 90 &&
		coverage.knowledgeAvg >= 90 &&
		coverage.qualityMin >= 70 &&
		coverage.blocked === 0 &&
		weak.length === 0;
	return {
		id: "reference-coverage",
		label: "레퍼런스 커버리지",
		status: pass ? "pass" : "fail",
		details:
			pass
				? `자동 생성 ${coverage.total}개, deep ${coverage.deep}/${coverage.total}, 평균 Q${coverage.qualityAvg}, 평균 K${coverage.knowledgeAvg}, 최저 Q${coverage.qualityMin}, 즉시 사용 ${coverage.ready}개, 성과 반영 ${coverage.outcomeCalibrated}개`
				: [
						`자동 생성 ${coverage.total}개`,
						`deep ${coverage.deep}/${coverage.total}`,
						`평균 Q${coverage.qualityAvg}`,
						`평균 K${coverage.knowledgeAvg}`,
						`최저 Q${coverage.qualityMin}`,
						`차단 ${coverage.blocked}개`,
						`성과 반영 ${coverage.outcomeCalibrated}개`,
						weak.length > 0
							? `부족: ${weak.map((category) => `${category.label} ${category.count}개/Q${category.qualityAvg}/K${category.knowledgeAvg}`).join(", ")}`
							: "",
					]
						.filter(Boolean)
						.join(" · "),
	};
}

function parseArgs(args: string[]): CliOptions {
	return {
		fix: args.includes("--fix"),
		refreshReferences: args.includes("--refresh-references"),
		e2e: !args.includes("--no-e2e"),
		harness: !args.includes("--no-harness"),
		json: args.includes("--json"),
	};
}

function splitCommand(command: string): string[] {
	return command.split(" ").filter(Boolean);
}

function summarizeOutput(stdout: string, stderr: string): string {
	const merged = `${stdout}\n${stderr}`
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	return merged.slice(-10).join("\n").slice(0, 4000);
}

async function writeMarkdownReport(report: QualityLoopReport) {
	await mkdir(REPORT_DIR, { recursive: true });
	await writeFile(REPORT_PATH, renderMarkdownReport(report));
}

function renderConsoleSummary(report: QualityLoopReport): string {
	return [
		`post-generation quality loop: ${report.verdict.toUpperCase()} (${report.score})`,
		...report.checks.map(
			(check) =>
				`- ${check.status.toUpperCase()} ${check.label}${check.durationMs ? ` ${Math.round(check.durationMs / 1000)}s` : ""}`,
		),
		"next:",
		...report.nextActions.map((action) => `- ${action}`),
	].join("\n");
}

function renderMarkdownReport(report: QualityLoopReport): string {
	return [
		"# Post-Generation Quality Report",
		"",
		`- Verdict: ${report.verdict}`,
		`- Score: ${report.score}`,
		`- Generated at: ${new Date().toISOString()}`,
		"",
		"## Checks",
		"",
		...report.checks.flatMap((check) => [
			`### ${check.status.toUpperCase()} ${check.label}`,
			"",
			check.command ? `Command: \`${check.command}\`` : "",
			check.durationMs ? `Duration: ${Math.round(check.durationMs / 1000)}s` : "",
			"",
			"```text",
			check.details || "-",
			"```",
			"",
		]),
		"## Next Actions",
		"",
		...report.nextActions.map((action) => `- ${action}`),
		"",
		"## Project Learnings To Reuse",
		"",
		...report.learnings.flatMap((learning) => [
			`### ${learning.title}`,
			"",
			learning.rule,
			"",
			...learning.files.map((file) => `- ${file}`),
			"",
		]),
	].join("\n");
}
