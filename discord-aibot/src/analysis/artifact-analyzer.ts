import { createHash } from "node:crypto";
import { extname } from "node:path";
import yauzl from "yauzl";

export interface ArchiveEntry {
	path: string;
	compressedSize: number;
	uncompressedSize: number;
	risk?: string;
}

export interface ArtifactReport {
	name: string;
	size: number;
	sha256: string;
	detectedType: string;
	declaredExtension: string;
	entropy: number;
	strings: string[];
	archive?: { entries: ArchiveEntry[]; totalUncompressedSize: number; truncated: boolean };
	recovery: { kind: string; restoreOrder: string[]; missingRecommended: string[] };
	warnings: string[];
	sandbox?: { provider: string; reference?: string; status: string };
}

export interface AnalyzeOptions {
	maxBytes?: number;
	maxEntries?: number;
	maxExpandedBytes?: number;
	sandboxUrl?: string;
	sandboxToken?: string;
}

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 2_000;
const DEFAULT_MAX_EXPANDED_BYTES = 250 * 1024 * 1024;

function detectType(buffer: Buffer): string {
	if (buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return "zip";
	if (buffer.subarray(0, 2).toString("ascii") === "MZ") return "pe-executable";
	if (buffer.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return "elf-executable";
	if (buffer.subarray(0, 4).equals(Buffer.from([0xca, 0xfe, 0xba, 0xbe]))) return "java-class-or-mach-o";
	if (buffer.subarray(0, 6).toString("ascii") === "7z\xbc\xaf'\x1c") return "7z";
	if (buffer.subarray(0, 6).toString("ascii") === "Rar!\x1a\x07") return "rar";
	if (buffer.length > 262 && buffer.subarray(257, 262).toString("ascii") === "ustar") return "tar";
	if (buffer.subarray(0, 15).toString("ascii") === "SQLite format 3") return "sqlite";
	const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
	const printable = [...sample].filter(byte => byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)).length;
	return sample.length && printable / sample.length > 0.85 ? "text" : "binary";
}

function entropy(buffer: Buffer): number {
	if (!buffer.length) return 0;
	const frequencies = new Array<number>(256).fill(0);
	for (const byte of buffer) frequencies[byte]++;
	return frequencies.reduce((sum, count) => count ? sum - (count / buffer.length) * Math.log2(count / buffer.length) : sum, 0);
}

function extractStrings(buffer: Buffer): string[] {
	const matches = buffer.subarray(0, Math.min(buffer.length, 1024 * 1024)).toString("latin1").match(/[\x20-\x7e]{6,}/g) ?? [];
	return [...new Set(matches.map(value => value.trim()).filter(Boolean))].slice(0, 40);
}

function unsafeArchivePath(value: string): string | undefined {
	const normalized = value.replace(/\\/g, "/");
	if (normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized)) return "absolute path";
	if (normalized.split("/").includes("..")) return "path traversal";
	if (normalized.includes("\0")) return "NUL byte";
	return undefined;
}

async function inspectZip(buffer: Buffer, maxEntries: number, maxExpandedBytes: number): Promise<ArtifactReport["archive"]> {
	return new Promise((resolve, reject) => {
		yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
			if (error || !zip) return reject(error ?? new Error("Unable to parse ZIP"));
			const entries: ArchiveEntry[] = [];
			let totalUncompressedSize = 0;
			let truncated = false;
			zip.on("entry", entry => {
				totalUncompressedSize += entry.uncompressedSize;
				const risk = unsafeArchivePath(entry.fileName);
				if (entries.length < maxEntries) entries.push({ path: entry.fileName, compressedSize: entry.compressedSize, uncompressedSize: entry.uncompressedSize, ...(risk ? { risk } : {}) });
				else truncated = true;
				if (totalUncompressedSize > maxExpandedBytes) {
					zip.close();
					return reject(new Error("Archive exceeds expanded-size limit"));
				}
				zip.readEntry();
			});
			zip.once("end", () => resolve({ entries, totalUncompressedSize, truncated }));
			zip.once("error", reject);
			zip.readEntry();
		});
	});
}

function buildRecovery(name: string, type: string, entries: ArchiveEntry[] = []): ArtifactReport["recovery"] {
	const paths = entries.map(entry => entry.path.toLowerCase());
	const has = (pattern: RegExp) => paths.some(path => pattern.test(path));
	const source = has(/(^|\/)package\.json$/) || has(/(^|\/)(requirements\.txt|pyproject\.toml)$/);
	const database = type === "sqlite" || has(/\.(sql|sqlite|db)$/);
	const discord = has(/guild|channel|role|discord/) || /discord/i.test(name);
	const restoreOrder = [
		...(source ? ["Verify manifest and lockfile", "Restore source/configuration", "Install pinned dependencies", "Build and test in isolation"] : []),
		...(database ? ["Verify database format and schema", "Restore into a disposable database", "Run integrity checks before promotion"] : []),
		...(discord ? ["Review guild/channel/role identifiers", "Dry-run Discord configuration import", "Apply least-privilege configuration"] : []),
	];
	if (!restoreOrder.length) restoreOrder.push("Verify hash and provenance", "Inspect in an isolated environment", "Restore only validated components");
	return {
		kind: discord ? "discord-export" : database ? "database-backup" : source ? "source-artifact" : type.includes("executable") ? "application-binary" : "generic-artifact",
		restoreOrder,
		missingRecommended: [
			...(source && !has(/(^|\/)(package-lock\.json|npm-shrinkwrap\.json|poetry\.lock)$/) ? ["dependency lockfile"] : []),
			...(database && !has(/schema|migration/) ? ["schema or migrations"] : []),
			...(!has(/checksum|sha256|manifest/) ? ["signed checksum manifest"] : []),
		],
	};
}

async function submitSandbox(report: ArtifactReport, options: AnalyzeOptions): Promise<ArtifactReport["sandbox"]> {
	if (!options.sandboxUrl) return undefined;
	try {
		const response = await fetch(options.sandboxUrl, {
			method: "POST",
			headers: { "content-type": "application/json", ...(options.sandboxToken ? { authorization: `Bearer ${options.sandboxToken}` } : {}) },
			body: JSON.stringify({ sha256: report.sha256, name: report.name, size: report.size, detectedType: report.detectedType }),
			signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const body = await response.json() as { id?: string; status?: string };
		return { provider: new URL(options.sandboxUrl).host, reference: body.id, status: body.status ?? "submitted" };
	} catch (error) {
		return { provider: "configured sandbox", status: `unavailable; local analysis used (${error instanceof Error ? error.message : "unknown error"})` };
	}
}

export async function analyzeArtifact(name: string, buffer: Buffer, options: AnalyzeOptions = {}): Promise<ArtifactReport> {
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
	if (!buffer.length) throw new Error("Artifact is empty");
	if (buffer.length > maxBytes) throw new Error(`Artifact exceeds ${maxBytes} byte limit`);
	const detectedType = detectType(buffer);
	const warnings: string[] = [];
	let archive: ArtifactReport["archive"];
	if (detectedType === "zip") {
		archive = await inspectZip(buffer, options.maxEntries ?? DEFAULT_MAX_ENTRIES, options.maxExpandedBytes ?? DEFAULT_MAX_EXPANDED_BYTES);
		if (archive?.entries.some(entry => entry.risk)) warnings.push("Archive contains unsafe paths and must not be extracted");
	}
	if (["pe-executable", "elf-executable", "java-class-or-mach-o"].includes(detectedType)) warnings.push("Executable detected; this service does not execute artifacts");
	const extension = extname(name).toLowerCase();
	const compatibleExtensions: Record<string, string[]> = {
		zip: [".zip", ".jar", ".docx", ".xlsx", ".pptx"],
		text: [".txt", ".json", ".yaml", ".yml", ".csv", ".md", ".js", ".ts", ".py", ".xml"],
		"pe-executable": [".exe", ".dll", ".sys"],
		"elf-executable": [".elf", ".so", ""],
		sqlite: [".sqlite", ".sqlite3", ".db"],
		tar: [".tar"],
	};
	if (extension && compatibleExtensions[detectedType] && !compatibleExtensions[detectedType].includes(extension)) warnings.push("Declared extension may not match detected content");
	const report: ArtifactReport = {
		name: name.slice(0, 255),
		size: buffer.length,
		sha256: createHash("sha256").update(buffer).digest("hex"),
		detectedType,
		declaredExtension: extension || "none",
		entropy: Number(entropy(buffer).toFixed(3)),
		strings: extractStrings(buffer),
		...(archive ? { archive } : {}),
		recovery: buildRecovery(name, detectedType, archive?.entries),
		warnings,
	};
	report.sandbox = await submitSandbox(report, options);
	return report;
}
