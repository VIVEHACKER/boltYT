# Post-Generation Quality Report

- Verdict: ship
- Score: 100
- Generated at: 2026-05-02T21:52:36.754Z

## Checks

### PASS 레퍼런스 커버리지




```text
자동 생성 45개, 5/5 카테고리 3개 이상
```

### PASS 프로덕션 빌드

Command: `npm run build`
Duration: 6s

```text
dist/assets/index-MMdcPcls.js                  193.94 kB │ gzip:  61.93 kB │ map:   821.77 kB
dist/assets/Composition-BfLqW-gl.js            196.96 kB │ gzip:  57.01 kB │ map:   691.46 kB
dist/assets/ContentWizardPage-eYbrWrVT.js      335.92 kB │ gzip: 106.99 kB │ map: 1,062.49 kB
dist/assets/reference-import-ClSlSCyB.js     1,274.02 kB │ gzip: 214.19 kB │ map: 3,983.94 kB
✓ built in 765ms
[plugin builtin:vite-reporter]
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
```

### PASS 단위/통합 테스트

Command: `npm test --if-present`
Duration: 4s

```text
{"ts":"2026-05-02T21:52:16.811Z","level":"info","service":"test-svc","msg":"Server closed"}
{"ts":"2026-05-02T21:52:26.811Z","level":"warn","service":"test-svc","msg":"Forced shutdown after timeout"}
{"ts":"2026-05-02T21:52:16.812Z","level":"info","service":"test-svc","msg":"SIGTERM received, shutting down gracefully"}
{"ts":"2026-05-02T21:52:16.812Z","level":"info","service":"test-svc","msg":"Server closed"}
{"ts":"2026-05-02T21:52:16.812Z","level":"info","service":"test-svc","msg":"SIGTERM received, shutting down gracefully"}
{"ts":"2026-05-02T21:52:16.812Z","level":"info","service":"test-svc","msg":"Server closed"}
{"ts":"2026-05-02T21:52:26.812Z","level":"warn","service":"test-svc","msg":"Forced shutdown after timeout"}
{"ts":"2026-05-02T21:52:16.814Z","level":"info","service":"test-svc","msg":"SIGTERM received, shutting down gracefully"}
{"ts":"2026-05-02T21:52:16.814Z","level":"info","service":"test-svc","msg":"Server closed"}
{"ts":"2026-05-02T21:52:26.814Z","level":"warn","service":"test-svc","msg":"Forced shutdown after timeout"}
```

### PASS 정적 린트

Command: `npm run lint`
Duration: 10s

```text
> template@0.0.0 lint
> eslint .
[BABEL] Note: The code generator has deoptimised the styling of /Users/jjuni/bolt/boltYT/src/lib/generated-reference-template-presets.ts as it exceeds the max of 500KB.
```

### PASS 레퍼런스 UI E2E

Command: `npx playwright test e2e/references.spec.ts`
Duration: 9s

```text
[2m[WebServer] [22m- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
[2m[WebServer] [22m- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.[0m[39m
[2m[WebServer] [22m(node:78494) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
[2m[WebServer] [22m(Use `node --trace-warnings ...` to show where the warning was created)
[2m[WebServer] [22m(node:78525) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
[2m[WebServer] [22m(Use `node --trace-warnings ...` to show where the warning was created)
(node:78536) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:78536) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
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
