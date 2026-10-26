# Page Technical Reference

Implementation notes for whoever maintains this platform: load order, data flow, and per-page behaviour.

Covers **non-administrator pages in detail**.

Figures taken from `node tools/audit-pages.mjs --json` (2026-10, after the M1–M3 refactor).

> Endpoint-level documentation lives in `dev/API.md`, which is kept locally and excluded from version control.

---

## Contents

- [0. Quick reference](#0-quick-reference)
- [1. Foundation](#1-foundation)
  - [1.1 What happens on page load](#11-what-happens-on-page-load)
  - [1.2 The core layer](#12-the-core-layer)
  - [1.3 Authentication](#13-authentication)
  - [1.4 Caching and versioning](#14-caching-and-versioning)
- [2. Core pages](#2-core-pages)
  - [2.1 problems/[id] — problem detail](#21-problemsid--problem-detail)
  - [2.2 submissions — submission list](#22-submissions--submission-list)
  - [2.3 user — profile](#23-user--profile)
  - [2.4 ranklist — leaderboard](#24-ranklist--leaderboard)
  - [2.5 status — judge status](#25-status--judge-status)
  - [2.6 index — home](#26-index--home)
  - [2.7 settings](#27-settings)
  - [2.8 problems — problem list](#28-problems--problem-list)
  - [2.9 resources](#29-resources)
  - [2.10 Sign-in and password flows](#210-sign-in-and-password-flows)
- [3. PK subsystem](#3-pk-subsystem)
- [4. Training and other modules](#4-training-and-other-modules)
- [5. Auxiliary pages](#5-auxiliary-pages)
- [6. Constraints and traps](#6-constraints-and-traps)
- [7. Debugging](#7-debugging)

---

## 0. Quick reference

| Page | Source | Main script | Key dependency | Main hazard |
|---|---|---|---|---|
| Problem detail | `problems/[id].html` | `pd-script.js` / `pd-extras.js` / `pd-mcq.js` | three scripts loaded **at runtime** | logic is not in the HTML |
| Submission list | `submissions.html` | `pages/submissions.js` | `api/submissions.js` | one file serves three routes |
| Profile | `user.html` | `pages/user.js` | `api/users.js` | four concurrent data sources |
| Leaderboard | `ranklist.html` | `pages/ranklist.js` | `api/charts.js` | front-end and back-end use different measures |
| Judge status | `status.html` | `pages/status.js` | `api/status.js` | polling, not push |
| Home | `index.html` | `pages/index.js` | `api/updates.js` | announcement text is hardcoded |
| Settings | `settings.html` | `pages/settings.js` | `localStorage` only | cache button does not clear HTTP cache |
| Problem list | `problems.html` | `pages/problems.js` | `api/problem.js` | list rendering lives in `pd-script.js` |
| PK room | `pk-room.html` | `pages/pk-room.js` | `api/pk.js` | three-role state machine + polling |
| Training | `tr-system.html` | `pages/tr-system.js` | `api/tr-problems.js` | images served from an external CDN |

---

## 1. Foundation

### 1.1 What happens on page load

```
1. HTML arrives (no-cache, revalidated every request)
2. <head> inline: theme initialisation (synchronous, prevents white flash)
3. <head> inline: window.__BUILD_V (asset fingerprint)
4. arch-render.js (synchronous) — injects the achievement toast container
5. <body> end, in this order:
   a. core/ui.js       → window.DSHUI (toast / escape / error panel)
   b. core/net.js      → hijacks window.fetch, centralised error handling
   c. core/api.js      → window.API (token-aware request helpers)
   d. core/page.js     → window.Page (lifecycle + global user object)
   e. auth.js          → gate; redirects if the route is not public
   f. sidebar.js       → renders navigation
   g. topbar.js        → renders the top bar
   h. heartbeat.js     → presence reporting
   i. pages/<page>.js  → this page's logic
6. Callbacks registered in Page.ready(...) begin
```

**The order is load-bearing.** `ui` → `net` → `api` → `page` must hold:
`net` wraps `fetch` and reports through `ui`; `api` builds on `net`; `page` depends on all three.

### 1.2 The core layer

| File | Exposes | Responsibility | Boundary |
|---|---|---|---|
| `ui.js` | `DSHUI` | `esc()`, `toast()`, `showError()` | no network |
| `net.js` | — | wraps `window.fetch`; 5xx opens a detail panel, 4xx logs to console | observes only, never rewrites requests |
| `api.js` | `API` | `get/post/put/del`, attaches `Authorization`, throws structured `ApiError` | contains no business logic |
| `page.js` | `Page` | boot order, `user`, skeleton state, error boundary | does not enforce auth |

**Debug switch**: appending `?apiDebug=1` to any URL makes every failure (including 4xx) open the full detail panel — error code, request id, HTTP status, endpoint path, underlying exception — with a copy button. This is the primary way to debug production issues.

Default behaviour: 5xx raises a clickable toast; 4xx stays in the console so students are not interrupted.

### 1.3 Authentication

Two sources, the second taking precedence:

1. **Hardcoded allowlist** in `auth.js` (~line 260): `/`, `/index.html`, `/404`, `/credits`, `/guide`, `/login`, `/os*`, `/root-login`, `/auth/*`, `/ranklist.html`, `/forgot-password.html`, `/reset-password.html`
2. **Page-level declaration**: `<meta name="requires-auth" content="false" />`

Failure → `location.href = '/index.html'`.

**New public pages should use the second mechanism.** Editing the allowlist means every future public page has to touch `auth.js`, which is referenced by 63 documents.

Server-side authorization is separate (`lib/` validates JWTs independently). The client gate is a UX measure, **never a security boundary**.

### 1.4 Caching and versioning

| Asset | Response header | How it updates |
|---|---|---|
| `/assets/js/**`, `/assets/css/**` | `immutable, max-age=31536000` | `?v=<content hash>` must change |
| `*.html` | `no-cache, must-revalidate` | deploy takes effect immediately |
| images / fonts | `immutable` | rename or add `?v=` |

`npm run version:assets` recomputes content hashes, rewrites every `?v=` across all HTML, and injects `window.__BUILD_V`.
`npm run check:versions` verifies consistency — **forgetting to run it is the single most common cause of production breakage in this project**.

The "Clear cached scripts & styles" button in settings clears the Service Worker cache only; it **cannot** evict `immutable` HTTP cache entries.

---

## 2. Core pages

### 2.1 `problems/[id]` — problem detail

The most complex page in the system, and its HTML contains almost no JavaScript.

One inline line. The real logic is three files loaded **at runtime**:

| Script | Lines | Loaded when |
|---|---|---|
| `assets/js/pd-script.js` | ~900 | always |
| `assets/js/pd-extras.js` | ~1300 | injected by `pd-script.js` via `EXTRAS_JS_URL` |
| `assets/js/pd-mcq.js` | ~356 | injected via `MCQ_JS_URL`, multiple-choice problems only |

Injection appends the version parameter, so `version:assets` must recognise these three — they live directly under `assets/js/`, not in `pages/`.

**Data flow**:

```
URL /problems/HA0001
  ↓ rewrite: /problems/:id → /problems/[id].html
  ↓ client parses id from pathname
  ↓ GET /api/problem?action=detail&id=HA0001
  ↓ { problem, submission, ... }
  ↓ statement rendered, KaTeX processes maths
  ↓ interface branches on problem.FS
```

**Two fields worth knowing**:

- `problem.FS === true` — free-response only. Text answers are refused; the student must use step-by-step assessment or upload an image. Set when a single value cannot express the answer.
- `problem.mcq` — routed through the multiple-choice flow, loading `pd-mcq.js`.

**Submission paths**:

| Mode | Endpoint | Note |
|---|---|---|
| Numeric / expression | `POST /api/submit` | server compares; may invoke `logic-runner.js` inside a sandbox |
| Image | `POST /api/submit` with base64 | uploaded to Cloudinary, then judged |
| Step-by-step | `POST /api/steps-grade` | per-step scoring, human-reviewable |

**Editing behaviour here means editing the JS files.** Changes to the HTML have no effect.

### 2.2 `submissions` — submission list

**One file serves three routes**:

```
/submissions                     → all submissions
/submissions/user/:username      → one user's history
/submissions/problem/:id         → attempts at one problem
```

A regex over `location.pathname` selects the query and adjusts the surrounding copy.

**Pagination is the fragile part**:

- `fetchPage(page)` loads a given page
- `prefetchNearby()` warms adjacent pages on scroll
- paging state lives in a closure — **do not mutate the page index directly**, call `goto(page)`

When touching this, verify by hand: first page → next → previous → last → filter → paging resets.

**Filters** (status / language / problem) reset to page 1 and re-query. Filter state is mirrored into the query string, so reloading preserves the view.

### 2.3 `user` — profile

Route `/users/:username`.

**Four data sources fetched concurrently**; failure of one must not block the others:

```
GET /api/users?action=profile&username=X      → identity, rank title
GET /api/users?action=stats&username=X        → solve counts, difficulty spread
GET /api/submissions?action=recent&user=X     → recent activity
GET /api/charts?action=user&username=X        → chart series
```

Rendered with `Promise.allSettled` semantics — a missing card shows a placeholder rather than failing the page.

**Viewing your own profile** reveals the edit entry point; viewing someone else's does not. The branch is `window.Page.user.username === targetUsername`.

### 2.4 `ranklist` — leaderboard

Public — visible without signing in.

**Note the two measures.** The front end displays a pre-sorted result, but "problems solved" and "difficulty score" are computed differently and the query parameters differ per tab. A student who grinds easy problems can lead on one and trail on the other.

Pagination plus a username search. The search filters **the pages already loaded**, not the whole collection — with a large roster this produces "no results" for users who exist.

### 2.5 `status` — judge status

Shows recent submissions and their judging state.

**This polls; it does not push.** While the page is open it re-queries every N seconds and stops when closed. There is no WebSocket anywhere in the system.

The interval is a trade-off: too short strains the database, too long feels unresponsive. Redirecting here after submitting relies entirely on this interval.

In `api/status.js`, the `system` and `vercel` actions are **administrator-only** (403 otherwise). Ordinary users can only query their own submissions.

### 2.6 `index` — home

Three parts:

1. **Announcements** (`api/updates.js`), authored by administrators
2. **Personal summary** when signed in — solved count, recent activity
3. **Entry cards**

**PWA redirect**: `app.js` contains `forcePWAHome`, which sends certain mobile contexts to `/os`. Do not break this when restructuring the landing page.

The 362 lines of CSS here are among the heaviest in the project, because this page carries the visual identity.

### 2.7 `settings`

**All ten settings are `localStorage`-only** (password change excepted).

| Setting | Key | Note |
|---|---|---|
| Theme | `theme` | `light` / `dark`; also read by the inline `<head>` script |
| Animations | `no-animations` | toggles a body class |
| Sidebar | `sidebarOpen` / `sidebarHiddenDesktop` | mobile drawer and desktop collapse use **two different keys** |
| Code font size | several | affects statement rendering |

**Easter egg**: toggling Animations five times navigates to `/settings/extra`.

**What Clear Cache actually does**: enumerates `caches.keys()`, deletes Cache Storage, unregisters the Service Worker. It has **no effect on HTTP cache**, so pressing it after a JS change does nothing — that requires `version:assets`.

### 2.8 `problems` — problem list

23 inline lines. **Rendering, filtering and virtual scrolling all live in `pd-script.js`**, shared with the detail page.

So changing list behaviour means editing `assets/js/pd-script.js`, not the HTML.

Data: `GET /api/problem?action=list` returning metadata only, no statements.

### 2.9 `resources`

A navigation page for notes and external material; largely hardcoded.

One `fetch` probes resource availability and degrades to the static list on failure.

### 2.10 Sign-in and password flows

Four independent paths, none requiring an existing session:

| Page | Route | Flow |
|---|---|---|
| Sign in | `/login` | username + password → JWT in `localStorage.auth_token` |
| Forgot password | `/auth/forgot-password` | submit identifier → reset link by email |
| Reset password | `/auth/reset-password` | token-bearing link → set new password |
| First-time setup | `/auth/setup` | forced password choice on first sign-in |

**Token handling**: stored in `localStorage.auth_token` as `header.payload.signature`; attached by `core/api.js` as `Authorization: Bearer <token>`.

**Sign-out** clears the token, removes `sidebarOpen`, and redirects home. `api/heartbeat?action=offline` marks the session offline (called from `auth.js`).

`login.html` is marked `auth` in the audit — not a contradiction: it means the page participates in the auth system, and the route is allowlisted so it stays reachable while signed out.

---

## 3. PK subsystem

Three pages form one chain:

```
pk-invite.html   send / accept an invitation → create or join a room
pk-waiting.html  wait for the opponent → poll room state
pk-room.html     the match: problem, buzzer, judging, result
```

### State machine

Backed by `api/pk.js`. Three client roles:

- `isHost` — initiator
- `isGuest` — acceptor
- `isSpectator` — anyone else

**Spectators are deliberately unrestricted.** This is a product decision, not an oversight: an audience is part of the appeal.

Only host and guest get an answer surface; spectators see live progress.

### Polling

No WebSocket. Both waiting and room pages poll `api/pk?action=state` on a timer.

- Waiting uses a shorter interval (must notice the opponent arriving)
- Room uses a slightly longer one (still fast enough for buzzer fairness)

**Known condition**: one authorization check in `api/pk.js` is commented out. Intentional while spectators are open; restore it if that changes.

### Problem source

Match problems come from the general bank but a separate pool is curated via `admin-pkproblem`.

---

## 4. Training and other modules

### 4.1 `tr-system` — TR training

**976 inline lines, third largest in the project.**

- Problem images load from an **external CDN**: `https://cdn.jsdelivr.net/gh/wyk-math-team/resources@main/script/tr-images/`
  Deliberate — 540 images do not belong in git.
- Dedicated endpoint `api/tr-problems.js`; access controlled by `TR_ALLOWED_USERS`
- 815 lines of inline CSS, second heaviest

**Status**: this module is no longer maintained. Confirm whether it should survive before investing in it.

### 4.2 `port` — portfolio

Two inline lines. Route is a long randomised path under `/port/`.

Content comes from the isolated `api/port/*` subsystem, kept deliberately separate from the main site's data.

### 4.3 `mobile/index` — mobile entry

Two inline lines, routed at `/os`. Its main purpose is to receive traffic redirected by `forcePWAHome`.

### 4.4 `contest` family (brief)

- `contest.html` — contest list
- `contest/[id].html` — contest detail and problem set
- `contestresults.html` — post-contest results

All three share `api/contests.js`, distinguished by `action`. Contest data lives in separate collections from the general bank. Used infrequently.

---

## 5. Auxiliary pages

| Page | Inline JS | Note |
|---|---|---|
| `credits.html` | 19 | acknowledgements, near-static |
| `guide.html` | 5 | user guide, 272 lines of CSS, content hardcoded |
| `404.html` | 23 | fallback; the last rewrite in `vercel.json` targets it |
| `calendar.html` | 487 | study calendar over `api/calendar.js` |
| `charts.html` | 435 | progress charts, Chart.js |
| `editpassword.html` | 85 | password change at `/users/edit` |
| `forgot-password.html` | 24 | see 2.10 |
| `reset-password.html` | 81 | see 2.10 |
| `setup.html` | 47 | see 2.10 |

**`charts.html` legacy**: its local `escapeHtml` escaped only `& < >` — **not quotes** — leaving an attribute-context XSS vector. Fixed when migrated to `DSHUI.esc`, but any code copied from the old version inherits the flaw.

**Three `extra` pages**:

| File | Access | Status |
|---|---|---|
| `extra.html` | `/settings/extra` | has a rewrite |
| `settings/extra.html` | `.html` only, no short route | content largely duplicates the above |
| `eeeee.html` | long randomised path | easter egg |

`extra.html` and `settings/extra.html` share a title and similar length — **probably two versions of one feature**. Confirm and delete one.

`os-temp.html` and `template.html` are also unresolved: the former is a scratch page, the latter an early template superseded by `_template/`.

---

## 6. Constraints and traps

| # | Constraint | Consequence |
|---|---|---|
| 1 | Running `version:assets` after touching `assets/` | New HTML paired with old JS — blank pages |
| 2 | New routes must precede the 404 fallback | Permanent 404 |
| 3 | New public pages must declare the meta tag | Redirected home |
| 4 | The theme script must stay inline in `<head>` | White flash on every navigation |
| 5 | `#mainContent` id is relied upon by `pd-script.js` | Renaming breaks problem rendering |
| 6 | Inline scripts were extracted — editing HTML changes nothing | Logic lives in `assets/js/pages/` |
| 7 | `window.__BUILD_V` is injected by tooling | Hand edits get overwritten |
| 8 | Three separate `parseReply` implementations in the AI grading path | Fixing one leaves two broken |

---

## 7. Debugging

### See real endpoint errors

```
https://<site>/?apiDebug=1
```

Every failure then opens a full panel: error code, HTTP status, endpoint path, request id, underlying exception — with a copy button.

Default: 5xx raises a toast, 4xx writes to console, so students are not disturbed.

### Local cache behaviour

`vercel dev` **does not apply** the headers in `vercel.json`; locally every asset is `must-revalidate`.
To observe real cache behaviour, use `npm run serve`, which reads `vercel.json` and emits the correct headers.

### Redirected unexpectedly

1. Is `localStorage.auth_token` present
2. If the page should be public, does it carry `<meta name="requires-auth">`
3. Is the path in the `auth.js` allowlist

### Consistency checks

`npm run check:versions` — verify every `?v=` matches actual asset content.
`npm run audit:pages` — regenerate the page inventory this document draws on.
