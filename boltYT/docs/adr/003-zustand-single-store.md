# ADR 003 — 타임라인 상태: 단일 Zustand 스토어 + useShallow 선택자

**Status:** Accepted  
**Date:** 2026-04-25

## Context

타임라인 편집기는 복잡한 상태 업데이트 패턴을 가진다:

- 클립 이동 → 선택, 스냅, undo 히스토리 동시 업데이트
- playhead 이동 → 멀티캠 switcher, scopes, curve editor 동기화 필요
- 50-frame undo/redo → 전체 `TimelineProject` 스냅샷 관리

## Decision

**단일 Zustand 스토어** (`timeline-store.ts`)를 유지하되, 컴포넌트에서 **`useShallow`** 선택자를 의무화한다.

```typescript
// ❌ 매 store 업데이트마다 re-render
const selected = useTimelineStore((s) => s.selected());

// ✅ 선택 클립 배열이 실제로 바뀔 때만 re-render
const selected = useTimelineStore(useShallow((s) => s.selected()));

// ✅ 이 트랙의 클립만 구독 — 다른 트랙 변경 시 re-render 없음
const clips = useTimelineStore(
  useShallow((s) => s.project ? clipsOnTrack(s.project, track.id) : [])
);
```

또한 bgm-analyze의 분석 루프를 **Web Worker**로 이동해 메인 스레드 블로킹을 제거한다.

## Consequences

**좋음:**
- 트랜잭션적 업데이트 — 여러 슬라이스를 원자적으로 변경 가능
- undo/redo가 단일 스냅샷으로 단순하게 구현됨
- `useShallow`로 불필요한 re-render 차단 (TrackV2 격리, selected() 안정화)

**나쁨:**
- 스토어 파일이 1,100줄 — 관심사 분리가 약함
- 모든 컴포넌트가 전체 스토어에 잠재적으로 접근 가능

## Rejected Alternatives

- **도메인별 스토어 분리** (color, audio, transform): 크로스 도메인 업데이트 시 동기화 복잡도 폭발, undo 구현이 여러 스토어에 걸쳐야 함
- **Redux Toolkit**: boilerplate 과다, Zustand 대비 이점 없음
- **useReducer + Context**: 렌더링 최적화 직접 구현 부담
