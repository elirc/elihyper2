# Nova — v2

The active application. Voice assistant plus three AWS AI demos: Amazon Polly
(speech synthesis), Amazon Transcribe (live speech to text), and Claude on
Amazon Bedrock.

This replaces the v1 code at the repository root, which is now commented out and
kept for reference only. The analysis of v1 and the backlog this was built from
live in [`../fabledocs`](../fabledocs).

## Quick start

```bash
cd app
npm install
cp .env.example .env     # then fill in AWS_APP_ID, AWS_APP_SECRET, REGION
npm run dev              # http://localhost:3000
npm test                 # 51 tests, no AWS credentials needed
```

`npm start` runs without nodemon. The server refuses to boot with a missing
environment variable and names every one that is absent.

### AWS prerequisites

The IAM principal needs:

| Service | Actions |
| --- | --- |
| Polly | `polly:SynthesizeSpeech`, `polly:DescribeVoices` |
| Transcribe | `transcribe:StartStreamTranscription`, `transcribe:StartStreamTranscriptionWebSocket` |
| Bedrock | `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream` |

You must also **enable model access for Claude in the Bedrock console for your
region**, and current-generation models generally require a cross-region
inference profile. If Claude calls fail with `AccessDeniedException` or
`ValidationException`, check that console setting before suspecting the code.

## The four pages

| Page | What it does |
| --- | --- |
| `/assistant.html` (default) | Hold to talk. Transcribe → Claude → Polly, streamed end to end, with barge-in. |
| `/claude.html` | Multi-turn chat, streaming, Markdown, response-style presets. |
| `/text-to-speech.html` | Voice/language/engine picker, SSML mode, download, character budget. |
| `/transcribe.html` | Live captions with in-place partials, export, and auto-reconnect. |

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Liveness plus cache stats. Makes no AWS calls. |
| `GET /voices` | Polly catalogue with each voice's supported engines. Cached 24 h. |
| `POST /speak` | `{ text, voiceId, engine, textType, download }` → `audio/mpeg`. ETag + LRU cached. |
| `POST /ask-claude` | `{ messages \| message, tone }` → JSON, or SSE with `?stream=1`. |
| `GET /transcribe-options` | Supported transcription languages and sample rates. |
| `GET /get-signed-url` | Presigned Transcribe WebSocket URL. `no-store`, 60 s TTL. |

## Layout

```
app/
├── server.js            entry point: config, real AWS clients, listen
├── app.js               createApp(deps) - dependency-injected, testable
├── config.js            the only file that reads process.env
├── lib/
│   ├── audio-cache.js   bounded LRU for synthesised speech
│   ├── errors.js        HttpError + expose flag
│   ├── logger.js        pino + per-request ids
│   ├── transcribe-url.js SigV4 presigning
│   ├── validate.js      request validation
│   └── voices.js        DescribeVoices with a 24 h catalogue cache
├── middleware/          rate limiting, 404, error handler
├── routes/              speak, claude, transcribe, health
├── public/
│   ├── css/app.css      the whole design system
│   └── js/              nav, markdown, presets, audio-utils,
│                        pcm-worklet, transcriber, chat, speaker
└── test/                51 tests, all offline
```

**Dependencies are injected** (`createApp({ polly, claude, buildSignedUrl, config, logger })`)
so the whole app runs in tests against fakes with no credentials and no network.
`server.js` is the only file that constructs a real AWS client.

## Design notes worth knowing before you change things

**The signed URL is a bearer credential.** `/get-signed-url` hands the browser
direct access to AWS Transcribe. It is served `no-store`, expires in 60 seconds,
and is the most tightly rate-limited endpoint. Do not lengthen its TTL or cache
it.

**There is no user authentication.** CORS is restricted to `ALLOWED_ORIGINS` and
every endpoint is rate limited, but that is a speed bump, not auth. Do not
expose this to the public internet as it stands.

**Model output is untrusted input to the DOM.** `public/js/markdown.js` escapes
everything before building markup, and only `http(s)` links are turned into
anchors. The single unescaped `innerHTML` in the codebase is in `nav.js`, over a
hardcoded constant. Keep it that way.

**Audio conversion happens on the audio thread.** `pcm-worklet.js` does the
Float32 → Int16 conversion inside the worklet and transfers buffers to the main
thread, which only frames and sends. Never `await` inside an audio callback —
that was the ordering bug in v1.

**Sample rate is negotiated, not resampled.** The page asks for a 16 kHz
`AudioContext`, reads back what it actually got, and tells Transcribe the truth
via `?sampleRate=`. AWS resamples if needed.

**SSE frames must end with a blank line.** `\n\n`, or the browser buffers the
response forever. There is a test for this.

## Mapping to the backlog

Every story in [`../fabledocs/02-user-stories.md`](../fabledocs/02-user-stories.md)
is implemented here.

| Story | Where it landed |
| --- | --- |
| 01 Fix the `/ask-claude` contract | `routes/claude.js`, `lib/validate.js` — accepts `message` or `messages`; never `JSON.parse`es a user string |
| 02 Config module and env example | `config.js`, `.env.example` |
| 03 Hoist AWS clients | `server.js` — constructed once, injected |
| 04 CORS and rate limiting | `app.js`, `middleware/rate-limit.js`, TTL cut 300 s → 60 s |
| 05 Structured logging and error handler | `lib/logger.js`, `middleware/error-handler.js` |
| 06 Multi-turn conversation | `public/js/chat.js`, `public/js/markdown.js`, `public/claude.html` |
| 07 Streaming responses | `routes/claude.js` (SSE), `public/js/chat.js` (fetch stream reader) |
| 08 Current Claude model | `AnthropicBedrockMantle` + `anthropic.claude-opus-5`, `output_config.effort` |
| 09 System-prompt presets | `public/js/presets.js` |
| 10 Voice and engine picker | `lib/voices.js`, `GET /voices`, `public/text-to-speech.html` |
| 11 SSML and download | `lib/validate.js`, `routes/speak.js` (`Content-Disposition`) |
| 12 Audio cache | `lib/audio-cache.js`, ETag + `304` in `routes/speak.js` |
| 13 AudioWorklet | `public/js/pcm-worklet.js` |
| 14 Async resampling race | Removed entirely — rate is negotiated server-side instead |
| 15 Inline partials and language | `public/transcribe.html`, `?languageCode=` |
| 16 Session resilience | `public/js/transcriber.js` — backoff, fresh URL, end-of-stream frame |
| 17 Export the transcript | `public/transcribe.html` — copy, download, `sessionStorage` restore |
| 18 Voice assistant | `public/assistant.html`, `public/js/speaker.js` |
| 19 Tests and health check | `test/`, `routes/health.js` |
| 20 Shared UI shell | `public/css/app.css`, `public/js/nav.js` |

## Testing

```bash
npm test
```

51 tests across three files, ~12 seconds, no credentials and no network:

- `test/audio-utils.test.js` — CRC-32 against the published check vector, PCM
  conversion including clamping and the asymmetric ±1 scale, event-stream frame
  round-trip, and non-string header parsing.
- `test/cache.test.js` — LRU ordering, byte budget, key stability.
- `test/api.test.js` — every endpoint, the validation failures, cache
  hit/`304` behaviour, SSE framing, and that a 500 leaks neither the AWS error
  nor a stack trace.

Add a test by dropping a `*.test.js` file into `test/`. `test/helpers.js`
provides `buildApp()` with fakes already wired.
