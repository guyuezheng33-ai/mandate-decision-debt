# AI use disclosure

This disclosure covers the Codegeist 2026 submission. It states what was generated with AI, what was captured from the live product, and what a human verified. It does not claim that any AI-generated image is a live screenshot.

## Tools used

| Area | Tool | What it produced |
|---|---|---|
| Code, tests, documentation drafts | Doubao coding assistant (ByteDance) | Drafted and refactored source, tests, and documentation; suggested fixes reviewed by the author |
| Demo narration | `edge-tts` (Microsoft Edge neural TTS), voice `en-US-AndrewNeural`, rate `+12%`, pitch `-2Hz` | Synthetic voice-over only; no human narrator |
| Screenshots and product visuals | Microsoft Edge, live Atlassian site `one-atlas-ngpq.atlassian.net` | Captured from the running Jira UI; no generative image model used to fabricate product UI |
| Explanatory video cards | Local Python/Pillow renderer (`preview/video/build.py`) | Typographic cards laid over real captures; labelled as explanatory by context |

No image-generation model was used to create a product screen, a receipt, or a customer quote.

## What AI wrote, and what a human changed

- **Code and tests.** AI assistance was used to draft and refactor parts of the Forge app, its tests, and CLI tooling. The author ran the full local suite and fixed failures before submission; the test count and pass state are reproducible with `npm test` and `npm run check`. AI output was not accepted on the basis of looking plausible.
- **Documentation and submission copy.** AI assistance was used to draft and tighten README, judge packet, impact note, and Devpost copy. The author edited the claims, checked every number against a run artifact or a live response, and removed claims that could not be traced. No customer quote, pilot result, percentage, or usage statistic was invented by AI.
- **Demo video.** The narration is synthetic (`edge-tts`). The visual track is built from real screenshots plus typographic explanatory cards; the script says so in `preview/video/build.py`. The video is not a screen recording of an AI-generated interface.
- **Screenshots.** The live panel captures are from the real tenant. The one fixture image in the gallery, `04-project-sample.png`, is explicitly captioned `Sample data`; it is not presented as a live capture.

## AI inside the product

- **No model in the scoring path.** Scoring is deterministic, local, and reproducible: six criteria over three-valued evidence, integer weights, and no model call. This is recorded in `docs/adr/0005-no-external-model.md` and enforced by `marketplace/check.js`.
- **Rovo agent.** The optional Rovo agent uses Atlassian's hosted agent runtime to restate the engine's output. Its prompt forbids it from computing a score; it must repeat the panel's criteria and weights, and must refuse a grade when coverage is thin. The agent is a read-only narrator, not a second scorer.
- **No outbound calls from the app.** The manifest requests no external fetch, and the privacy policy states that no content is sent outside Atlassian.

## What a reviewer can verify

- `npm test` — 187 assertions; `npm run check` — local gate.
- `docs/adr/0005-no-external-model.md` — why scoring has no model.
- `preview/video/narrate.py` — exact TTS voice and settings.
- `preview/video/build.py` — how the video is assembled from real captures and cards.
- `submission/gallery/captions.md` — which image is live and which is a labelled fixture.

If the submission form asks for a one-line answer:

> Code, tests, docs, and submission copy were drafted with a Doubao coding assistant and edited and verified by the author. The demo voice is Microsoft Edge TTS (`en-US-AndrewNeural`). Product screenshots are captured from the live Jira tenant; the one fixture project-page image is labelled `Sample data`. The scoring path contains no model; the optional Rovo agent only restates deterministic results and cannot score.
