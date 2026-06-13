# Local BGM Presets

Put reusable Shorts BGM here through the import command, not by manually editing source code.

```bash
npm run bgm:import -- --source ~/Downloads/track.wav --mood tense
```

The command writes:

- `/public/bgm/<mood>/default.mp3`
- `/public/bgm/<mood>/default.json`

`autoPickBgm()` checks these mood presets before remote search, so a tense project will use `/bgm/tense/default.mp3` automatically.

Use a non-default slot when you want to keep variants:

```bash
npm run bgm:import -- --source ~/Downloads/news-pulse.wav --mood tense --slot news-pulse
```

Only `default.mp3` is auto-selected today. Other slots are stored for manual use or later routing.
