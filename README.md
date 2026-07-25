# Nova

[![CI](https://github.com/elirc/3build-nova/actions/workflows/ci.yml/badge.svg)](https://github.com/elirc/3build-nova/actions/workflows/ci.yml)

A voice assistant built on three AWS AI services: **Amazon Polly** for speech
synthesis, **Amazon Transcribe** for live speech to text, and **Claude on Amazon
Bedrock** for the conversation. Hold a button, speak, and hear an answer — or use
any of the three services on its own page.

## Start here

| I want to… | Go to |
| --- | --- |
| Run the app | [`app/README.md`](./app/README.md) |
| Understand how it works | [`fabledocs/01-architecture.md`](./fabledocs/01-architecture.md) |
| Pick up a piece of work | [`fabledocs/03-user-stories-2.md`](./fabledocs/03-user-stories-2.md) |
| Open my first pull request | [`CONTRIBUTING.md`](./CONTRIBUTING.md) |

```bash
cd app
npm ci
cp .env.example .env      # fill in AWS_APP_ID, AWS_APP_SECRET, REGION
npm run dev               # http://localhost:3000
```

## Repository layout

```
.
├── app/            The application. All new work happens here.
├── fabledocs/      Architecture, backlog, and the reasoning behind both.
├── .github/        CI workflow, PR template, issue templates.
├── CONTRIBUTING.md How to branch, commit, review, and ship here.
│
├── server.js       v1, retired. Commented out, kept for reference.
└── public/         v1 pages, retired. Commented out, kept for reference.
```

### About the retired v1

`server.js` and `public/*.html` at the repository root are the original
implementation. They are commented out in full rather than deleted, so the
original is readable next to the rewrite while nothing executes. They are not
served, not tested, and not maintained.

[`fabledocs/01-architecture.md`](./fabledocs/01-architecture.md) explains what
v1 did and the nine defects found in it — including the one that made the Ask
Claude page fail on every request. Reading it is the fastest way to understand
why v2 is shaped the way it is.

## Security posture

There is **no user authentication**. CORS is restricted to configured origins and
every endpoint is rate limited, but that is a speed bump, not access control.
`GET /get-signed-url` hands the browser a short-lived credential for direct
access to AWS Transcribe.

**Do not expose this to the public internet as it stands.** See the security
section of [`app/README.md`](./app/README.md) before deploying anywhere.
