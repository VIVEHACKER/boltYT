# Post-Generation Quality Report

- Verdict: ship
- Score: 100
- Generated at: 2026-05-04T16:42:57.912Z

## Checks

### PASS 레퍼런스 커버리지




```text
자동 생성 110개, deep 110/110, 평균 Q93, 평균 K97, 최저 Q78, 즉시 사용 69개, 성과 반영 0개
```

### PASS 프로덕션 빌드

Command: `npm run build`
Duration: 8s

```text
dist/assets/UploadsPage-DPDbxNFU.js                   37.50 kB │ gzip:  11.58 kB │ map:   101.33 kB
dist/assets/chunk-QFMPRPBF-BWa2BJRR.js                42.38 kB │ gzip:  15.04 kB │ map:   420.84 kB
dist/assets/GrowthCommandCenterPage-Bsq2YhFs.js       60.95 kB │ gzip:  18.80 kB │ map:   141.67 kB
dist/assets/ReferenceDetailPage-Bq0lrxG-.js           61.08 kB │ gzip:  16.30 kB │ map:   143.62 kB
dist/assets/types-CoQyoww3.js                        114.43 kB │ gzip:  35.47 kB │ map:   396.22 kB
dist/assets/TimelineEditor-D6yh2f5h.js               114.77 kB │ gzip:  33.91 kB │ map:   420.46 kB
dist/assets/index-BFEFYm-y.js                        194.98 kB │ gzip:  62.39 kB │ map:   822.14 kB
dist/assets/Composition-CZDCthjq.js                  196.96 kB │ gzip:  57.01 kB │ map:   691.46 kB
dist/assets/ContentWizardPage-DM3f079o.js            380.19 kB │ gzip: 121.32 kB │ map: 1,185.15 kB
✓ built in 1.15s
```

### PASS 단위/통합 테스트

Command: `npm test --if-present`
Duration: 6s

```text
{"ts":"2026-05-04T16:42:41.409Z","level":"info","service":"test-svc","msg":"SIGTERM received, shutting down gracefully"}
{"ts":"2026-05-04T16:42:41.409Z","level":"info","service":"test-svc","msg":"Server closed"}
{"ts":"2026-05-04T16:42:41.410Z","level":"info","service":"test-svc","msg":"SIGTERM received, shutting down gracefully"}
{"ts":"2026-05-04T16:42:41.410Z","level":"info","service":"test-svc","msg":"Server closed"}
{"ts":"2026-05-04T16:42:51.410Z","level":"warn","service":"test-svc","msg":"Forced shutdown after timeout"}
{"ts":"2026-05-04T16:42:41.413Z","level":"info","service":"test-svc","msg":"SIGTERM received, shutting down gracefully"}
{"ts":"2026-05-04T16:42:41.413Z","level":"info","service":"test-svc","msg":"Server closed"}
{"ts":"2026-05-04T16:42:51.413Z","level":"warn","service":"test-svc","msg":"Forced shutdown after timeout"}
{"ts":"2026-05-04T16:42:41.438Z","level":"warn","service":"test-service","msg":"Missing env vars: TEST_KEY_B"}
{"ts":"2026-05-04T16:42:41.443Z","level":"warn","service":"svc","msg":"Missing env vars: TEST_KEY_A, TEST_KEY_B"}
```

### PASS 정적 린트

Command: `npm run lint`
Duration: 12s

```text
> template@0.0.0 lint
> eslint .
```

### PASS exported dead-code 검사

Command: `npm run quality:dead-exports`
Duration: 1s

```text
> template@0.0.0 quality:dead-exports
> node scripts/check-dead-exports.mjs
dead-exports: PASS (424 files scanned, value exports)
```

### PASS 제작 파이프라인 10게이트

Command: `npm test -- --run src/lib/production-pipeline-guard.test.ts`
Duration: 1s

```text
> template@0.0.0 test
> vitest run --run src/lib/production-pipeline-guard.test.ts
RUN  v4.1.4 /Users/jjuni/bolt/boltYT
Test Files  1 passed (1)
Tests  4 passed (4)
Start at  01:42:57
Duration  175ms (transform 75ms, setup 16ms, import 82ms, tests 4ms, environment 0ms)
```

## Next Actions

- 생성물 기준 게이트를 통과했다. 다음 작업은 동일 루틴을 기준선으로 재사용한다.

## Project Learnings To Reuse

### 레퍼런스는 원본 복사가 아니라 제작 DNA

영상, 음악, 대사 자체를 가져오지 말고 컷 호흡, 화면 배치, TTS/BGM 톤, 대본 구조만 템플릿화한다.

- server/lib/reference-production-dna.ts
- src/lib/reference-bridge.ts
- src/lib/reference-template-presets.ts

### 자동 생성 레퍼런스는 localStorage에만 두지 않는다

브라우저 제어가 실패해도 재사용되도록 생성 레퍼런스는 코드 내장 템플릿으로 승격한다.

- scripts/reference-batch-template.ts
- src/lib/generated-reference-template-presets.ts
- src/pages/references/ReferenceListPage.tsx

### 영상 품질은 아이디어보다 제작 승인선이 먼저

정적 이미지 흔들기, 의미 없는 카드 자막, 업로드용 메타 문구가 들어가면 렌더 전 차단한다.

- src/lib/youtube-production-quality.ts
- src/lib/youtube-production-repair.ts
- docs/video-quality-reference-analysis.md

### BGM은 mood/tempo/keyword 기반으로 새로 선택

레퍼런스 BGM을 복제하지 않고 장면별 에너지 곡선과 메타 품질 점수로 골라야 한다.

- src/lib/bgm-quality.ts
- src/lib/bgm-cue-plan.ts
- docs/audio-production-quality-plan.md

### 수동 브라우저 제어 실패는 E2E로 흡수

in-app 브라우저 제어가 닫혀도 핵심 UI 상태는 Playwright E2E에서 확인되게 만든다.

- e2e/references.spec.ts
- playwright.config.ts

### 자료 기반 제작은 권리/정책 경계를 먼저 통과

원본 영상/음악/대사 재사용, 과한 유사 복제, 출처 없는 자료컷을 품질 게이트에서 차단한다.

- docs/youtube-policy-compliance-production.md
- src/lib/youtube-policy-risk.ts

### 레퍼런스는 Q 점수로 선택하고 낮은 품질은 생성 전 차단

레퍼런스 보관함은 Q/등급/보강 지점을 보여주는 데서 끝내지 말고, 생성 진입 전에 S/A를 우선 정렬하고 C/D 또는 정책 실패 레퍼런스는 차단한다.

- src/lib/reference-quality.ts
- src/lib/reference-template-presets.ts
- src/pages/content/StepScript.tsx

### 명시지와 암묵지는 성과지로 닫는다

규칙(명시지), 제작 DNA(암묵지), 렌더 QC 결과(성과지)를 하나의 knowledge profile로 묶어 다음 스크립트/미디어/렌더 선택에 반영한다.

- src/lib/knowledge-system.ts
- src/lib/reference-bridge.ts
- src/pages/content/StepPreview.tsx

### 제작 파이프라인은 10개 계약으로 충돌을 막는다

주제/브리프, 포맷, 대본 밀도, 스토리 편집, 씬 타임라인, 자료 인덱스, 샷 커버리지, 레퍼런스 품질, 렌더 QC, 업로드 준비를 독립 게이트로 검증한다.

- src/lib/production-pipeline-guard.ts
- src/lib/production-pipeline-guard.test.ts
- src/lib/post-generation-quality.ts

### export는 실제 사용되거나 명시적으로 공개돼야 한다

새 모듈을 추가할 때 named export가 외부에서 import되지 않으면 제거하고, 의도적 공개 API만 dead-export allowlist에 남긴다.

- scripts/check-dead-exports.mjs
- package.json
- src/lib/post-generation-quality.ts
