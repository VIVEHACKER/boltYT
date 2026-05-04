# Post-Generation Quality Report

- Verdict: ship
- Score: 100
- Generated at: 2026-05-04T11:50:14.083Z

## Checks

### PASS 레퍼런스 커버리지




```text
자동 생성 110개, deep 110/110, 평균 Q93, 평균 K97, 최저 Q78, 즉시 사용 69개, 성과 반영 0개
```

### PASS 프로덕션 빌드

Command: `npm run build`
Duration: 7s

```text
dist/assets/NicheResearchPage-CSmllO9G.js           20.12 kB │ gzip:   6.19 kB │ map:    54.84 kB
dist/assets/reference-import-M60kRXK8.js            25.70 kB │ gzip:   9.56 kB │ map:    66.59 kB
dist/assets/ReferenceImportPage-CxHmey52.js         36.24 kB │ gzip:  11.18 kB │ map:    89.08 kB
dist/assets/chunk-QFMPRPBF-BWa2BJRR.js              42.38 kB │ gzip:  15.04 kB │ map:   420.84 kB
dist/assets/types-DX-3xFsU.js                      114.43 kB │ gzip:  35.48 kB │ map:   396.22 kB
dist/assets/TimelineEditor-ClUXZYy2.js             115.04 kB │ gzip:  34.03 kB │ map:   422.69 kB
dist/assets/index-YtXwlzsU.js                      194.05 kB │ gzip:  61.98 kB │ map:   821.77 kB
dist/assets/Composition-CXiFAMRf.js                196.96 kB │ gzip:  57.01 kB │ map:   691.46 kB
dist/assets/ContentWizardPage-33vuYAhb.js          337.65 kB │ gzip: 107.55 kB │ map: 1,068.81 kB
✓ built in 1.14s
```

### PASS 단위/통합 테스트

Command: `npm test --if-present`
Duration: 4s

```text
{"ts":"2026-05-04T11:50:03.640Z","level":"info","service":"test-svc","msg":"SIGTERM received, shutting down gracefully"}
{"ts":"2026-05-04T11:50:03.640Z","level":"info","service":"test-svc","msg":"Server closed"}
{"ts":"2026-05-04T11:50:03.640Z","level":"info","service":"test-svc","msg":"SIGTERM received, shutting down gracefully"}
{"ts":"2026-05-04T11:50:03.640Z","level":"info","service":"test-svc","msg":"Server closed"}
{"ts":"2026-05-04T11:50:13.640Z","level":"warn","service":"test-svc","msg":"Forced shutdown after timeout"}
{"ts":"2026-05-04T11:50:03.642Z","level":"info","service":"test-svc","msg":"SIGTERM received, shutting down gracefully"}
{"ts":"2026-05-04T11:50:03.642Z","level":"info","service":"test-svc","msg":"Server closed"}
{"ts":"2026-05-04T11:50:13.642Z","level":"warn","service":"test-svc","msg":"Forced shutdown after timeout"}
{"ts":"2026-05-04T11:50:03.701Z","level":"warn","service":"test-service","msg":"Missing env vars: TEST_KEY_B"}
{"ts":"2026-05-04T11:50:03.705Z","level":"warn","service":"svc","msg":"Missing env vars: TEST_KEY_A, TEST_KEY_B"}
```

### PASS 정적 린트

Command: `npm run lint`
Duration: 9s

```text
> template@0.0.0 lint
> eslint .
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
