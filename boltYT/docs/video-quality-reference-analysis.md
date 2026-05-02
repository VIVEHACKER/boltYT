# Video Quality Reference Analysis

Date: 2026-05-01

Scope: faceless Shorts and long-form videos that are made from animation, stock/archival footage, AI-generated visuals, images, maps, documents, and motion graphics rather than direct presenter footage.

## Reference Set

### Fern-style animated documentary

Fern positions itself as video journalism and says it investigates, animates, and tells stories with established outlets. Its public site reports more than 4.5M subscribers. The important pattern is not "nice animation"; it is source-led storytelling where animation exists to clarify the reporting.

Useful pattern:

- Every major visual has a narrative job: explain geography, reconstruct a sequence, show a document, identify a person, or reveal a cause-effect link.
- The visual language is consistent across a whole episode, so even synthetic or abstract shots feel intentional.
- Long-form pacing is chaptered. A topic does not become a random b-roll chain; it becomes a sequence of visual arguments.

Project implication:

- Do not search for "topic image" only. Search or generate for `event + entity + action + place + time`.
- Add a visual role to every shot: `evidence`, `reconstruction`, `map`, `document`, `context`, `transition`, or `ending`.

Source: https://www.watchfern.com/

### MagnatesMedia-style business documentary

MagnatesMedia is described as using stock images, stock video footage, historical footage, voice-over, background music, animated intros, text overlays, and zooms on image details.

Useful pattern:

- It is not just image listing. Images are edited as evidence: cropped into details, pushed in, combined with text callouts, or placed over sound and narration.
- Voiceover is produced separately and cleanly, then visuals are edited to the message.
- Historical footage and relevant images are stronger than generic luxury/city b-roll.

Project implication:

- A still image should become a designed shot: crop target, motion path, callout, caption timing, and optional source label.
- If the image has no script anchor, reject it.

Source: https://facelesschannels.net/magnatesmedia-case-study/

### AI-assisted historical dramatization

TIME Studios and Primordial Soup's `On This Day...1776` is a useful reference because it uses AI-generated visuals for historical scenes while still relying on traditional production elements. Public reports describe short 3-5 minute episodes, SAG voice actors, human editing, sound mixing, and color grading.

Useful pattern:

- AI is used where real footage cannot exist, especially period scenes.
- Human post-production is still necessary: edit, mix, grade, and control story rhythm.
- It also shows the risk: realistic AI historical visuals can be criticized when accuracy or taste feels wrong.

Project implication:

- AI visuals should be labeled internally as `reconstruction`, never treated as real evidence.
- For sensitive current events, avoid realistic fake event footage unless clearly stylized.
- Use AI video clips as controlled inserts, not as the whole credibility layer.

Sources:

- https://time.com/7360487/time-studios-partners-with-primordial-soup-to-distribute-on-this-day-1776/
- https://www.tvbeurope.com/artificial-intelligence/darren-aronofsky-employs-google-deepmind-to-recreate-the-ai-merican-revolution

### AI Shorts generation trend

YouTube Shorts has integrated short AI video generation flows such as Veo. Reporting describes text-to-video clips around 8 seconds, cinematic/animated style choices, motion, lighting, and native audio.

Useful pattern:

- The unit is a shot, not a full story. Short AI clips work best as 2-8 second visual moments.
- The clip must have action and camera intent: push-in, reveal, tracking, impact, or atmosphere.
- Sound matters. AI/stock visuals without ambience, risers, and BGM ducking feel unfinished.

Project implication:

- Generate/select at shot level, not scene level.
- A video shot should contain: `action`, `camera_motion`, `duration`, `audio_cue`, `visual_role`, and `fallback`.

Source: https://www.techradar.com/ai-platforms-assistants/youtube-shorts-now-lets-you-turn-text-into-8-second-videos-using-veo-3s-ai-magic

## Quality Bar

### Shorts

Minimum acceptable structure:

- 0.0-1.5s: one strong first frame with the subject, conflict, or impossible question visible immediately.
- 1.5-6s: setup with 2-3 quick visual beats, not one slow image.
- 6-22s: sequence of event beats; each beat gets one specific visual.
- 22-35s: reveal, consequence, or reversal.
- Final 1-2s: soft landing, not an abrupt cut.

Expected shot density:

- 30s short: 8-14 shots.
- 45s short: 12-20 shots.
- Still images can be used, but no more than 2 similar stills in a row unless treated as document/evidence montage.

### Long-form

Minimum acceptable structure:

- Cold open before explanation.
- Visual chapter every 45-90 seconds.
- Recurring visual grammar: maps, documents, archival inserts, reconstructed scenes, data cards.
- Periodic reset shots so the viewer always knows who, where, when, and why.

Expected shot density:

- 8-12 minute video: 120-240 visual beats.
- Stock footage alone is not enough. It needs maps, documents, headlines, portraits, source screenshots, and designed transitions.

## Asset Rules

### Strong assets

- Real source video from the event or adjacent verified context.
- Article-embedded image or video from the source being narrated.
- Archive/Wikimedia/public-domain image for historical people, locations, objects, documents.
- Map, timeline, document screenshot, data card, or diagram that directly explains the sentence.
- AI reconstruction when the script explicitly needs a missing scene and the output is stylized or internally labeled.

### Weak assets

- Generic city skyline for any crime/business/politics story.
- Random crowd shot when no crowd is mentioned.
- Luxury car, money, courtroom, police tape, or dark alley used as universal filler.
- Portrait that is not the actual person.
- AI image of a real event that appears to be documentary evidence.
- Low-resolution, logo-heavy, poster-like, meme-like, or text-distorted image.

### Required metadata per shot

```ts
type VisualRole =
  | "evidence"
  | "archive"
  | "reconstruction"
  | "map"
  | "document"
  | "data"
  | "context"
  | "transition"
  | "ending";

interface ShotVisualPlan {
  scriptAnchor: string;
  eventDate?: string;
  entityNames: string[];
  placeNames: string[];
  action: string;
  visualRole: VisualRole;
  preferredMedia: "video" | "image" | "map" | "document" | "ai-video";
  searchQueries: string[];
  rejectTerms: string[];
  sourceConfidence: number;
  motionPlan: string;
  captionIntent: "none" | "keyword" | "quote" | "date" | "source";
}
```

## Selection Ladder

Use this order before falling back:

1. User-provided or project source media.
2. Media embedded in the exact article/source.
3. YouTube/news clip search for the exact entity/action/place.
4. Wikimedia Commons or public archive for historical entity/place/object.
5. Pexels/Pixabay only for non-specific context.
6. AI image/video only as reconstruction or atmosphere.
7. If none pass, use map/document/data treatment instead of random stock.

## Rejection Gates

Reject an image or video when:

- It does not overlap with at least one core entity, place, action, or object from the shot plan.
- It is only emotionally similar but factually unrelated.
- It is a generic stock symbol for a concrete event.
- It conflicts with date, country, person, or medium.
- It is too low quality for 1080x1920 output.
- It contains visible text artifacts, broken faces/hands, distorted logos, or unrelated watermarks.

## Audio And Caption Rules

### TTS

- Tone must match topic class: serious incidents need restrained documentary narration, not cheerful explainer voice.
- Avoid robotic constant speed. Use pauses at reveals, lower energy at endings, stronger attack at hooks.
- Long-form needs lower intensity than Shorts.

### BGM

- BGM should be selected by story tone: investigation, tension, tragedy, discovery, wonder.
- Duck under narration continuously.
- Add small dips at visual transitions and reveals.
- End with a controlled fade/hold.

### Captions

- Captions should support attention, not dominate the frame.
- Use chunked emphasis for key nouns/dates only.
- Avoid giant always-on blocks that cover the subject.
- Preserve bottom safe area and keep face/subject region clear.

## Implementation Requirements For This Project

1. Score the topic before script generation. Weak topics must be narrowed, converted to compact explainers, or blocked before the renderer spends work on them.
2. Add a `ShotVisualPlan` step before media search.
3. Score assets against the shot plan, not just the broad topic.
4. Store `visualRole`, `sourceConfidence`, `qualityScore`, and `rejectionReason`.
5. Prefer real video shots when they are directly relevant, but do not force expensive AI video. Still images must become designed motion/evidence shots when real footage is unavailable.
6. Add a QC report after media selection:
   - percentage of real video shots
   - percentage of designed visual shots
   - percentage of source-anchored assets
   - number of generic stock fallbacks
   - unresolved shots
   - abrupt-ending risk
7. If quality is below threshold, repair only the weak shots with motion, callouts, maps, document crops, or source labels instead of regenerating the whole video.
8. AI video generation is an optional hero-shot path for hooks, reversals, or endings. It is not required for the default quality gate.

## Implemented Bottleneck Controls

- Production is now split by type. `research/documentary` uses source/timeline gates, while `animation` uses character/storyboard gates and avoids documentary media-search assumptions.
- Animation is further split by `production_family`: character sitcom, storytime, slapstick, explainer, history comedy, infographic motion, whiteboard lesson, horror/myth, original meme skit, and kids/fable. This keeps the system from forcing every animated video into one generic template.
- `src/lib/animation-production.ts` adds animation readiness, production-family prompt directives, character/style rules, animation pacing, and AI-keypose shot planning. Animation shots are marked with `selection_provider: "animation"` so the media step generates consistent keyframes instead of searching for unrelated real photos.
- Animation quality now has a concrete continuity path: character reference sheet, locked identity prompt, stable local generator seed, per-shot continuity keys, animation-specific negative prompt, and an animation QC gate before preview.
- `src/lib/topic-production-readiness.ts` now runs a preproduction gate before research-mode script generation. It scores source count, factual text density, dated timeline evidence, publisher diversity, direct visual sources, research facts, and long-form viability.
- If a topic has no factual backbone, script generation is blocked. If it is only weak for long-form, the UI recommends a narrower angle or compact format and injects those constraints into the script prompt.
- Search ranking now separates relevance from framing/resolution. High-resolution stock media is rejected when the title/tags/URL do not overlap with the shot query.
- Evidence/document/archive/map/data shots use stricter score and relevance thresholds than context/transition shots.
- After media generation, weak shots are repaired selectively. Generic stock in evidence slots, low-confidence sources, low-quality candidates, unresolved video shots, and rejected candidates are re-searched first.
- If no source passes the gate, the shot falls back to an explicitly marked AI reconstruction instead of silently keeping an unrelated stock image.
- Final production approval blocks excessive generic stock usage even if the media step somehow allowed it.
- When real media is missing or blocked, evidence/document/archive/map/data shots can now use generated SVG source cards. These cards use the scene title, date, source, caption, and narration, and are explicitly not presented as original photo/video evidence.

Current implementation:

- `src/lib/youtube-production-quality.ts` calculates the final production gate before approval.
- `src/lib/youtube-production-repair.ts` provides deterministic repair rules for endings, motion design, and video-upgrade target selection.
- `src/pages/content/StepPreview.tsx` blocks rendering/upload queue registration when the gate fails.
- Preview now attempts automatic repair before blocking: regenerate narration, add motion design, create missing high-value video clips through the video generator, then re-run the gate.
- The gate checks BGM, narration, thumbnail, video ratio, motion ratio, source anchors, low-confidence shots, AI reconstruction ratio, caption sync, TTS density, long-form structure, and abrupt-ending risk.
- `renders.qc_result_json` stores the score, metrics, issues, and required actions for later inspection.

## Bottom Line

The target is not "more media". The target is "specific visual evidence or intentional reconstruction per narration beat".

Random images fail because they answer the topic. Strong videos answer the exact sentence being spoken.
