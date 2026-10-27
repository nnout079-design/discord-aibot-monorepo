import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { analyzeArtifact } from "./artifact-analyzer";

async function main(): Promise<void> {
	const input = process.argv[2];
	if (!input || !process.argv.includes("--authorized")) {
		throw new Error("Usage: npm run analyze -- <path> --authorized");
	}
	const path = resolve(input);
	const report = await analyzeArtifact(basename(path), await readFile(path), {
		sandboxUrl: process.env.ARTIFACT_SANDBOX_URL,
		sandboxToken: process.env.ARTIFACT_SANDBOX_TOKEN,
	});
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch(error => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
