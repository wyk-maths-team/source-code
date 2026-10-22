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

## Design Constraints

The architecture reflects a small set of deliberate constraints rather than convention.

**No build pipeline.** Introducing a bundler would require a compile step, a dependency graph, and a release artifact. The savings would be marginal: the application consists of many pages with comparatively simple interactions. Assets are therefore served as authored.

**Framework independence.** The client is written against platform APIs. Shared behaviour is consolidated into a small foundation layer rather than inherited from a component model.

**Immediate propagation.** Documents revalidate on each request and assets are fingerprinted by content. A deployment is visible to users on their next navigation, without cache invalidation procedures.

**Uniform error contract.** All endpoints return a structured payload containing a status flag, a machine-readable code, a human-readable message, and a request identifier. Server-side diagnostic detail is restricted by caller privilege.

---

## Status

The codebase is in active production use. It retains the ordinary accumulation of a long-running system: transitional modules, superseded approaches, and areas identified for revision. It is published as a working implementation rather than as a reference design.

---

## License

See [LICENSE](LICENSE).

Problem content is not included in this repository. Rights to individual problems remain with their respective sources.
