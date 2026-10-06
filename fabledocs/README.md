# fabledocs

Engineering documentation for **nova-bpt** — a demo app that wires three AWS AI
services (Polly, Transcribe, Bedrock) to a browser front end.

> **Status: these documents describe v1, which is now retired.** The v1 source
> at the repository root (`server.js`, `public/*.html`) has been commented out
> in full and kept for reference. The active application lives in
> [`../app`](../app) and implements all 35 stories — the original 20 below and
> the 15 in [03-user-stories-2.md](./03-user-stories-2.md); see
> [`../app/README.md`](../app/README.md) for the story-to-file mapping.
>
> Read these docs for the reasoning — what v1 did, why it was built that way,
> what was wrong with it, and what each story was meant to achieve. Read
> `../app/README.md` for what exists now.

| Document | Read it when |
| --- | --- |
| [01-architecture.md](./01-architecture.md) | You are new to this repo and need to understand v1 — what it did, how the pieces fit, and what was wrong with it (§6 is the defect list the stories grew from). **Start here.** |
| [02-user-stories.md](./02-user-stories.md) | The first 20 stories, all delivered. Kept as the record of acceptance criteria and trade-offs. |
| [03-user-stories-2.md](./03-user-stories-2.md) | The second wave (21–35), also all delivered — CI, containers, conversation tools, speech controls, metrics. |

## Using this repo to level up

This repo's unusual asset: **v1 is still here, commented out, next to the v2
that replaced it.** That makes before/after comparison a first-class exercise.

1. **Read a defect, then its fix.** Pick one issue from
   [01-architecture.md §6](./01-architecture.md) (say 6.2, wide-open CORS, or
   6.5, a client per request) and find how `../app` handles the same concern.
   **Check**: name the file in `app/` that fixes it and what changed.
2. **Trace one request in each version.** `POST /ask-claude` in the
   commented-out `server.js`, then the same flow through `app/routes/` and
   `app/lib/`. **Check**: list what v2 added on that path (validation,
   retry, token accounting) and which story number delivered each.
3. **Run the tests, then break one.** `cd app && npm test` (plain
   `node --test`, no framework). Flip a boundary in `app/lib/` pricing or
   validate and watch the failure name the case.
   **Check**: you can explain why these are unit-testable without AWS
   credentials — and what that says about where the AWS calls live.
4. **Re-derive a story.** Pick one from the 21–35 wave, read only its
   acceptance criteria, sketch your design, then diff against the PR that
   shipped it — PR number = story − 20, in the canonical repo
   [elirc/3build-nova](https://github.com/elirc/3build-nova) (this copy has
   no PRs of its own; `git log --merges` here shows the same merge commits).
   **Check**: if the story has an "Out of scope" line, your design respects
   the same boundary — if it doesn't, work out what that boundary was
   protecting.

## TL;DR of the app

A single Express server (`server.js`, ~220 lines) serves three static HTML pages
from `public/` and exposes three API endpoints. Each page demos one AWS service:

- **Text-to-Speech** → `POST /speak` → AWS Polly → MP3 audio streamed back
- **Live Transcription** → `GET /get-signed-url` → browser opens a WebSocket
  straight to AWS Transcribe → live captions
- **Ask Claude** → `POST /ask-claude` → AWS Bedrock → Claude's text reply

There is no database, no build step, no framework, no tests, and no auth.
Everything is vanilla JS in `<script>` tags.

## Running it locally

```bash
npm install

# create .env in the repo root:
#   AWS_APP_ID=AKIA...
#   AWS_APP_SECRET=...
#   REGION=us-east-1

npm run dev          # nodemon server.js
# open http://localhost:3000/text-to-speech.html
```

The server **throws on startup** if any of the three environment variables are
missing (see `server.js:22-25`). There is no `.env.example` in the repo yet —
[STORY-02](./02-user-stories.md#story-02--configuration-module-and-env-example)
adds one.

Your IAM user needs `polly:SynthesizeSpeech`,
`transcribe:StartStreamTranscription*`, and `bedrock:InvokeModel`, plus model
access enabled for Claude in the Bedrock console for your region.

## Glossary

Terms that show up throughout these docs and in the code.

| Term | Meaning |
| --- | --- |
| **SigV4** | AWS Signature Version 4. The algorithm that signs every AWS API request. See [Concept 1](./01-architecture.md#concept-1-sigv4-presigning-why-get-signed-url-exists). |
| **Presigned URL** | A URL with the signature embedded in the query string, so the holder can call AWS without holding the credentials. Time-limited. |
| **PCM** | Pulse-code modulation. Raw, uncompressed audio samples. Transcribe wants 16-bit signed little-endian PCM at 16 kHz, mono. |
| **Event stream** | AWS's binary framing format for bidirectional streaming (`prelude → headers → payload → CRC`). See [Concept 2](./01-architecture.md#concept-2-the-aws-event-stream-binary-format). |
| **Partial result** | Transcribe's in-progress guess at what you are saying. It gets replaced as more audio arrives. A result with `IsPartial: false` is final. |
| **Bedrock** | AWS's managed hosting for third-party foundation models, including Anthropic's Claude. Partner-operated, so model IDs carry an `anthropic.` prefix. |
| **Inference profile** | A Bedrock ARN that routes a request across regions. Newer Claude models on Bedrock generally require one. |
