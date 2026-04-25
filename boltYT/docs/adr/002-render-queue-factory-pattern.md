# ADR 002 — Render Queue: Factory Pattern 분리

**Status:** Accepted  
**Date:** 2026-04-25

## Context

`server/render-queue.ts`가 736줄로 커지면서 세 가지 관심사가 혼재했다:

1. **HTTP 라우팅** — 요청 파싱, 응답 직렬화
2. **잡 관리** — 큐 상태, 영속성(JSON), 중복 감지
3. **렌더 실행** — Puppeteer 풀, ffmpeg 호출, 진행도 추적

단일 파일 구조의 문제:
- 유닛 테스트 불가 (모듈 전체를 mock해야 함)
- 관심사 경계 없음 → 변경 시 전체 파일 이해 필요
- HTTP 레이어가 렌더 세부사항에 직접 의존

## Decision

**Factory 함수 패턴**으로 3개 모듈로 분리한다.

```
server/render-queue.ts      → HTTP 라우터 + 의존성 조립
server/lib/job-manager.ts   → createJobManager(rendersDir) → JobManager
server/lib/renderer.ts      → createRenderer(opts) → Renderer
```

각 팩토리는 순수하게 생성/조합만 하며, 사이드이펙트(파일 I/O, 프로세스 실행)는 반환된 인터페이스에만 존재한다.

## Consequences

**좋음:**
- `job-manager.ts` 독립 테스트 가능 (실제 렌더 없이)
- HTTP 라우터는 인터페이스만 알면 됨 — 렌더 구현 변경 시 라우터 무수정
- 각 파일 ~200-270줄로 가독성 향상

**나쁨:**
- 파일 3개로 늘어남 → import 체인 추적 필요
- 팩토리 파라미터 타입(`RendererOptions`) 관리 필요

## Rejected Alternatives

- **클래스 기반**: 테스트 시 상속/mock 필요, JS 생태계에서 factory가 더 관용적
- **단일 파일 유지 + 주석 구분**: 경계 강제가 없어 점진적 결합 재발
