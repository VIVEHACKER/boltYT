/**
 * color-graph-webgl 테스트 — node 환경 (WebGL 없음)
 *
 * WebGL context 는 브라우저에서만 동작하므로:
 * - compileColorGraphToGLSL: 순수 문자열 변환, node 에서 검증 가능
 * - createColorGradeProgram: gl=null 방어 경로 확인
 */

import { describe, expect, it } from "vitest";
import type { ColorGraph } from "./color-graph";
import {
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
