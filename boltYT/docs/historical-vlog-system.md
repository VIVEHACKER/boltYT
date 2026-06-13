# AI 역사 시간여행 브이로그 시스템 (수익 포맷 특화)

> 출처 학습(2026-06-13): X 3건 — ① @mad_dogdebt "AI 역사 시간여행 브이로그"
> (레퍼런스 채널 **Chloe VS History**: 영상 37개 → 구독 28.4만, 편당 123만~229만 조회),
> ② @jk_sats "클로드 코드 영상 편집 자동화", ③ @lalala13580351 "인스타 카드뉴스 수익화".

## 1. 전략 한 줄
boltYT(이미 AI 쇼츠+AI 영상 생성 80% 구현)를 **"AI 역사 시간여행 브이로그 팩토리"**로 특화한다.
키스톤은 **에피소드 간 동일 인물로 등장하는 고정 AI 호스트** — 검증된 포맷의 "킥".

## 2. 검증된 공식 (Chloe VS History)
| 요소 | 규칙 |
|---|---|
| 포맷 | 1인칭 셀카 POV 몰입형(셀카봉 든 팔이 프레임에) |
| 길이 | 9~14분 롱폼 (광고 RPM) |
| 제목 | `저는 시간 여행을 통해 {시대}로 갔어요! (브이로그)` |
| 썸네일 | 거대 연도 텍스트(44 AD/TITANIC) + 놀란 표정 셀카 |
| 킥 | 고정 호스트가 모든 영상에 동일 등장 = 채널 브랜드 |

## 3. 이번에 구현된 것 (검증 완료: 2352 tests, tsc, eslint 통과)
| 모듈 | 역할 | 갭 |
|---|---|---|
| `src/lib/historical-vlog-format.ts` | 시대 풀·POV 주입·제목/썸네일/챕터 공식(한국어 조사 처리) | #2/#3/#4 |
| `src/lib/host-character.ts` | **고정 호스트** — 채널+호스트 스코프 시드/레퍼런스 시트(에피소드 무관), 프롬프트 주입, StyleBible 브리지 | **#1 키스톤** |
| `src/lib/historical-vlog-factory.ts` | 호스트+시대+장르+듀얼언어 → 채널 계획(동일 호스트 잠금을 모든 에피소드에 부여) | #5 |
| `src/lib/market-benchmark.ts` | `historical_vlog` 장르 프리셋+분류 추가 | #2 |
| `src/lib/quality-loop-flag.ts` + `StepPreview.tsx` | historical_vlog는 품질 루프 기본 ON | #6 |
| `scripts/historical-vlog-plan.ts` (`npm run vlog:plan`) | 채널 계획 CLI(즉시 실행 가능) | — |

### 핵심 불변량
- `deriveHostSeed(channelId, hostId)` — **scriptId 무관**. 모든 에피소드가 같은 시드 → 동일 인물.
- `hostReferenceSheetPath` = `channels/{channelId}/host/{hostId}/reference-sheet.png` (채널 1회 생성, 전 에피소드 공유).
- 기존 파이프라인은 시드를 `deriveLockedSeed(scriptId)`(영상마다 다름)로 잠갔다 = 일관성 0의 원인.

## 4. 남은 작업 — 호스트를 실제 렌더에 연결 (라이브 실행 필요)
엔진은 완성·검증됐지만 **렌더 파이프라인 연결**이 남았다. StepMedia/StepScript는 현재 채널·호스트·장르
컨텍스트를 로드하지 않으므로(2300줄+ 컴포넌트, 헤드리스 검증 불가) 아래는 앱 구동 + FAL_KEY로
실제 렌더를 보며 작업해야 안전하다.

1. **호스트 레퍼런스 시트 1회 생성**: `buildHostReferencePrompt(identity)` → 이미지 생성 →
   `hostReferenceSheetPath` 경로에 업로드. (없으면 img2img가 "파일 없음"으로 실패하므로 필수 선행.)
2. **StepMedia `buildSceneImageGenOptions`**(비애니 경로, ~`src/pages/content/StepMedia.tsx:1618`):
   historical_vlog + 호스트 존재 시 `seed = hostMediaLock.seed`, `referenceImagePath = hostMediaLock.referenceImagePath` 주입.
   (현재 비애니는 `referenceImagePath` 미설정 → 애니 경로 `:668`이 참고 모델.)
3. **씬 프롬프트 주입**(`StepMedia.tsx:2042` `buildSceneImagePrompt`): `applyHostToScenePrompt(prompt, identity, {era})`로
   호스트 외형 잠금 + POV 주입. (애니는 `enrichAnimationPromptWithContinuity` 사용 = 참고 모델.)
4. 호스트는 `hostFromStyleBible(channelStyleBible)`로 기존 채널 설정에서 가져온다(새 DB 불필요).

> 안전 증분: 2·3의 **seed + 프롬프트 주입만** 먼저 적용하면(파일 불필요) 동일 시드+동일 외형 묘사로
> 일관성이 크게 오른다. referenceImagePath(img2img)는 1의 시트 생성 후 추가.

## 5. 로컬 실행
```bash
# 계획 미리보기 (네트워크 불필요)
npm run vlog:plan -- --channel my-history --eras ancient-rome-44ad,titanic-1912,ice-age --targets en-US

# 전체 시스템(실제 제작)
cp .env.example .env   # FAL_KEY, OPENAI_API_KEY, GOOGLE_CLIENT_ID/SECRET(YouTube) 등 채우기
npm run servers        # api-proxy(3459)/youtube(3457)/render-queue(3458)/reference-analyzer(3460)
npm run dev            # Vite 5173
```
필수 키: `OPENAI_API_KEY`(대본/이미지/Whisper), `FAL_KEY`(영상 kling3/이미지/BGM), YouTube OAuth(업로드).

## 6. 듀얼언어(KO+EN) 수익
`market-localization`이 KO→EN(또는 역) RPM 차익을 랭킹(en-US 기대 RPM ~4.1배). 영상은 재사용하고
대본/TTS/자막/제목/썸네일만 현지화. 팩토리가 에피소드별 현지화 계획을 자동 동봉.
