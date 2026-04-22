/**
 * ColorGraph → WebGL fragment shader 컴파일러.
 *
 * hsl-qualifier 포함 모든 노드를 GLSL 로 변환해 GPU 에서 처리.
 * node 환경(테스트)에서는 gl === null 방어 경로로 null 반환.
 */

import type { ColorGraph, ColorNode } from "./color-graph";

// ─── GLSL 헬퍼 함수 (fragment shader 상단에 인라인) ───

const GLSL_HELPERS = /* glsl */ `
// BT.709 RGB → HSL
vec3 rgb2hsl(vec3 c) {
  float maxC = max(c.r, max(c.g, c.b));
  float minC = min(c.r, min(c.g, c.b));
  float l = (maxC + minC) * 0.5;
  if (maxC == minC) return vec3(0.0, 0.0, l);
  float d = maxC - minC;
  float s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);
  float h;
  if (maxC == c.r)      h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
  else if (maxC == c.g) h = (c.b - c.r) / d + 2.0;
  else                  h = (c.r - c.g) / d + 4.0;
  h *= 60.0;
  return vec3(h, s, l);
}

float hsl_hue2rgb(float p, float q, float t) {
  float u = mod(t, 1.0);
  if (u < 1.0 / 6.0) return p + (q - p) * 6.0 * u;
  if (u < 0.5)        return q;
  if (u < 2.0 / 3.0)  return p + (q - p) * (2.0 / 3.0 - u) * 6.0;
  return p;
}

// HSL → RGB
vec3 hsl2rgb(vec3 hsl) {
  float h = hsl.x / 360.0;
  float s = hsl.y;
  float l = hsl.z;
  if (s == 0.0) return vec3(l);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return vec3(
    hsl_hue2rgb(p, q, h + 1.0 / 3.0),
    hsl_hue2rgb(p, q, h),
    hsl_hue2rgb(p, q, h - 1.0 / 3.0)
  );
}

float hueDist(float a, float b) {
  float d = abs(mod(a - b + 180.0, 360.0) - 180.0);
  return d;
}
`;

// ─── 노드별 GLSL 코드 생성 ───

function nodeToGLSL(node: ColorNode): string {
	switch (node.kind) {
		case "exposure": {
			const ev = node.ev.toFixed(6);
			return `color.rgb *= pow(2.0, ${ev});`;
		}
		case "contrast": {
			const a = node.amount.toFixed(6);
			return `color.rgb = (color.rgb - 0.5) * (1.0 + ${a}) + 0.5;`;
		}
		case "saturation": {
			const a = node.amount.toFixed(6);
			return [
				`{ float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));`,
				`  color.rgb = mix(vec3(luma), color.rgb, 1.0 + ${a}); }`,
			].join("\n  ");
		}
		case "temp-tint": {
			const t = (node.temperature / 100).toFixed(6);
			const n = (node.tint / 100).toFixed(6);
			return [
				`{ float _t = ${t}; float _n = ${n};`,
				`  color.r = clamp(color.r + 0.15 * _t, 0.0, 1.0);`,
				`  color.g = clamp(color.g - 0.05 * _n, 0.0, 1.0);`,
				`  color.b = clamp(color.b - 0.15 * _t + 0.05 * _n, 0.0, 1.0); }`,
			].join("\n  ");
		}
		case "hsl-qualifier": {
			const hue = node.hue.toFixed(6);
			const range = node.range.toFixed(6);
			const feather = Math.max(node.feather, 1e-6).toFixed(6);
			const satMin = node.satMin.toFixed(6);
			const satMax = node.satMax.toFixed(6);
			const hueDelta = (node.hueDelta ?? 0).toFixed(6);
			const satDelta = (node.saturationDelta ?? 0).toFixed(6);
			const litDelta = (node.lightnessDelta ?? 0).toFixed(6);
			return [
				`{`,
				`  vec3 _hsl = rgb2hsl(color.rgb);`,
				`  float _dh = hueDist(_hsl.x, ${hue});`,
				`  float _hueMask = 0.0;`,
				`  if (_dh <= ${range}) _hueMask = 1.0;`,
				`  else if (_dh <= ${range} + ${feather}) _hueMask = 1.0 - (_dh - ${range}) / ${feather};`,
				`  float _satMask = (_hsl.y >= ${satMin} && _hsl.y <= ${satMax}) ? 1.0 : 0.0;`,
				`  float _mask = clamp(_hueMask * _satMask, 0.0, 1.0);`,
				`  if (_mask > 0.0) {`,
				`    _hsl.x += ${hueDelta} * _mask;`,
				`    _hsl.y = clamp(_hsl.y + ${satDelta} * _mask, 0.0, 1.0);`,
				`    _hsl.z = clamp(_hsl.z + ${litDelta} * _mask, 0.0, 1.0);`,
				`    color.rgb = hsl2rgb(_hsl);`,
				`  }`,
				`}`,
			].join("\n  ");
		}
	}
}

// ─── 공통 vertex shader ───

const VERTEX_SHADER_SRC = /* glsl */ `
attribute vec2 a_position;
varying vec2 v_texCoord;
void main() {
  // [-1,1] → [0,1] UV 매핑 (Y 반전 없음 — 텍스처 기준)
  v_texCoord = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`.trim();

// ─── public API ───

/**
 * ColorGraph → fragment shader main() body GLSL 문자열.
 * helpers(rgb2hsl 등)는 별도 포함되므로 반환값은 노드 코드만.
 */
export function compileColorGraphToGLSL(graph: ColorGraph): string {
	if (graph.length === 0) return "// no nodes";
	return graph.map(nodeToGLSL).join("\n  ");
}

/**
 * fragment shader 전체 소스 생성 (helpers + main).
 */
function buildFragmentShaderSrc(graph: ColorGraph): string {
	const body = compileColorGraphToGLSL(graph);
	return /* glsl */ `precision mediump float;
uniform sampler2D u_texture;
varying vec2 v_texCoord;
${GLSL_HELPERS}
void main() {
  vec4 color = texture2D(u_texture, v_texCoord);
  ${body}
  color = clamp(color, 0.0, 1.0);
  gl_FragColor = color;
}`;
}

function compileShader(
	gl: WebGLRenderingContext,
	type: number,
	src: string,
): WebGLShader | null {
	const shader = gl.createShader(type);
	if (!shader) return null;
	gl.shaderSource(shader, src);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		// 컴파일 실패 — caller 가 fallback 처리
		gl.deleteShader(shader);
		return null;
	}
	return shader;
}

/**
 * WebGL program 생성 + 컴파일.
 * node 환경 또는 WebGL 미지원 시 null 반환 (caller 가 CSS fallback 사용).
 */
export function createColorGradeProgram(
	gl: WebGLRenderingContext,
	graph: ColorGraph,
): WebGLProgram | null {
	const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
	if (!vs) return null;

	const fragSrc = buildFragmentShaderSrc(graph);
	const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
	if (!fs) {
		gl.deleteShader(vs);
		return null;
	}

	const prog = gl.createProgram();
	if (!prog) {
		gl.deleteShader(vs);
		gl.deleteShader(fs);
		return null;
	}

	gl.attachShader(prog, vs);
	gl.attachShader(prog, fs);
	gl.linkProgram(prog);

	gl.deleteShader(vs);
	gl.deleteShader(fs);

	if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
		gl.deleteProgram(prog);
		return null;
	}
	return prog;
}

/** 풀스크린 quad 버퍼 (WebGL 1 호환) */
function setupQuad(gl: WebGLRenderingContext, prog: WebGLProgram): void {
	const buf = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, buf);
	// 두 삼각형으로 [-1,1] 풀스크린 quad
	const verts = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
	gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
	const loc = gl.getAttribLocation(prog, "a_position");
	gl.enableVertexAttribArray(loc);
	gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
}

/**
 * sourceCanvas → WebGL 색보정 처리 → canvas 에 출력.
 * WebGL 컨텍스트를 직접 생성하므로 canvas 는 WebGL canvas 여야 함.
 *
 * 색보정 program 은 외부에서 useMemo 로 캐싱하고 이 함수로 드로우만 처리.
 */
export function applyColorGradeToCanvas(
	canvas: HTMLCanvasElement,
	sourceCanvas: HTMLCanvasElement,
	graph: ColorGraph,
): void {
	const gl = canvas.getContext("webgl") as WebGLRenderingContext | null;
	if (!gl) return; // WebGL 미지원 — fallback 은 caller 가 처리

	canvas.width = sourceCanvas.width;
	canvas.height = sourceCanvas.height;
	gl.viewport(0, 0, canvas.width, canvas.height);

	const prog = createColorGradeProgram(gl, graph);
	if (prog) {
		// biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram is a WebGL method, not a React hook
		gl.useProgram(prog);

		// 텍스처 업로드
		const tex = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.RGBA,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			sourceCanvas,
		);

		const texLoc = gl.getUniformLocation(prog, "u_texture");
		gl.uniform1i(texLoc, 0);

		setupQuad(gl, prog);
		gl.drawArrays(gl.TRIANGLES, 0, 6);

		// 정리
		gl.deleteTexture(tex);
		gl.deleteProgram(prog);
	}
}
