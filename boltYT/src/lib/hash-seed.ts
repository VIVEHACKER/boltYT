/**
 * 결정적 시드 생성 — narration/scriptId 같은 텍스트를 안정된 정수 시드로 변환.
 *
 * 기존: `narration.length % N` → 비슷한 길이 모두 같은 시드 (변주 부족)
 * 개선: FNV-1a 32-bit hash → 충돌률 매우 낮음 + 빠름
 */

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

/**
 * FNV-1a 32-bit hash. 입력 문자열 → uint32 양의 정수.
 */
export function fnv1a32(input: string): number {
	let hash = FNV_OFFSET;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		// Math.imul 로 32-bit 곱셈 안전
		hash = Math.imul(hash, FNV_PRIME);
	}
	// 양의 정수로 변환 (>>>0)
	return hash >>> 0;
}

/** hash 를 [0, modulus) 범위로 매핑 */
export function modSeed(input: string, modulus: number): number {
	if (modulus <= 0) return 0;
	return fnv1a32(input) % modulus;
}

/** hash 를 [0, 1) 범위 float 으로 변환 */
export function floatSeed(input: string): number {
	return fnv1a32(input) / 4294967296;
}
