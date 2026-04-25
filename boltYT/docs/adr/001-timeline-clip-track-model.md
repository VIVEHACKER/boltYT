# ADR 001 — Timeline V2: Clip-on-Track 모델

**Status:** Accepted  
**Date:** 2026-04-25

## Context

초기 구현(V1)은 Scene 배열(`TimelineScene[]`)을 직접 조작했다. 각 Scene은 순서·duration을 가졌고 편집은 배열 인덱스 기반이었다.

문제점:
- 멀티캠 편집 불가 — 동시 복수 트랙이 없음
- B-roll, 오버레이 불가 — 단일 시퀀스 구조
- 정밀 트리밍 불가 — 프레임 단위 조작이 없음
- 영상 편집 표준(NLE)과 괴리 — 협업/확장 어려움

## Decision

**Clip-on-Track 모델**을 채택한다.

- `TimelineProject` → `TimelineTrack[]` → `TimelineClip[]`
- 클립은 `startFrame`/`durationFrames`/`sourceInFrame`을 가지며 트랙에 독립 배치
- 렌더 시 `toRemotionScenes()`로 역변환 — Remotion 레이어와 완전 분리
- 50-frame undo/redo 히스토리 (Zustand snapshot)

## Consequences

**좋음:**
- NLE 표준 편집 오퍼레이션 구현 가능 (trim, split, ripple, roll, slip, slide)
- 멀티캠 그룹, 오버레이 트랙 자연스럽게 지원
- timeline-model.ts가 순수 함수 → 테스트 용이

**나쁨:**
- V1 → V2 마이그레이션 필요 (`fromScenes()` 어댑터 작성)
- 저장 시 Supabase Scene 레코드로 역변환하는 비용
- 복잡도 증가 — `timeline-model.ts` 1,100줄+

## Rejected Alternatives

- **V1 유지 + 레이어 추가**: 배열 기반에서 멀티캠 구현 시 인덱스 복잡도 폭발
- **외부 NLE 라이브러리(Remotion Studio)**: 커스터마이즈 불가, 번들 크기 문제
