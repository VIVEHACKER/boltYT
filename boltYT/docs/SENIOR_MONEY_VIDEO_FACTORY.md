# 시니어 머니체크 영상 팩토리

공식 정책 자료를 바탕으로 같은 주제의 세로 쇼츠와 가로 롱폼을 한 번에 만드는 템플릿입니다. 기본 1편은 `2026 기초연금 247만 원의 진짜 뜻`입니다.

## 바로 제작

```bash
TTS_PROVIDER=edge TTS_SPEED=1 npm run senior:money
```

형식별 제작:

```bash
npm run senior:money:shorts
npm run senior:money:longform
```

spec·TTS·렌더 설정의 SHA-256 지문이 바뀌면 카드, 음성, 영상이 자동으로 다시 만들어집니다. 같은 내용도 강제로 다시 만들려면 `--force`, 영상 렌더 전 카드·음성·썸네일만 확인하려면 `--assets-only`를 붙입니다. `--assets-only` 실행 뒤 manifest 상태는 `assets_ready`가 되고 다음 일반 실행에서 영상을 다시 렌더합니다.

```bash
npm run senior:money -- --force
npm run senior:money -- --assets-only --force
```

`--adopt-existing`은 지문 기능 도입 전에 만든 산출물을 한 번만 등록하는 마이그레이션 옵션입니다. 새 에피소드 제작에는 사용하지 않습니다.

## 다음 편 만들기

1. `content/senior-money/basic-pension-2026.json`을 복사합니다.
2. `id`, 제목, `presentation`, `safety`, 공식 출처, 장면 문구와 내레이션을 바꿉니다.
3. 아래처럼 새 JSON을 지정합니다.

```bash
npx tsx scripts/make-senior-money.ts \
  --spec content/senior-money/my-next-episode.json \
  --format both
```

각 장면은 다음 레이아웃을 지원합니다.

- `headline`: 핵심 숫자나 오해 교정형 훅
- `split`: 단독가구·부부가구처럼 두 수치 비교
- `formula`: 계산 구조 설명
- `checklist`: 사실·주의점 목록
- `steps`: 신청 순서·행동 지침

`presentation`에는 화면에 보일 브랜드 근거 배지, 기준일 고지, 썸네일 보조 문구, 인트로 제목, 아웃트로 CTA를 넣습니다. 코드에 특정 정책명이나 연도가 고정되지 않으므로 새 주제의 값을 모두 JSON에서 바꿀 수 있습니다.

`safety.requiredFacts`에는 쇼츠와 롱폼 각각에 반드시 존재해야 할 핵심 수치·용어를, `safety.forbiddenClaims`에는 해당 주제에서 절대 쓰면 안 되는 단정 표현을 넣습니다.

## 안전 기준

- 정책·복지 영상의 모든 근거 URL은 `.go.kr` 또는 등록된 공공기관 공식 HTTPS 도메인이어야 합니다.
- 금액 확정 지급, 무조건 수급, 신청 없는 자동 지급, 원금·수익 보장 같은 일반 위험 표현과 에피소드별 금지 문구를 생성 전에 차단합니다.
- 화면 하단 기준일·개인별 심사 고지는 `presentation.screenDisclosure`에서 주제별로 지정합니다.
- 레퍼런스 채널의 로고·사진·문구·화면을 복제하지 않고, 큰 숫자·고대비·짧은 문장이라는 고수준 패턴만 사용합니다.

완성 폴더에는 MP4, SRT, 썸네일, 제목·설명·챕터, 플랫폼별 메타데이터, 컨택트시트, 출력 검수 보고서가 함께 생성됩니다. 쇼츠와 롱폼을 따로 실행해도 `episode.manifest.json`은 형식별 기록을 병합하며, 실제로 존재하는 파일과 `assets_ready`/`verified` 상태만 기록합니다.
