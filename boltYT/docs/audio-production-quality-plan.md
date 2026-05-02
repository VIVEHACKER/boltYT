# Audio Production Quality Plan

Date: 2026-05-02

Scope: narration-led Shorts and long-form videos made from sourced footage, images, animation, maps, documents, and motion graphics.

## Goal

The audio target is not "more background music". The target is clean narration, controlled emotional support, and a final master that does not feel cheap, loud, harsh, or randomly scored.

For this project, the audio hierarchy is:

1. Narration clarity.
2. Story-appropriate ambience or BGM.
3. Sparse cue-aligned SFX.
4. Final loudness and true-peak control.

If BGM competes with TTS, the BGM is wrong even when the track sounds good by itself.

## Reference Standards

Useful external standards and platform behavior:

- EBU R 128 defines loudness normalization around integrated loudness, loudness range, and maximum true peak.
- AES TD1008 recommends speech/assorted online audio around -18 LUFS and maximum true peak no higher than -1 dBTP for lossy streaming input.
- YouTube can apply viewer-facing audio enhancements such as stable volume and voice boost, which means uploaded files should already have intelligible speech and controlled loudness instead of relying on the player to rescue the mix.

Project target:

- Final integrated loudness: -18 to -14 LUFS.
- True peak: <= -1 dBFS / dBTP.
- Loudness range: <= 14 LU for mobile-friendly narration videos.
- TTS should sit clearly above BGM at all times.

## BGM Selection Rules

### Use these first

- User-owned curated music placed under `public/bgm/<mood>/default.mp3`.
- Mood-specific default tracks that have already been listened to and approved.
- Instrumental documentary beds: tension pulse, investigation drone, serious piano, restrained cinematic underscore, subtle ambient texture.

### Reject automatically

- Vocal, lyrics, rap, choir, singing, or obvious voice fragments under narration.
- Jingle, logo, ident, notification, ringtone, intro sting, outro sting.
- Funny, meme, comedy, cartoon, kids, birthday, Christmas, corporate presentation, advertising beds unless the whole video category explicitly needs that tone.
- Emotionally wrong tracks: cute/happy under tragedy, horror under calm explainer, aggressive trailer hits under normal narration.
- Very short tracks that cannot sustain a stable bed.

### Score before download

Every candidate should be ranked by:

- Mood fit.
- Keyword overlap with the production reference.
- Reject-term risk.
- Vocal/lyrics risk.
- Duration suitability.

Do not select the first Pixabay result just because it has a URL.

## Mix Rules

### Narration

- Trim TTS leading/trailing dead air.
- Apply high-pass filtering, de-mud EQ, presence EQ, light de-essing, compression, makeup gain, and a peak limiter.
- Tone should match the category:
  - documentary/news: restrained, serious, controlled.
  - animation/story: warmer and more expressive.
  - horror/myth: slower, lower energy, more space.
  - explainer: clear and neutral.

### BGM

- Duck continuously under narration.
- Dip at transitions, reveals, hard cuts, and glitch/whip moments.
- Fade in at the beginning and fade out at the end.
- For long-form, avoid one looping track for the whole video when chapters change tone. Use chapter-level cue plans.

### SFX

- Use SFX as punctuation, not decoration.
- Cue SFX only for cuts, reveals, text hits, evidence cards, map moves, and chapter transitions.
- Avoid random whooshes under every motion.

## Final QC Gate

Final MP4 QC must check:

- Audio stream exists.
- Mean/max volume are in a sane range.
- Integrated LUFS is not too loud or too quiet.
- True peak is not clipping or codec-risky.
- Loudness range is not too wide for mobile.
- Visual and audio endings fade or resolve instead of stopping abruptly.

If the final file fails loudness, true peak, or dynamic-range checks, it should be revised before upload.

## Remaining High-End Improvements

The current metadata gate prevents obviously bad BGM picks, but it still cannot hear the track. The next quality jump is content-based audio analysis:

- Detect vocals by spectral/ML analysis, not only title/tags.
- Measure BGM integrated loudness and normalize the music asset before rendering.
- Estimate speech-band masking around 1-4 kHz and reject dense tracks that fight narration.
- Sidechain duck BGM from actual narration amplitude rather than only scene timing.
- Add waveform/loudness preview in the UI so bad mixes can be spotted before render.
- Keep a small curated local BGM library per category. This is the most reliable way to avoid strange online-library tracks.

## Implementation Status

Implemented controls:

- BGM metadata quality gate and ranking.
- Professional-track selection before Pixabay download.
- Stored BGM selection score and warnings for inspection.
- Final render QC with FFmpeg `ebur128` loudness and true-peak metrics.
- QC fail/revise issues for loudness, true peak, and mobile-unfriendly dynamic range.

Not fully solved yet:

- Actual audio-content listening analysis for vocals and masking.
- Automatic remastering of the final render after QC failure.
- Chapter-level BGM replacement for long-form tonal changes.
