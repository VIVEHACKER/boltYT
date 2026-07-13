# 가스펠 재즈 AI 플리 채널 — Suno 보컬 파이프라인 설계 (Spec v1)

> 작성 2026-06-29 · 상태: **설계만 (미구현)** · 출처 포맷: X @OctoSurvivor 불교 재즈 채널 역분석
> 결정됨: 톤 = **하이브리드**(가사 경건 / 제목·썸네일·댓글 밈), 다음 행동 = **Suno 보컬 파이프라인 설계**
> 연계 메모리: `reference-ai-playlist-format`, `project-boltyt-gospel-jazz`

---

## 0. 목표 한 줄

Suno 보컬 + Claude **개사(改詞)** 엔진으로 **시편/찬송가를 현대 한국어 위트로 다시 쓴 가스펠 곡**을 양산 →
1시간 롱폼 플리(YouTube) + **개별 트랙 음원 유통(Spotify/Apple, 본진 수익)** 까지 무인 파이프라인.
불교 재즈를 터뜨린 메커니즘(개사·일관 정체성·밈 제목·음원유통)을 그대로 이식하되, **기독교는 CCM으로 장르혼합이 이미 normalized → 신선함은 "예수+재즈"가 아니라 한국 교회생활 공감 코드에서 뽑는다.**

---

## 1. 톤 계약 (하이브리드) — 가장 먼저, 불변

두 레인을 **물리적으로 분리**한다. 바이럴 위트는 후크 레인에서만 나오고, 음악 자체는 경건·위로 톤을 유지한다. (근거: 불교 채널도 *댓글*이 코미디였지 경전 자체를 조롱하진 않았음. 한국 개신교 신성모독 민감도 ↑ → 형 브랜드/수익 보호.)

| 레인 | 톤 | 규칙 |
|------|----|------|
| **LYRICS (가사)** | 경건·위로·은혜 | 시편/찬송가/은혜 테마 베이스. 핵심 교리 변형 금지, 성구 조롱 금지, "예수님이 ~하셨네" 식 개그 금지. 현대 한국어 표현·라임 OK. **싱어블**(verse/chorus 구조). |
| **HOOK (제목·썸네일·설명·고정댓글·댓글유도)** | 밈·공감 코미디 | "주님, 1절만 듣고 갈게요🙏" 류 교회생활 공감 위트는 여기서 전부 소화. |

**Brand-safety 게이트**(파이프라인 필수 스테이지): 가사 생성 직후 Claude self-check + denylist(신성모독·정치·특정 교단 비하·유명 사역자 실명) → 위반 시 BLOCK & 재생성. 경제 채널의 YMYL 안전레인과 동형.

---

## 2. 아키텍처 — boltYT 재사용 vs 신규

```
[테마 선택]──┐
            ├─→ [개사 엔진(Claude)] ──→ [Brand-safety 게이트] ──→ [Suno 보컬 생성] ──→ [트랙 QC]
[찬송가/시편 코퍼스]                                                  │(persona 락)        │
                                                                     ↓                   ↓
[마스코트 비주얼(IP-Adapter 락)] ←──────────────── [롱폼 조립(ffmpeg: N트랙→1h + 트랙리스트/챕터)]
            │                                                        │
            ↓                                                        ↓
   [선택: i2v 미세모션]                            ┌─────────────────┴─────────────────┐
                                                  ↓                                     ↓
                                        [YouTube 업로드 + AI공시]            [음원 유통(DistroKid+DDEX)]
                                        제목·썸네일=밈                       개별 트랙 = Spotify 싱글
```

| 스테이지 | boltYT 현황 | 작업 |
|---|---|---|
| 마스코트 이미지 + 정체성 락 | ✅ `src/lib/image-gen.ts`, `src/lib/host-character.ts`(seed+IP-Adapter) | **재사용** (vlog 호스트 락 그대로) |
| i2v 미세모션 | ✅ kling/ltx/wan/hailuo | 재사용(선택) |
| 롱폼 조립·오디오 | ✅ ffmpeg(`server/lib/audio-effects-ffmpeg.ts`) + remotion | **확장**(루프→트랙 concat/crossfade + 트랙리스트 오버레이) |
| YouTube 업로드 | ✅ `server/youtube-upload.ts` | 재사용 + AI공시 플래그 |
| 오케스트레이션 패턴 | ✅ `scripts/make-economy.ts`(피드→대본→씬→오디오→렌더→메타) | **미러링**해 `make-gospeljazz.ts` 신규 |
| **보컬 곡 + 개사** | ❌ 없음(Stable Audio=인스트루멘탈) | **신규 `src/lib/music-vocal.ts`(Suno 클라이언트)** |
| 음원 유통 | ❌ 없음 | **신규 `src/lib/music-distribute.ts`(DistroKid/DDEX)** + 일부 수동 |

---

## 3. 모듈 스펙

### 3.1 `scripts/make-gospeljazz.ts` (오케스트레이터)
`make-economy.ts` 형태 미러링. CLI(tsx) + `main()` + 스테이지 함수.
```
vlog:gospel  단일 1h 플리 1편
vlog:gospel:batch  배치(vlog-batch.ts 재사용; 잡당 서브프로세스 메모리 격리)
플래그: --genre <worship-lofi|gospel-jazz|psalm-neosoul|hymn-citypop|meditation-ambient|gospel-bossa>
        --tracks <n=15>  --minutes <60>  --persona <id>  --no-vocal(인스트루멘탈 폴백)  --dry-run
```
스테이지: `pickTheme()` → `writeLyrics()` → `safetyGate()` → `renderTracks()`(Suno, 병렬+webhook) → `qcTracks()` → `buildMascotScene()` → `assemblePlaylist()`(ffmpeg) → `buildMeta()`(제목/썸네일/챕터) → `uploadYouTube()` → `queueDistribution()`(트랙별).

### 3.2 개사 엔진 (Claude)
입력: 테마 + 장르 + (선택)찬송가/시편 원문. 출력 스키마(구조화):
```ts
interface GospelLyric {
  songTitle: string;          // 트랙 제목(경건)
  sourceRef: string;          // "시편 23편" | "찬송가 realName" | "original"
  styleTag: string;           // Suno style 프롬프트 (e.g. "warm lofi gospel, soft rhodes, brushed drums, Korean female alto, 75bpm")
  structure: { section: "verse"|"chorus"|"bridge"; lines: string[] }[];
  langMix: "ko" | "ko-en";    // "moonlight 온 더 목탁" 류 한영 믹스 허용
  safetyNotes: string;        // 게이트 통과 근거
}
```
프롬프트 원칙: 성구는 **자유 개사하되 의미 왜곡·조롱 금지**, 싱어블(호흡·라임), 현대 공감 어휘, 후렴 후킹. few-shot 2개 + Output Spec 마지막(컨텍스트 엔지니어링 규칙).

### 3.3 `src/lib/music-vocal.ts` (Suno 클라이언트) — **신규, 핵심**
- **공식 API 없음** → 서드파티 provider 추상화(provider-agnostic 인터페이스, env로 키/엔드포인트 주입). 1차 후보: 안정성·DDEX 호환 우선 평가 후 택1.
- 파라미터: `custom mode`(가사 직접 입력), `model=v5.5`(최장 8분/고품질), `instrumental:false`, **`persona/voice id`(채널 보컬 정체성 락)**, `styleTag`, `duration`/`extend`.
- 비동기: **webhook** 우선, 폴백 폴링. 재시도(지수백오프), 타임아웃 60s 음악 레인.
- 출력: watermark-free wav/mp3 + 메타.
```ts
interface VocalTrackReq { lyric: GospelLyric; personaId: string; model: "v5.5"; instrumental: false }
interface VocalTrack { audioPath: string; durationSec: number; provider: string; persona: string; isAi: true }
```

### 3.4 Persona = 오디오 정체성 락 (이미지 락의 쌍둥이)
채널당 **단일 persona 1회 생성**(예: "은혜" — 따뜻한 한국어 알토). 모든 트랙이 같은 목소리 → 음원/채널 브랜드 일관성. `channels/{id}/persona.json`에 영속화(host-character의 seed/referenceSheet와 동형).
⚠️ **유명 가수 모방 프롬프트 절대 금지** → 임퍼소네이션 스트라이크. 제네릭 persona만.

### 3.5 비주얼 정체성 (불상의 대체물 — 신성모독 0)
신성 인물(예수) 대신 **로파이걸 풍 마스코트**: 햇살 드는 창가의 어린 예배자/양치기+어린양, 스테인드글라스·십자가 빛 문법. `host-character.ts` IP-Adapter 시드락 재사용 → 매 영상 동일 캐릭터. **영상마다 씬을 미세 변주**(악기·시간대·계절) → reused-content 정책 회피.

### 3.6 롱폼 조립 (ffmpeg)
N개 트랙(각 4–8분) → crossfade concat → 1h. 챕터/타임스탬프 트랙리스트 오버레이(고유 비주얼 = 수익화 정책 충족). i2v 미세모션 캐릭터를 배경으로.

### 3.7 메타 (밈 레인)
제목 공식 `[공감 후크+이모지] | [용도] [장르]`. 슬레이트 예:
- 주님, 1절만 듣고 일하러 갈게요🙏 | 찬양 lo-fi
- 새벽기도 가기 싫을 때 듣는 찬양 재즈☕
- 이거 듣다가 갑자기 회개함😭 | 시편 네오소울
- 시편 23편을 재즈로 풀면…🎷
- 교회 끝나고 듣는 갓생 lofi🎧 | 청년부 감성
- 어머니가 부르던 찬송가, lofi로 다시🎹
썸네일: 마스코트 + 큰 한글 후크 1줄(불교 채널 패턴). 고정댓글 = 댓글놀이 유도.

### 3.8 `src/lib/music-distribute.ts` (음원 유통) — **신규, 본진 수익**
- **전제: Suno Pro/Premier 구독(상업권)** 없으면 발매 불가.
- **DistroKid**(AI 음악 허용 + 유일하게 DDEX AI공시를 Spotify로 전달; CD Baby는 거부).
- 각 트랙 = Spotify/Apple 싱글. **DDEX AI 공시 박스 필수 체크**(Synthetic Content). 미공시 = 삭제·수익정지·임퍼소네이션 스트라이크.
- 자동화 한계: DistroKid 업로드는 일부 수동/세미자동 → 큐(`distribution-queue.json`)에 적재 후 배치 업로드. (완전 무인은 후순위.)

---

## 4. 채널 데이터 모델
```
channels/gospel-jazz/
  persona.json          # Suno 보컬 정체성(곡 간 락)
  mascot/reference-sheet.png + seed   # 이미지 정체성 락
  style-presets.json    # 장르별 styleTag
  corpus/               # 시편/찬송가(퍼블릭도메인 우선) 개사 소스
  distribution-queue.json
```
⚠️ **찬송가 저작권**: 현대 CCM·번안 찬송가는 저작권 있음 → **퍼블릭도메인 찬송가/시편 원문 기반 개사** 우선(법적 안전). 개사 가사 자체는 신규 창작.

---

## 5. 수익·비용 모델
- **유튜브 광고 RPM 낮음**($3–8 프리미엄, 앰비언트는 reused/inauthentic 정책 거절률 ↑). 회피: 영상별 고유 비주얼 + 타임스탬프 + 큐레이션/AI 공시.
- **본진 = 스트리밍 로열티**($0.003–0.014/스트림, Suno Pro는 100% 보유). 무한 에버그린 카탈로그 — "조회수보다 음원이 짭짤".
- 비용: Suno 곡당 ~$0.014–0.111(평균 ~$0.05) → 1h 영상(~15트랙) ≈ **$0.75 음악** + 마스코트 이미지 ~$0.02. 트랙 1개 = Spotify 싱글 1개로도 재활용.
- ⚠️ raw AI 오디오는 **미국 저작권 보호 불가**(방어 불가, 수익화는 가능). Apple 2026은 완전-AI 트랙을 top-tier 플레이리스트에서 제외 → 기대치 조정.

---

## 6. 컴플라이언스 체크리스트 (발매 전 게이트)
- [ ] Suno **Pro/Premier** 구독 활성(상업권)
- [ ] provider = watermark-free API
- [ ] **DDEX AI 공시** 체크(DistroKid → Spotify)
- [ ] 유명 가수 모방 프롬프트 0
- [ ] 퍼블릭도메인 소스 기반 개사(현대 찬송가 저작권 회피)
- [ ] YouTube: AI 공시 + 영상별 고유 비주얼 + 트랙리스트(reused-content 회피)
- [ ] Brand-safety 게이트 통과(신성모독·교단비하·실명 0)

---

## 7. 빌드 단계 (그린라이트 시)
1. `music-vocal.ts` + provider 1종 PoC: 개사 1곡 → Suno 보컬 1곡(persona 락 검증). **여기서 품질/한국어 발음 합격 여부가 전체 GO/NO-GO.**
2. 개사 엔진(Claude) + Brand-safety 게이트 + 테스트.
3. ffmpeg 롱폼 조립(N트랙→1h+트랙리스트).
4. `make-gospeljazz.ts` 오케스트레이션(경제 채널 미러) + 마스코트 락 + 메타/썸네일.
5. YouTube 업로드(AI공시) E2E 1편.
6. 유통 큐 + DistroKid 발매 SOP(세미자동).
7. 배치/cron 무인 양산(vlog-batch 재사용).

---

## 8. 리스크 & 오픈 퀘스천
- **R1 한국어 보컬 품질**: Suno 한국어 발음/개사 자연스러움이 곧 바이럴. 1단계 PoC로 선검증(NO-GO 가능).
- **R2 유통 자동화 한계**: DistroKid 완전 무인 어려움 → 초기 세미자동.
- **R3 정책 리스크**: 미공시/모방 시 채널·트랙 삭제. 게이트로 차단.
- **OQ1 provider 택1**: 안정성·DDEX·한국어 기준 후보 3종 PoC 비교 필요.
- **OQ2 단일 채널 전략과의 관계**: 기존 단일채널=경제뉴스. 가스펠은 별도 채널·별도 수익모델(음원유통) → 형 확정 필요.
- **OQ3 인스트루멘탈 폴백 채널 병행?**(Stable Audio로 오늘 즉시 가능, 저바이럴) — 시드 채널로 깔지 여부.

## 9. 필요 ENV / 계정
`SUNO_API_KEY`(+provider base url), `SUNO_PERSONA_ID`, Suno **Pro/Premier** 계정, DistroKid 계정, (기존)`FAL_KEY`·YouTube OAuth.
