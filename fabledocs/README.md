# fabledocs

Engineering documentation for **nova-bpt** — a demo app that wires three AWS AI
services (Polly, Transcribe, Bedrock) to a browser front end.

> **Status: these documents describe v1, which is now retired.** The v1 source
> at the repository root (`server.js`, `public/*.html`) has been commented out
> in full and kept for reference. The active application lives in
> [`../app`](../app) and implements all 20 stories below; see
> [`../app/README.md`](../app/README.md) for the story-to-file mapping.
>
> Read these docs for the reasoning — what v1 did, why it was built that way,
> what was wrong with it, and what each story was meant to achieve. Read
> `../app/README.md` for what exists now.

| Document | Read it when |
| --- | --- |
| [01-architecture.md](./01-architecture.md) | You are new to this repo and need to understand what exists today, how the pieces fit, and what is currently broken. **Start here.** |
| [02-user-stories.md](./02-user-stories.md) | You are picking up work. 20 detailed, implementation-ready stories organised into 6 epics. |

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
