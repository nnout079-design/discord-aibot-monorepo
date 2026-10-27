import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { analyzeArtifact } from "./artifact-analyzer";

const MAX_BODY_BYTES = 35 * 1024 * 1024;

async function readJson(request: IncomingMessage): Promise<{ name?: string; dataBase64?: string; authorized?: boolean }> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		const value = Buffer.from(chunk);
		size += value.length;
		if (size > MAX_BODY_BYTES) throw new Error("Request body too large");
		chunks.push(value);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response: ServerResponse, status: number, body: unknown): void {
	response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
	response.end(JSON.stringify(body));
}

export function startAnalysisServer(): void {
	const port = Number(process.env.ARTIFACT_ANALYSIS_PORT ?? 0);
	if (!port) return;
	const token = process.env.ARTIFACT_ANALYSIS_TOKEN;
	if (!token) throw new Error("ARTIFACT_ANALYSIS_TOKEN is required when ARTIFACT_ANALYSIS_PORT is enabled");
	createServer(async (request, response) => {
		if (request.method === "GET" && request.url === "/health") return send(response, 200, { status: "ok" });
		if (request.method !== "POST" || request.url !== "/analyze") return send(response, 404, { error: "not found" });
		if (request.headers.authorization !== `Bearer ${token}`) return send(response, 401, { error: "unauthorized" });
		try {
			const body = await readJson(request);
			if (body.authorized !== true) return send(response, 400, { error: "authorized must be true" });
			if (!body.name || !body.dataBase64) return send(response, 400, { error: "name and dataBase64 are required" });
			const buffer = Buffer.from(body.dataBase64, "base64");
			const report = await analyzeArtifact(body.name, buffer, {
				sandboxUrl: process.env.ARTIFACT_SANDBOX_URL,
				sandboxToken: process.env.ARTIFACT_SANDBOX_TOKEN,
			});
			return send(response, 200, report);
		} catch (error) {
			return send(response, 400, { error: error instanceof Error ? error.message : "analysis failed" });
		}
	}).listen(port, "0.0.0.0", () => console.log(`Artifact analysis API listening on ${port}`));
}
