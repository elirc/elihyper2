# Contributing

This guide exists so you never have to guess what a good change looks like here.
Every rule below has a reason attached, because a rule you do not understand is
one you will drop the first time you are under pressure.

New to the codebase? Read [`fabledocs/01-architecture.md`](./fabledocs/01-architecture.md)
first, then pick a story from
[`fabledocs/03-user-stories-2.md`](./fabledocs/03-user-stories-2.md).

---

## The loop

```bash
cd app
npm ci            # not npm install - see below
npm test          # 51 tests, ~5s, no AWS credentials needed
```

`npm ci` installs exactly what `package-lock.json` says and fails loudly if the
lockfile and `package.json` disagree. `npm install` will quietly *change* the
lockfile to resolve the difference. In your own experiments that is convenient;
on a shared branch it means the tree you tested is not the tree CI tested.

---

## Branches

One branch per story, named after it:

```
feat/24-save-conversations
fix/31-retry-not-honouring-retry-after
chore/23-pin-node-base-image
docs/22-contributor-guide
```

The number ties the branch to the backlog, so six months from now the branch
name, the pull request, and the story all still point at each other. `wip`,
`my-branch`, and `eli-test-2` do not survive contact with a reviewer trying to
work out what they are looking at.

Branch from an up-to-date `main`:

```bash
git switch main
git pull
git switch -c feat/24-save-conversations
```

---

## Commits

We use [Conventional Commits](https://www.conventionalcommits.org/). The subject
line is `type(scope): what changed`, in the imperative mood, under ~72
characters, with no trailing full stop.

| Type | Use it for |
| --- | --- |
| `feat` | A capability the user can see |
| `fix` | A defect in behaviour that already shipped |
| `refactor` | Changes shape, not behaviour |
| `test` | Tests only |
| `docs` | Documentation only |
| `chore` | Tooling, dependencies, config |
| `ci` | The pipeline itself |
| `perf` | A change made for speed, with a number to back it up |

**Imperative mood** means the subject completes the sentence "if applied, this
commit will…". `add retry helper`, not `added retry helper` or `adds retry
helper`. That is not pedantry — git's own generated messages ("merge branch…",
"revert…") are imperative, so matching keeps the log readable in one voice.

### The body is the part that matters

```
fix(chat): stop retrying 400 responses

The retry helper treated any non-ok response as transient, so a request
rejected for being malformed was sent three more times, each rejected
identically. That turned one user-visible error into four log lines and
a four-second delay before the message appeared.

Only 429, 502, 503, and 504 are retried now. A 400 or 413 means the
request itself is wrong and will stay wrong.

Considered retrying 408 as well, but our server never emits it and a
proxy that does is more likely to be misconfigured than transient.
```

The subject says **what**. The body says **why it needed to change** and **what
you considered instead**. Six months from now the diff will still be readable;
the reasoning will not be recoverable from anywhere else, and the person trying
to recover it is usually you.

Skip the body only when the change is genuinely self-evident (`docs: fix typo in
README`).

### Size

A commit should be one coherent step. Inside a single pull request you might
have four:

```
feat(chat): add the conversation store schema
feat(chat): persist conversations on turn completion
feat(chat): add the conversation sidebar
test(chat): cover quota exhaustion and version mismatch
```

Not one commit called "implement story 24". The split is what lets a reviewer
follow your reasoning, and what makes `git bisect` able to land on the actual
mistake later rather than on a 900-line blob.

---

## Pull requests

Push and open it:

```bash
git push -u origin feat/24-save-conversations   # -u only the first time
gh pr create --fill                              # then edit the body
```

The template will prompt you. Fill it in properly — a reviewer who has to read
the diff to work out what the change is for reviews the diff, not the design.

**Open the PR early**, even unfinished, marked as a draft. CI runs on pull
requests, so a draft PR is the cheapest way to find out that your branch fails
on Node 20.

### Self-review first

Before you request a review, read your own diff on GitHub, top to bottom. Most
of the comments you would have received are ones you will catch yourself:
a leftover `console.log`, a file you did not mean to touch, a function that
grew a second responsibility while you were not looking.

Leave a comment on anything you know a reviewer will pause at. "I used a Map
here rather than an object because insertion order is load-bearing for the LRU"
saves a round trip.

### Size

One concern per pull request. If you find yourself writing "and also" in the
description, that is usually two pull requests.

A 200-line PR gets a real review. A 2000-line PR gets "looks good to me", which
is not a review — it is a rubber stamp with extra steps, and everyone involved
knows it.

---

## Reviewing someone else's pull request

1. **Read the description first.** If you cannot tell what problem it solves,
   that is the first comment to leave, and it outranks anything in the diff.
2. **Pull it and run it.** `gh pr checkout 24 && cd app && npm ci && npm test`.
   Reviews done purely by reading catch style; reviews done by running catch
   behaviour.
3. **Comment on design, not formatting.** If formatting matters enough to
   argue about, it matters enough to automate — open a story for a linter
   instead of relitigating it per PR.
4. **Distinguish blocking from non-blocking.** Prefix optional suggestions with
   "nit:" so the author knows what actually has to change. An unlabelled pile of
   comments reads as "everything here is wrong", which is rarely what you meant.
5. **Approve explicitly.** "Nice" in a comment is not an approval. Use the
   Approve button, or say what is still outstanding.
6. **Ask rather than assert** when you are not sure. "What happens if this
   rejects while the earlier one is still playing?" is a better comment than
   "this is broken", and it is right more often.

---

## Tests

Add a `*.test.js` under `app/test/`. `test/helpers.js` gives you `buildApp()`
with the AWS clients already faked.

Test the behaviour the story describes, and especially the failure cases —
validation rejections, quota exhaustion, an upstream that throws. The happy path
tends to get exercised by hand during development anyway; the error path is the
one that reaches production untested.

A test that cannot fail is worse than no test, because it costs the same to
maintain and buys nothing. If you are not sure yours can fail, break the code
deliberately and watch it go red.

---

## Security expectations

These are not negotiable, and a PR that crosses one of them will be sent back:

- **Never commit a real credential.** `app/.env` is gitignored; `.env.example`
  carries placeholders only. If you commit a key by accident, rotate it — a
  force-push does not un-leak it.
- **Model and user text are untrusted input to the DOM.** Escape before
  rendering. The only unescaped `innerHTML` in this codebase is in `nav.js` over
  a hardcoded constant, and it is commented as such. Keep that count at one.
- **Do not widen CORS or the rate limits** to make something work locally. Set
  `ALLOWED_ORIGINS` in your own `.env` instead.
- **The presigned Transcribe URL is a bearer credential.** Do not lengthen its
  TTL, log it, or cache it.
