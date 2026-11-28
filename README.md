# WYK Maths Team

A web-based mathematics practice and assessment platform developed for a secondary school olympiad team.

---

## Overview

WYK Maths Team is a production web application used for daily mathematical practice. It provides a problem bank, an automated judging system, AI-assisted evaluation of free-form responses, timed contests, head-to-head matches, and an administrative console.

The system has operated continuously and manages real student accounts, submissions, and assessment records.

---

## Scope of This Repository

This repository contains application source code only. The following resources are deliberately excluded and are not distributed with this project:

- Problem statements, statement archives, and reference solutions
- Student records, submission history, and account data
- Grading rubrics and model prompt configurations
- Environment secrets and deployment credentials

Any local configuration required to operate the system is environment-specific and is not included.

---

## Functional Scope

### Judging

Submitted answers are validated through one of three mechanisms:

| Mechanism | Description |
| --- | --- |
| Numeric comparison | Floating-point tolerance with significant-figure handling |
| Expression equivalence | Symbolic comparison, so algebraically equivalent forms are accepted |
| Custom script | Author-supplied JavaScript evaluated inside a QuickJS sandbox, subject to a 16 MB memory ceiling and a 1.5 second execution limit |

### AI-Assisted Evaluation

Free-form and handwritten responses are assessed by language models. Three input modes are supported: plain text, structured step-by-step working, and photographic capture. Model output is advisory; human review takes precedence.

### Contests and Matches

- Timed contests with registration, live standings, and post-contest result sheets
- Head-to-head matches with spectator support
- Contest problems are partitioned from the general problem bank

### Supporting Systems

- Achievement system with rarity tiers
- Dual light/dark theming
- Installable progressive web application with offline access to previously visited pages
- Internal messaging, announcements, and audit logging
- Administrative console covering users, problems, submissions, contests, and reports

---

## Technical Architecture

| Layer | Implementation |
| --- | --- |
| Client | Native JavaScript (ES2020+), no framework |
| Styling | Hand-authored CSS with custom properties for theming |
| Server | Vercel Serverless Functions (Node.js) |
| Database | MongoDB Atlas |
| Judging sandbox | QuickJS compiled to WebAssembly |
| Mathematics typesetting | KaTeX |
| Charting | Chart.js |
| Iconography | Font Awesome |

The client is a multi-page application of 63 HTML documents and approximately 40 serverless endpoints. Static assets carry content-derived version identifiers and are served with immutable caching; HTML documents are served with revalidation, so deployments propagate immediately.

There is no build step. Files are deployed as authored.

### Database connections

Every endpoint goes through `lib/mongo.js`, which owns the single `MongoClient` for the
process. Nothing else may construct one — a second client means a second pool, handshaking
the same URI twice and spending the Atlas connection budget twice.

Three mechanisms keep the pool inside its budget under concurrent load:

- **One client, ever.** Concurrent first requests share one in-flight connect promise. Without
  that deduplication, N simultaneous cold-start requests each built their own pool.
- **A small pool.** `maxPoolSize` 5, `maxConnecting` 2, `maxIdleTimeMS` 30s, and
  `waitQueueTimeoutMS` 8s — so a worst-case instance holds 7 connections, not 70. At 500
  connections on a shared Atlas tier that leaves room for ~71 live instances.
- **Per-instance back-pressure.** `wrapHandler` takes a slot before entering the handler, so
  at most `MONGODB_MAX_INFLIGHT` (16) requests reach the driver at once. Fast handlers turn
  over in milliseconds; slow ones would otherwise fill the driver's wait queue and fail late.
  Endpoints that call an AI model for tens of seconds opt out with `{ gate: false }`.

Cold start fails fast: the first request pays the handshake, anything arriving after
`MONGODB_CONNECT_GRACE_MS` gets `503` + `Retry-After` instead of queueing behind it.

`GET /api/db-health` reports the live numbers; `clientsCreated` must stay at 1.

| Variable | Default | Purpose |
| --- | --- | --- |
| `MONGODB_MAX_POOL` | 5 | Connections per instance |
| `MONGODB_MAX_CONNECTING` | 2 | Simultaneous handshakes |
| `MONGODB_MAX_IDLE_MS` | 30000 | Idle connection returned to Atlas |
| `MONGODB_WAIT_QUEUE_MS` | 8000 | How long a query may wait for a free connection |
| `MONGODB_MAX_INFLIGHT` | 16 | Requests allowed into the driver at once |
| `MONGODB_CONNECT_GRACE_MS` | 4000 | Cold-start wait before `503` |
| `MONGODB_GATE_TIMEOUT_MS` | 10000 | How long a request may queue for a slot |

Worth knowing: the numbers above are deliberately conservative because a serverless
function is a small, short-lived process, not an application server. Raising `maxPoolSize`
does not make the site faster — it makes each instance a bigger consumer of a quota shared
with every other instance, including the ones that have not booted yet.

`npm run test:db` exercises all of this end to end: it starts the dev server, fires 50
simultaneous cold-start requests, then 400 requests at 100 concurrency, then 200 more as a
burst, and asserts `clientsCreated === 1`, zero 5xx, and that the gate never exceeds its cap.

---

## Repository Layout

```
.
├── *.html                 Public pages; subdirectories hold grouped routes
├── api/                   Serverless endpoints, one module per action group
├── lib/                   Shared server logic: authentication, error handling,
│                          judging sandbox
├── assets/
│   ├── js/core/           Client foundation: transport, error reporting,
│   │                      page lifecycle
│   ├── js/pages/          Per-page scripts, extracted from their HTML documents
│   └── css/pages/         Per-page stylesheets
├── _template/             Scaffold for new pages
├── tools/                 Development utilities: scaffolding, asset versioning,
│                          auditing
├── dev/                   Developer reference: per-page technical notes
├── vercel.json            Routing and cache policy
└── PAGEDETAIL.md          System overview for newcomers
```

---

## Asset versioning

Every stylesheet and script is served with a content hash in the query string:

```html
<script src="/assets/js/pages/my-skills.js?v=81c19169"></script>
```

`/assets/**` is cached as immutable, so that hash is the only thing that makes a
browser fetch a changed file. Edit a script without bumping its hash and every
returning visitor keeps the old copy — the change looks like it never shipped.

That failure mode has been hit three times: the skill detail card, the Vercel
cost split, and the tutor panel opening at 0×0. Each time the code was correct
in the repository and stale in the browser.

### Automatic re-stamping

A pre-commit hook now handles it:

```sh
node .githooks/install.mjs        # once per clone
```

This sets `core.hooksPath` to `.githooks`. From then on, any commit whose
staged set touches `assets/` or `*.html` runs `tools/version-assets.mjs`,
re-stages the rewritten files, and proceeds. Commits that touch neither are
unaffected.

If `tools/version-assets.mjs` is missing — it is an operator script, not part of
the distributed source — the hook exits quietly and nothing breaks.

### What still needs a manual build

Stamping is not bundling. Thirteen head scripts and eight body scripts are
concatenated into `bundle.head.<sha>.js` and `bundle.body.<sha>.js`, and
`bundle-loader.js` points at them:

```sh
node tools/build-bundle.mjs
```

The hook does **not** run this. If you edited a bundled file — anything under
`assets/js/` outside `assets/js/pages/`, plus `auth.js`, `sidebar.js`,
`pd-script.js`, `script-panel.js` — run the build yourself before committing.

These are **not** bundled and only need the version bump, which the hook does
for you:

```
assets/js/pages/*.js
assets/js/tutor.js
assets/js/heartbeat.js
```

### Adding a new page

A new HTML page must carry `?v=` on every asset reference, otherwise the hook
has no pattern to rewrite. Copy the `<head>` of an existing page.

## Design Constraints

The architecture reflects a small set of deliberate constraints rather than convention.

**No build pipeline.** Introducing a bundler would require a compile step, a dependency graph, and a release artifact. The savings would be marginal: the application consists of many pages with comparatively simple interactions. Assets are therefore served as authored.

**Framework independence.** The client is written against platform APIs. Shared behaviour is consolidated into a small foundation layer rather than inherited from a component model.

**Immediate propagation.** Documents revalidate on each request and assets are fingerprinted by content. A deployment is visible to users on their next navigation, without cache invalidation procedures.

**Uniform error contract.** All endpoints return a structured payload containing a status flag, a machine-readable code, a human-readable message, and a request identifier. Server-side diagnostic detail is restricted by caller privilege.


---

## Recurring Failure Modes

Three things have broken production more than once. They are recorded here because each one looked correct in the file that was edited.

### The script list exists twice

`bundle-loader.js` decides what to load based on `localStorage['moj:perf:bundle']`. **That flag is off by default**, so the normal path is the hand-written `LISTS.head.files` array inside the loader — not `bundle.head.<sha>.js`.

`tools/build-bundle.mjs` keeps a second copy of the same list in `PARTS` to produce the bundle those few users get.

Adding `core/img.js` to `PARTS` alone meant the bundle contained `window.imgUrl` while every ordinary visitor loaded thirteen separate files without it. Leaderboard, submission list and profile page all threw `ReferenceError: imgUrl is not defined` — and it reproduced in incognito, because nothing was cached wrongly.

`tools/check-bundle-lists.mjs` now compares the two arrays and `build-bundle.mjs` exits non-zero when they drift.

**When adding a shared script: change both lists, then run `node tools/build-bundle.mjs` and confirm it passes the check.**

### Cloudinary signatures cover every parameter

Uploads are signed by concatenating **all parameters except `file`, `api_key` and `signature`**, sorted alphabetically, then appending the API secret.

`overwrite=true` was passed in the form but left out of the string being signed, so every upload returned `401 Invalid Signature`. The error message names the exact string Cloudinary built — read it rather than guessing.

```js
const signed = { overwrite: 'true', public_id, timestamp };
const toSign = Object.keys(signed).sort().map(k => k + '=' + signed[k]).join('&') + secret;
```

### `Add-Content -Encoding utf8` silently truncates files

Appending CSS in three passes with `Add-Content -Encoding utf8` produced a 3.6 KB file whose tail was cut mid-declaration, with Chinese comments mangled into mojibake. The rules simply were not there — and because the file still loaded with 200, it looked like a caching problem for three rounds of debugging.

**Write whole files with the file tools. Do not append to source files from PowerShell.**

## Status

The codebase is in active production use. It retains the ordinary accumulation of a long-running system: transitional modules, superseded approaches, and areas identified for revision. It is published as a working implementation rather than as a reference design.

---

## License

See [LICENSE](LICENSE).

Problem content is not included in this repository. Rights to individual problems remain with their respective sources.
