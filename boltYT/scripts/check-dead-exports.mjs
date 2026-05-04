#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const repoRoot = process.cwd();
const includeTypes = process.argv.includes("--include-types");
const sourceRoots = ["src", "server", "scripts"];
const sourceExtensions = new Set([".ts", ".tsx"]);
const importableExtensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx"];
const allowlistPath = path.join(repoRoot, "scripts/dead-exports.allowlist.json");
const ignoredExportCandidatePatterns = [
	/\.test\.[cm]?[tj]sx?$/,
	/\.spec\.[cm]?[tj]sx?$/,
	/\.d\.ts$/,
	/(^|\/)src\/test-setup\//,
	/(^|\/)generated-reference-template-presets\.ts$/,
];
const publicExportAllowlist = loadAllowlist();

const files = listSourceFiles(sourceRoots);
const fileSet = new Set(files);
const exportsByFile = new Map();
const usedExports = new Set();
const namespaceUsedFiles = new Set();

for (const file of files) {
	const sourceFile = readSourceFile(file);
	if (!ignoredExportCandidatePatterns.some((pattern) => pattern.test(relative(file)))) {
		collectNamedExports(file, sourceFile);
	}
	collectImportUsage(file, sourceFile);
}

const findings = [];
for (const [file, exportedNames] of exportsByFile) {
	const relativeFile = relative(file);
	const allowed = publicExportAllowlist.get(relativeFile);
	if (allowed?.has("*") || namespaceUsedFiles.has(file)) continue;

	for (const name of exportedNames) {
		if (allowed?.has(name)) continue;
		if (!usedExports.has(exportKey(file, name))) {
			findings.push({ file: relativeFile, name });
		}
	}
}

if (findings.length === 0) {
	console.log(
		`dead-exports: PASS (${files.length} files scanned, ${includeTypes ? "value+type" : "value"} exports)`,
	);
	process.exit(0);
}

console.error(
	`dead-exports: FAIL (${findings.length} unused named ${includeTypes ? "value/type" : "value"} exports)`,
);
for (const finding of findings.slice(0, 80)) {
	console.error(`- ${finding.file}: ${finding.name}`);
}
if (findings.length > 80) {
	console.error(`... ${findings.length - 80} more`);
}
console.error(
	"Remove the export/code, import it from a real production path, or add a documented allowlist entry in scripts/dead-exports.allowlist.json.",
);
process.exit(1);

function listSourceFiles(roots) {
	const found = [];
	for (const root of roots) {
		const absoluteRoot = path.resolve(repoRoot, root);
		if (fs.existsSync(absoluteRoot)) walk(absoluteRoot, found);
	}
	return found.sort();
}

function walk(dir, found) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (
			entry.name === "node_modules" ||
			entry.name === "dist" ||
			entry.name === ".git" ||
			entry.name === ".harness" ||
			entry.name === ".playwright-cli"
		) {
			continue;
		}
		const absolute = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			walk(absolute, found);
			continue;
		}
		if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
			found.push(normalize(absolute));
		}
	}
}

function readSourceFile(file) {
	const content = fs.readFileSync(file, "utf8");
	return ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
}

function collectNamedExports(file, sourceFile) {
	const exported = new Set();

	for (const statement of sourceFile.statements) {
		if (ts.isExportDeclaration(statement)) {
			if (statement.moduleSpecifier) continue;
			if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
				for (const element of statement.exportClause.elements) {
					exported.add(element.name.text);
				}
			}
			continue;
		}

		const modifiers = ts.canHaveModifiers(statement)
			? ts.getModifiers(statement) ?? []
			: [];
		if (!modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
			continue;
		}
		if (modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
			continue;
		}

		if (
			ts.isFunctionDeclaration(statement) ||
			ts.isClassDeclaration(statement) ||
			ts.isEnumDeclaration(statement)
		) {
			if (statement.name) exported.add(statement.name.text);
			continue;
		}

		if (
			includeTypes &&
			(ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement))
		) {
			if (statement.name) exported.add(statement.name.text);
			continue;
		}

		if (ts.isVariableStatement(statement)) {
			for (const declaration of statement.declarationList.declarations) {
				collectBindingNames(declaration.name, exported);
			}
		}
	}

	if (exported.size > 0) exportsByFile.set(file, exported);
}

function collectBindingNames(name, output) {
	if (ts.isIdentifier(name)) {
		output.add(name.text);
		return;
	}
	if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
		for (const element of name.elements) {
			if (ts.isBindingElement(element)) collectBindingNames(element.name, output);
		}
	}
}

function collectImportUsage(file, sourceFile) {
	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement)) {
			const target = resolveModule(file, statement.moduleSpecifier);
			if (!target) continue;
			const clause = statement.importClause;
			if (!clause) {
				namespaceUsedFiles.add(target);
				continue;
			}
			if (clause.name) usedExports.add(exportKey(target, "default"));
			if (!clause.namedBindings) continue;
			if (ts.isNamespaceImport(clause.namedBindings)) {
				namespaceUsedFiles.add(target);
				continue;
			}
			for (const element of clause.namedBindings.elements) {
				const importedName = element.propertyName?.text ?? element.name.text;
				usedExports.add(exportKey(target, importedName));
			}
			continue;
		}

		if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
			const target = resolveModule(file, statement.moduleSpecifier);
			if (!target) continue;
			if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) {
				namespaceUsedFiles.add(target);
				continue;
			}
			for (const element of statement.exportClause.elements) {
				const importedName = element.propertyName?.text ?? element.name.text;
				usedExports.add(exportKey(target, importedName));
			}
			continue;
		}

		findDynamicImports(file, statement);
	}
}

function findDynamicImports(file, node) {
	if (
		ts.isCallExpression(node) &&
		node.expression.kind === ts.SyntaxKind.ImportKeyword &&
		node.arguments.length === 1
	) {
		const [argument] = node.arguments;
		const target = resolveModule(file, argument);
		if (target) namespaceUsedFiles.add(target);
	}

	ts.forEachChild(node, (child) => findDynamicImports(file, child));
}

function resolveModule(fromFile, specifierNode) {
	if (!ts.isStringLiteral(specifierNode)) return null;
	const specifier = specifierNode.text;
	if (!specifier.startsWith(".")) return null;

	const base = normalize(path.resolve(path.dirname(fromFile), specifier));
	const candidates = [base];
	for (const extension of importableExtensions) {
		candidates.push(normalize(`${base}${extension}`));
	}
	for (const extension of importableExtensions) {
		candidates.push(normalize(path.join(base, `index${extension}`)));
	}

	for (const candidate of candidates) {
		const resolved = remapJsToTs(candidate);
		if (fileSet.has(resolved)) return resolved;
	}
	return null;
}

function remapJsToTs(file) {
	const ext = path.extname(file);
	if (ext !== ".js" && ext !== ".jsx") return file;
	const withoutExt = file.slice(0, -ext.length);
	for (const tsExt of [".ts", ".tsx"]) {
		const candidate = `${withoutExt}${tsExt}`;
		if (fileSet.has(candidate)) return candidate;
	}
	return file;
}

function exportKey(file, name) {
	return `${file}#${name}`;
}

function relative(file) {
	return normalize(path.relative(repoRoot, file));
}

function normalize(file) {
	return file.split(path.sep).join("/");
}

function loadAllowlist() {
	const allowlist = new Map();
	if (!fs.existsSync(allowlistPath)) return allowlist;

	const parsed = JSON.parse(fs.readFileSync(allowlistPath, "utf8"));
	for (const entry of parsed.allow ?? []) {
		if (!entry?.file || !Array.isArray(entry.exports)) continue;
		allowlist.set(entry.file, new Set(entry.exports));
	}
	return allowlist;
}
