# Reference Format 100+ Report

- Generated at: 2026-05-03T03:34:52+09:00
- Target: 100+ reusable references across Shorts and longform
- Result: 110 generated templates after URL dedupe
- Batch command: `npx tsx scripts/reference-batch-template.ts --formats shorts,longform --target-per-category-format 11 --max-channels 45 --results-per-query 50 --candidate-pool 80 --metadata-only --fallback-ytsearch --retry-failed`

## Coverage

| Category | Total | Shorts | Longform |
| --- | ---: | ---: | ---: |
| drama_recap | 22 | 11 | 11 |
| mystery_doc | 22 | 11 | 11 |
| news_issue | 22 | 11 | 11 |
| automation_business | 22 | 11 | 11 |
| money_psychology | 22 | 11 | 11 |

## Notes

- YouTube Data API returned 403 during batch expansion, so `--fallback-ytsearch` collected additional candidates through `yt-dlp ytsearch`.
- `--metadata-only` avoids downloading or reusing source footage/audio and stores only structure, duration, title, channel, metrics, and production DNA.
- OpenAI-dependent deep frame/audio/transcript analysis was not run for the new fallback references because `OPENAI_API_KEY` is not configured in the running analyzer environment.
- Generated templates are available from `src/lib/generated-reference-template-presets.ts` and reference job metadata is persisted under `server/.tmp/reference`.

