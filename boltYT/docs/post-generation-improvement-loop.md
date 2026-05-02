# Post-Generation Improvement Loop

웹/앱 또는 영상 제작 기능을 만든 뒤에는 감으로 "괜찮다"를 말하지 않는다. 생성 직후 같은 루틴으로 판단하고, 고칠 수 있는 것은 자동으로 고친 뒤, 남은 실패를 다음 작업의 우선순위로 만든다.

## 실행

```bash
npm run quality:loop
```

자동 수정까지 허용할 때:

```bash
npm run quality:loop:fix
```

레퍼런스 후보를 새로 수집해야 할 때만:

```bash
npm run quality:loop -- --refresh-references
```

카테고리별 자동 레퍼런스를 계속 늘릴 때:

```bash
npm run reference:continue
```

저장된 메타 기반 레퍼런스 중 상위 후보를 실제 프레임/오디오/전사 기반 deep DNA로 승격할 때:

```bash
npm run reference:deep
```

`reference:deep`은 긴 영상을 통째로 저장하지 않는다. 대표 구간만 샘플링해 픽셀/컷/음량/전사 기반 `production_dna`를 만들고, 내장 템플릿에는 원본 프레임 URL 대신 숫자/규칙 DNA만 남긴다.

결과 보고서는 `.quality/post-generation-report.md`에 저장된다.

## 루틴

1. 레퍼런스 커버리지 확인: 드라마/영화, 미스터리/사건, 뉴스/이슈, AI/비즈니스, 돈/심리 카테고리별 자동 생성 레퍼런스가 최소 3개 이상 있어야 한다.
2. 빌드: `npm run build`로 타입, 번들, route lazy import 문제를 잡는다.
3. 테스트: `npm test --if-present`로 제작 파이프라인과 품질 게이트 회귀를 막는다.
4. 린트: `npm run lint`로 사용하지 않는 코드와 React/TypeScript 품질 문제를 막는다.
5. UI E2E: `npx playwright test e2e/references.spec.ts`로 브라우저 수동 제어 없이도 핵심 UI 상태를 검증한다.
6. 최종 게이트: `gan-harness verify .`로 Build/Test/Lint/TypeCheck/Secrets를 묶어 통과시킨다.

## 지금까지 반영한 작업

- 레퍼런스 영상은 원본 복사가 아니라 제작 DNA로만 저장한다.
- 자동 생성 레퍼런스는 localStorage에만 두지 않고 내장 템플릿으로 승격한다.
- 모든 자동 생성 레퍼런스는 최소 `metadata_only` production DNA를 갖고, `reference:deep`으로 카테고리별 핵심 후보를 `pixel_frame_audio_edit` DNA로 승격할 수 있다.
- `/references` 화면은 자동 생성 레퍼런스 수와 5/5 카테고리 완료 상태를 표시한다.
- 브라우저 제어가 닫히는 리스크는 Playwright E2E로 흡수한다.
- 영상 품질은 정적 이미지 흔들기, 의미 없는 카드 자막, 업로드용 메타 문구를 차단하는 방향으로 판단한다.
- BGM은 원곡 복제가 아니라 mood, tempo, keyword, scene energy curve 기준으로 새로 선택한다.
- 자료 기반 제작은 원본 영상/음악/대사 재사용을 금지하고, 구조와 편집 규칙만 재사용한다.

## 판단 기준

- `ship`: 모든 blocking gate 통과, 점수 92점 이상.
- `improve`: blocking 실패는 없지만 warning 또는 낮은 점수 존재. 보고서의 Next Actions를 먼저 처리한다.
- `blocked`: build/test/lint/E2E/harness/reference coverage 중 하나라도 실패. 배포나 다음 제작으로 넘어가지 않는다.

## 다음 작업에서의 사용법

새 웹/앱 기능을 만든 뒤 `quality:loop`를 먼저 실행한다. 실패가 나오면 실패 로그를 근거로 수정하고 다시 실행한다. 새 레퍼런스나 제작 규칙을 추가했다면 단위 테스트와 E2E를 같이 추가해 다음 작업의 자동 판단 기준으로 남긴다.
