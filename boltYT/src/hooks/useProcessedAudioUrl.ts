import { useEffect, useRef, useState } from "react";
import type { AudioEffect } from "../lib/audio-effects";
import { renderWithEffects } from "../lib/audio-render";

/**
 * audioEffects가 있는 클립의 오디오를 OfflineAudioContext로 전처리하여 blob URL 반환.
 * 처리 중이거나 실패하면 원본 audioUrl을 반환 (무손실 fallback).
 * CORS 불가 URL 또는 처리 실패 시 원본 URL로 자동 fallback.
 */
export function useProcessedAudioUrl(
	audioUrl: string | undefined,
	effects: AudioEffect[] | undefined,
): string | undefined {
	const [blobUrl, setBlobUrl] = useState<string | undefined>(undefined);
	const blobRef = useRef<string | undefined>(undefined);

	// effects를 직렬화 키로 사용 — 배열 참조 변경에도 안정적 비교
	const effectsKey = effects?.length ? JSON.stringify(effects) : "";

	useEffect(() => {
		let cancelled = false;

		async function process() {
			// effects 없으면 blob 해제 후 undefined 반환
			if (!audioUrl || !effectsKey) {
				if (blobRef.current) {
					URL.revokeObjectURL(blobRef.current);
					blobRef.current = undefined;
				}
				setBlobUrl(undefined);
				return;
			}

			try {
				const r = await fetch(audioUrl);
				const buf = await r.arrayBuffer();
				const parsed: AudioEffect[] = JSON.parse(effectsKey);
				const result = await renderWithEffects(buf, parsed);
				if (cancelled) return;
				const blob = new Blob([result.buffer], { type: result.mimeType });
				const url = URL.createObjectURL(blob);
				if (blobRef.current) URL.revokeObjectURL(blobRef.current);
				blobRef.current = url;
				setBlobUrl(url);
			} catch {
				if (!cancelled) setBlobUrl(undefined);
			}
		}

		void process();

		return () => {
			cancelled = true;
		};
	}, [audioUrl, effectsKey]);

	// 언마운트 시 blob URL 해제
	useEffect(() => {
		return () => {
			if (blobRef.current) URL.revokeObjectURL(blobRef.current);
		};
	}, []);

	return blobUrl ?? audioUrl;
}
