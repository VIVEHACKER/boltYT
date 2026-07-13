# boltYT Economy Studio

경제 기사 한 건을 근거로 쇼츠와 롱폼을 함께 만드는 로컬 영상 제작 스튜디오입니다. 기사 선택, 본문·관련 보도 수집, 대본, 장면 이미지 또는 실제 기사·차트, 한국어 음성, 동적 자막, 썸네일, 출처, 플랫폼 메타데이터, Remotion 렌더와 최종 검수까지 한 작업으로 실행합니다.

## 가장 빠른 시작

```bash
cd /Users/jjuni/bolt/boltYT
cp .env.example .env
npm install

# 최신 미사용 경제 기사로 쇼츠 + 8분 롱폼 한 세트
npm run economy:studio

# 실제 기사·차트 기반 쇼츠를 권장하는 제작 모드
npm run economy:studio -- --shorts-style real
```

기본 실행은 같은 `source.json`을 사용하는 다음 두 영상을 만듭니다.

- 9:16 쇼츠: 훅 → 핵심 사실 → 관점 → 시청자 영향 → 마무리, 60초 이하
- 16:9 롱폼: 무슨 일 → 배경 → 시장 영향 → 요약, 기본 8분

## 자주 쓰는 명령

```bash
# 특정 주제의 쇼츠 + 롱폼
npm run economy:studio -- --topic "금리" --minutes 10

# 실제 기사 화면과 실제 KOSPI/KOSDAQ 차트를 쓰는 쇼츠 + 롱폼
npm run economy:studio -- --shorts-style real --minutes 8

# 쇼츠만 / 롱폼만
npm run economy:shorts -- --topic "환율"
npm run economy:longform -- --topic "반도체" --minutes 12

# 기사 선택과 실행 계획만 확인
npm run economy:studio -- --topic "물가" --dry-run true

# 실패한 작업의 같은 기사로 다시 실행
npm run economy:studio -- \
  --source-file output/economy-studio/<작업ID>/source.json \
  --id retry-001

# 모든 옵션
npm run economy:studio -- --help
```

## 필요한 구성

- Node.js와 npm
- ffmpeg, ffprobe
- ComfyUI: 일러스트 쇼츠와 롱폼에 필요
- API proxy가 사용할 LLM: `OPENAI_API_KEY` 또는 `LLM_BACKEND=claude`와 로그인된 Claude CLI
- TTS: ElevenLabs, Clova, Edge TTS 또는 로컬 MeloTTS
- Playwright Chromium: `--shorts-style real`의 기사·차트 캡처에 필요

`economy:studio`는 API proxy와 ComfyUI가 꺼져 있으면 로컬 설치 경로를 찾아 자동 기동하고, 자신이 시작한 프로세스만 작업 종료 후 정리합니다. 이미 실행 중인 서비스는 유지합니다.

## 산출물

각 에피소드는 `output/economy-studio/<작업ID>/` 아래에 독립 저장됩니다.

```text
<작업ID>/
├── source.json          # 두 포맷이 공유하는 고정 기사
├── manifest.json        # 단계별 상태, 오류, 최종 파일 경로
├── logs/
│   ├── shorts.log
│   └── longform.log
├── shorts/
│   ├── *.mp4
│   ├── *.srt
│   ├── *_thumb.jpg
│   ├── *.platform_meta.json
│   ├── *.verify_report.json
│   └── *.render_qc.json
└── longform/
    ├── *.mp4
    ├── *.srt
    ├── *_thumb.jpg
    ├── *.chapters.txt
    ├── *.platform_meta.json
    ├── *.verify_report.json
    └── *.render_qc.json
```

요청한 모든 포맷의 렌더와 품질 검사가 성공해야 `manifest.json`이 `complete`가 되고 기사가 `economy-used.json`에 기록됩니다. 한 포맷이라도 실패하면 기사는 소진되지 않습니다.

## 콘텐츠 안전 기준

- RSS 기사와 수집된 본문·관련 보도 범위 안에서만 작성
- 실제 기사 본문을 수집하지 못하면 RSS 요약만으로 제작하지 않고 중단
- 기사에서 `기대·전망·예정·추진`인 내용을 완료·확정 사실로 바꾸면 렌더 중단
- 기사에 없는 숫자를 추가하거나 별도 팩트체커가 수치·고유명사·인과관계를 뒷받침하지 못하면 렌더 중단
- 투자 권유, 매수·매도 지시, 수익 보장, 단정적 가격 전망 차단
- 최종 제목과 최종 재작성 대본을 렌더 직전에 다시 검사
- 출처와 AI 이미지 고지를 설명·플랫폼 메타에 포함
- 쇼츠 60초 상한, 롱폼 요청 길이의 90% 하한, 영상·SRT 종료 시각과 컷 수를 fail-closed로 검수
- 해상도·FPS·오디오·LUFS·검은 화면·정적 화면·첫 3초 변화량과 contact sheet를 자동 검사

경제 정보는 제작 시점의 보도를 설명하는 콘텐츠이며 투자 자문이 아닙니다. 게시 전에는 `source.json`, 기사 발행 시각, 수치와 인용을 사람이 한 번 확인해야 합니다.

## 개발과 검증

```bash
npm test
npm run lint
npm run build
npm run test:e2e
gan-harness verify
```

Remotion 프리뷰는 `npm run remotion:preview`, 웹 편집기는 `npm run dev`로 실행합니다.
