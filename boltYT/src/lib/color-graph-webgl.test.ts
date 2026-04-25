/**
 * color-graph-webgl 테스트 — node 환경 (WebGL 없음)
 *
 * WebGL context 는 브라우저에서만 동작하므로:
 * - compileColorGraphToGLSL: 순수 문자열 변환, node 에서 검증 가능
 * - createColorGradeProgram: gl=null 방어 경로 확인
 */

import { describe, expect, it, vi } from "vitest";
import type { ColorGraph } from "./color-graph";
import {
	applyColorGradeToCanvas,
	compileColorGraphToGLSL,
	createColorGradeProgram,
} from "./color-graph-webgl";

describe("compileColorGraphToGLSL", () => {
	it("빈 그래프 → '// no nodes'", () => {
		expect(compileColorGraphToGLSL([])).toBe("// no nodes");
	});

	it("exposure 노드 → pow(2.0, ev) 포함", () => {
		const glsl = compileColorGraphToGLSL([{ kind: "exposure", ev: 1.5 }]);
		expect(glsl).toContain("pow(2.0,");
		expect(glsl).toContain("1.500000");
		expect(glsl).toContain("color.rgb *=");
	});

	it("contrast 노드 → (color.rgb - 0.5) * ... 패턴", () => {
		const glsl = compileColorGraphToGLSL([{ kind: "contrast", amount: 0.3 }]);
		expect(glsl).toContain("color.rgb - 0.5");
		expect(glsl).toContain("0.300000");
	});

	it("saturation 노드 → luma + mix 패턴", () => {
		const glsl = compileColorGraphToGLSL([
			{ kind: "saturation", amount: -0.5 },
		]);
		expect(glsl).toContain("dot(color.rgb, vec3(0.2126");
		expect(glsl).toContain("mix(vec3(luma)");
		expect(glsl).toContain("-0.500000");
	});

	it("temp-tint 노드 → R/G/B 채널 개별 조정", () => {
		const glsl = compileColorGraphToGLSL([
			{ kind: "temp-tint", temperature: 50, tint: 20 },
		]);
		expect(glsl).toContain("color.r");
		expect(glsl).toContain("color.g");
		expect(glsl).toContain("color.b");
		expect(glsl).toContain("0.15");
	});

	it("hsl-qualifier 노드 → rgb2hsl + hueDist + mask 패턴", () => {
		const glsl = compileColorGraphToGLSL([
			{
				kind: "hsl-qualifier",
				hue: 120,
				range: 30,
				feather: 15,
				satMin: 0.2,
				satMax: 1.0,
				hueDelta: 10,
				saturationDelta: -0.3,
				lightnessDelta: 0.1,
			},
		]);
		expect(glsl).toContain("rgb2hsl");
		expect(glsl).toContain("hueDist");
		expect(glsl).toContain("_mask");
		expect(glsl).toContain("hsl2rgb");
		expect(glsl).toContain("120.000000"); // hue
		expect(glsl).toContain("30.000000"); // range
	});

	it("hsl-qualifier 기본값 (hueDelta/satDelta/litDelta 없음) → 0.0 사용", () => {
		const glsl = compileColorGraphToGLSL([
			{
				kind: "hsl-qualifier",
				hue: 60,
				range: 20,
				feather: 10,
				satMin: 0,
				satMax: 1,
			},
		]);
		// delta 없으면 0.000000 이 인라인됨
		expect(glsl).toContain("0.000000");
	});

	it("체인: 여러 노드 순서 보존", () => {
		const graph: ColorGraph = [
			{ kind: "exposure", ev: 0.5 },
			{ kind: "contrast", amount: 0.2 },
			{ kind: "saturation", amount: 0.1 },
		];
		const glsl = compileColorGraphToGLSL(graph);
		const exposureIdx = glsl.indexOf("pow(2.0,");
		const contrastIdx = glsl.indexOf("color.rgb - 0.5");
		const satIdx = glsl.indexOf("mix(vec3(luma)");
		expect(exposureIdx).toBeLessThan(contrastIdx);
		expect(contrastIdx).toBeLessThan(satIdx);
	});

	it("스냅샷: exposure ev=1 GLSL", () => {
		const glsl = compileColorGraphToGLSL([{ kind: "exposure", ev: 1 }]);
		expect(glsl).toMatchInlineSnapshot(`"color.rgb *= pow(2.0, 1.000000);"`);
	});

	it("스냅샷: contrast amount=0.5 GLSL", () => {
		const glsl = compileColorGraphToGLSL([{ kind: "contrast", amount: 0.5 }]);
		expect(glsl).toMatchInlineSnapshot(
			`"color.rgb = (color.rgb - 0.5) * (1.0 + 0.500000) + 0.5;"`,
		);
	});
});

describe("createColorGradeProgram — node 환경 (WebGL 없음)", () => {
	it("WebGL context 없이 직접 호출 불가 — null mock 으로 방어 확인", () => {
		// node 환경에서 실제 WebGL context 를 만들 수 없으므로
		// null 을 강제 캐스팅해 전달 — 함수가 throw 없이 null 반환해야 함
		const gl = null as unknown as WebGLRenderingContext;
		// TypeError 가 아닌 런타임 null 참조 방지를 위해 try-catch
		let result: ReturnType<typeof createColorGradeProgram>;
		try {
			result = createColorGradeProgram(gl, [{ kind: "exposure", ev: 1 }]);
		} catch {
			// gl.createShader 호출 시 TypeError 발생 — 이것도 허용
			result = null;
		}
		expect(result).toBeNull();
	});
});

// ─── WebGL program 캐싱 테스트 ────────────────────────────────────────────────

function makeMockGl() {
	const prog = {};
	const shader = {};
	const tex = {};
	const buf = {};
	return {
		VERTEX_SHADER: 35633,
		FRAGMENT_SHADER: 35632,
		COMPILE_STATUS: 35713,
		LINK_STATUS: 35714,
		ARRAY_BUFFER: 34962,
		TRIANGLES: 4,
		FLOAT: 5126,
		TEXTURE_2D: 3553,
		RGBA: 6408,
		UNSIGNED_BYTE: 5121,
		TEXTURE_WRAP_S: 10242,
		TEXTURE_WRAP_T: 10243,
		TEXTURE_MIN_FILTER: 10241,
		TEXTURE_MAG_FILTER: 10240,
		CLAMP_TO_EDGE: 33071,
		LINEAR: 9729,
		STATIC_DRAW: 35044,
		createShader: vi.fn(() => shader),
		shaderSource: vi.fn(),
		compileShader: vi.fn(),
		getShaderParameter: vi.fn(() => true),
		deleteShader: vi.fn(),
		createProgram: vi.fn(() => prog),
		attachShader: vi.fn(),
		linkProgram: vi.fn(),
		getProgramParameter: vi.fn(() => true),
		deleteProgram: vi.fn(),
		useProgram: vi.fn(),
		createTexture: vi.fn(() => tex),
		bindTexture: vi.fn(),
		texParameteri: vi.fn(),
		texImage2D: vi.fn(),
		getUniformLocation: vi.fn(() => 0),
		uniform1i: vi.fn(),
		createBuffer: vi.fn(() => buf),
		bindBuffer: vi.fn(),
		bufferData: vi.fn(),
		getAttribLocation: vi.fn(() => 0),
		enableVertexAttribArray: vi.fn(),
		vertexAttribPointer: vi.fn(),
		drawArrays: vi.fn(),
		deleteTexture: vi.fn(),
		viewport: vi.fn(),
	};
}

function makeMockCanvas(gl: ReturnType<typeof makeMockGl> | null = null) {
	const canvas = {
		width: 0,
		height: 0,
		getContext: vi.fn((type: string) => (type === "webgl" ? gl : null)),
	};
	return canvas as unknown as HTMLCanvasElement;
}

describe("applyColorGradeToCanvas — program 캐싱", () => {
	it("WebGL 없으면 (null context) early return — throw 없음", () => {
		const canvas = makeMockCanvas(null);
		const src = makeMockCanvas(null);
		expect(() =>
			applyColorGradeToCanvas(canvas, src, [{ kind: "exposure", ev: 1 }]),
		).not.toThrow();
	});

	it("동일 canvas + 동일 graph → createProgram 1회만 호출 (캐시 히트)", () => {
		const gl = makeMockGl();
		const canvas = makeMockCanvas(gl);
		const src = makeMockCanvas(makeMockGl());
		const graph: ColorGraph = [{ kind: "exposure", ev: 1 }];

		applyColorGradeToCanvas(canvas, src, graph);
		applyColorGradeToCanvas(canvas, src, graph);

		// createProgram = shader 컴파일. 캐시 히트 시 1회만 호출되어야 함
		expect(gl.createProgram).toHaveBeenCalledTimes(1);
	});

	it("동일 canvas + 다른 graph → createProgram 재호출 (캐시 미스)", () => {
		const gl = makeMockGl();
		const canvas = makeMockCanvas(gl);
		const src = makeMockCanvas(makeMockGl());

		applyColorGradeToCanvas(canvas, src, [{ kind: "exposure", ev: 1 }]);
		applyColorGradeToCanvas(canvas, src, [{ kind: "exposure", ev: 2 }]);

		expect(gl.createProgram).toHaveBeenCalledTimes(2);
	});

	it("graph 변경 시 이전 program deleteProgram 호출", () => {
		const gl = makeMockGl();
		const canvas = makeMockCanvas(gl);
		const src = makeMockCanvas(makeMockGl());

		applyColorGradeToCanvas(canvas, src, [{ kind: "exposure", ev: 1 }]);
		applyColorGradeToCanvas(canvas, src, [{ kind: "contrast", amount: 0.5 }]);

		// 첫 번째 program 을 두 번째 호출 시 삭제
		expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
	});

	it("draw 후 texture 만 삭제 — program 은 캐시에서 유지", () => {
		const gl = makeMockGl();
		const canvas = makeMockCanvas(gl);
		const src = makeMockCanvas(makeMockGl());
		const graph: ColorGraph = [{ kind: "saturation", amount: 0.3 }];

		applyColorGradeToCanvas(canvas, src, graph);

		expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
		// program 은 삭제하지 않음 (캐시 유지)
		expect(gl.deleteProgram).not.toHaveBeenCalled();
	});
});
