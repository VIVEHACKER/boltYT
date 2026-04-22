/**
 * useAudioPreview — Web Audio API 실시간 이펙트 미리보기 훅.
 *
 * AudioContext 싱글턴 관리, buildEffectChain 연결,
 * effects 변경 시 체인 재구성 (재생 중이면 즉시 반영).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioEffect } from "../lib/audio-effects";
import { buildEffectChain } from "../lib/audio-effects-web";
import { useTimelineStore } from "../lib/timeline-store";

export interface AudioPreviewHandle {
	isPlaying: boolean;
	isSupported: boolean;
	hasSource: boolean;
	play: () => Promise<void>;
	stop: () => void;
}

const isWebAudioSupported =
	typeof globalThis.AudioContext !== "undefined" ||
	// @ts-expect-error — webkit prefix fallback
	typeof globalThis.webkitAudioContext !== "undefined";

export function useAudioPreview(
	clipId: string | null,
	effects: AudioEffect[],
): AudioPreviewHandle {
	const project = useTimelineStore((s) => s.project);

	// ── Refs (렌더 간 유지, 재생성 금지) ──────────────────────────
	const ctxRef = useRef<AudioContext | null>(null);
	const sourceRef = useRef<AudioBufferSourceNode | null>(null);
	const bufferRef = useRef<AudioBuffer | null>(null);
	const isPlayingRef = useRef(false);
	// 항상 최신 effects 참조 — 클로저 staleness 방지
	const effectsRef = useRef<AudioEffect[]>(effects);

	useEffect(() => {
		effectsRef.current = effects;
	}, [effects]);

	const [isPlaying, setIsPlaying] = useState(false);

	// 클립 오디오 URL 결정
	const audioUrl: string | undefined = (() => {
		if (!clipId || !project) return undefined;
		const clip = project.clips.find((c) => c.id === clipId);
		if (!clip) return undefined;
		return clip.audioUrl ?? clip.mediaUrl ?? undefined;
	})();

	// 오디오 소스 + 체인 해제 (useCallback → stable ref, dep 없음)
	const disconnectSource = useCallback(() => {
		try {
			sourceRef.current?.stop();
		} catch {
			// already stopped — ignore
		}
		sourceRef.current?.disconnect();
		sourceRef.current = null;
	}, []);

	// AudioContext 초기화 또는 재사용
	const getOrCreateCtx = useCallback((): AudioContext | null => {
		if (!isWebAudioSupported) return null;
		if (!ctxRef.current) {
			const g = globalThis as typeof globalThis & {
				webkitAudioContext?: typeof AudioContext;
			};
			const Ctor = (globalThis.AudioContext ??
				g.webkitAudioContext) as typeof AudioContext;
			ctxRef.current = new Ctor();
		}
		return ctxRef.current;
	}, []);

	// 버퍼 + 이펙트 체인 연결 → source 시작
	const reconnectChain = useCallback(
		(ctx: AudioContext, buf: AudioBuffer) => {
			disconnectSource();
			const src = ctx.createBufferSource();
			src.buffer = buf;
			const chainOut = buildEffectChain(ctx, src, effectsRef.current);
			chainOut.connect(ctx.destination);
			sourceRef.current = src;
			src.onended = () => {
				isPlayingRef.current = false;
				setIsPlaying(false);
			};
			src.start();
		},
		[disconnectSource],
	);

	// effects 변경 시 재생 중이면 체인 즉시 재구성
	// biome-ignore lint/correctness/useExhaustiveDependencies: effects는 prop 배열, 변경 감지를 위해 dep에 포함
	useEffect(() => {
		if (!isPlayingRef.current) return;
		const ctx = ctxRef.current;
		const buf = bufferRef.current;
		if (!ctx || !buf) return;
		reconnectChain(ctx, buf);
	}, [effects, reconnectChain]);

	// 언마운트 시 AudioContext suspend
	useEffect(() => {
		return () => {
			disconnectSource();
			ctxRef.current?.suspend().catch(() => {});
		};
	}, [disconnectSource]);

	const stop = useCallback(() => {
		disconnectSource();
		isPlayingRef.current = false;
		setIsPlaying(false);
	}, [disconnectSource]);

	const play = useCallback(async () => {
		if (!isWebAudioSupported || !audioUrl) return;
		const ctx = getOrCreateCtx();
		if (!ctx) return;

		if (ctx.state === "suspended") {
			await ctx.resume();
		}

		// 버퍼 캐싱 — 동일 URL이면 재사용
		let buf = bufferRef.current;
		if (!buf) {
			try {
				const res = await fetch(audioUrl);
				const arrayBuf = await res.arrayBuffer();
				buf = await ctx.decodeAudioData(arrayBuf);
				bufferRef.current = buf;
			} catch {
				return;
			}
		}

		reconnectChain(ctx, buf);
		isPlayingRef.current = true;
		setIsPlaying(true);
	}, [audioUrl, getOrCreateCtx, reconnectChain]);

	// clipId 변경 시 버퍼 캐시 초기화
	// biome-ignore lint/correctness/useExhaustiveDependencies: clipId는 prop, 변경 감지를 위해 dep에 포함
	useEffect(() => {
		bufferRef.current = null;
		disconnectSource();
		isPlayingRef.current = false;
		const timeout = window.setTimeout(() => {
			setIsPlaying(false);
		}, 0);
		return () => window.clearTimeout(timeout);
	}, [clipId, disconnectSource]);

	return {
		isPlaying,
		isSupported: isWebAudioSupported,
		hasSource: !!audioUrl,
		play,
		stop,
	};
}
