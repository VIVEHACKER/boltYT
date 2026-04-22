/**
 * compress.ts 단위 테스트
 *
 * sendCompressed: Node HTTP mock 사용.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { sendCompressed } from "./compress.ts";

function makeReq(acceptEncoding?: string): IncomingMessage {
	return {
		headers: acceptEncoding ? { "accept-encoding": acceptEncoding } : {},
	} as unknown as IncomingMessage;
}

function makeRes() {
	const written: Buffer[] = [];
	const headers: Record<string, string> = {};
	let statusCode = 0;
	let ended = false;
	return {
		writeHead: vi.fn((code: number, h: Record<string, string>) => {
			statusCode = code;
			Object.assign(headers, h);
		}),
		end: vi.fn((data?: Buffer | string) => {
			if (data)
				written.push(typeof data === "string" ? Buffer.from(data) : data);
			ended = true;
		}),
		write: vi.fn(),
		on: vi.fn(),
		once: vi.fn(),
		emit: vi.fn(),
		pipe: vi.fn(),
		_statusCode: () => statusCode,
		_headers: () => headers,
		_ended: () => ended,
	} as unknown as ServerResponse & {
		_statusCode: () => number;
		_headers: () => Record<string, string>;
		_ended: () => boolean;
	};
}

describe("sendCompressed", () => {
	it("gzip 미지원 → Content-Length 헤더 + res.end 직접 호출", () => {
		const req = makeReq();
		const res = makeRes() as ReturnType<typeof makeRes>;
		sendCompressed(
			req,
			res,
			200,
			{ "Content-Type": "application/json" },
			'{"ok":true}',
		);
		expect(res.writeHead).toHaveBeenCalledWith(
			200,
			expect.objectContaining({ "Content-Length": expect.any(String) }),
		);
		expect(res.end).toHaveBeenCalledWith('{"ok":true}');
	});

	it("gzip 미지원 → Content-Encoding 헤더 없음", () => {
		const req = makeReq("identity");
		const res = makeRes() as ReturnType<typeof makeRes>;
		sendCompressed(req, res, 200, {}, "hello");
		const [, headers] = (res.writeHead as ReturnType<typeof vi.fn>).mock
			.calls[0];
		expect(headers).not.toHaveProperty("Content-Encoding");
	});

	it("gzip 지원 → Content-Encoding: gzip 헤더 포함", () => {
		const req = makeReq("gzip, deflate");
		const res = makeRes() as ReturnType<typeof makeRes>;
		sendCompressed(
			req,
			res,
			200,
			{ "Content-Type": "text/plain" },
			"compressed body",
		);
		const [code, headers] = (res.writeHead as ReturnType<typeof vi.fn>).mock
			.calls[0];
		expect(code).toBe(200);
		expect(headers["Content-Encoding"]).toBe("gzip");
		expect(headers.Vary).toBe("Accept-Encoding");
	});

	it("accept-encoding 배열값 → gzip 처리 없음", () => {
		const req = {
			headers: { "accept-encoding": ["gzip", "deflate"] },
		} as unknown as IncomingMessage;
		const res = makeRes() as ReturnType<typeof makeRes>;
		sendCompressed(req, res, 404, {}, "not found");
		const [code] = (res.writeHead as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(code).toBe(404);
	});

	it("커스텀 헤더 유지", () => {
		const req = makeReq();
		const res = makeRes() as ReturnType<typeof makeRes>;
		sendCompressed(req, res, 201, { "X-Custom": "value" }, "body");
		const [, headers] = (res.writeHead as ReturnType<typeof vi.fn>).mock
			.calls[0];
		expect(headers["X-Custom"]).toBe("value");
	});
});
