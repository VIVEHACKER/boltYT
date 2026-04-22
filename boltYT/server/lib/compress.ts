/**
 * 응답 압축 — Accept-Encoding: gzip 지원
 */

import { createGzip } from "node:zlib";

export function sendCompressed(
	req: import("node:http").IncomingMessage,
	res: import("node:http").ServerResponse,
	statusCode: number,
	headers: Record<string, string>,
	body: string,
) {
	const acceptEncoding = req.headers["accept-encoding"] ?? "";
	if (typeof acceptEncoding === "string" && acceptEncoding.includes("gzip")) {
		const gz = createGzip();
		res.writeHead(statusCode, {
			...headers,
			"Content-Encoding": "gzip",
			Vary: "Accept-Encoding",
		});
		gz.pipe(res);
		gz.end(body);
	} else {
		res.writeHead(statusCode, {
			...headers,
			"Content-Length": String(Buffer.byteLength(body)),
		});
		res.end(body);
	}
}
