# Using the Platform

A guide to the student experience: signing in, working through problems, tracking progress, and taking part in contests.

---

## Contents

- [1. Signing in](#1-signing-in)
  - [First-time setup](#first-time-setup)
  - [Forgotten password](#forgotten-password)
  - [What you can see without an account](#what-you-can-see-without-an-account)
- [2. Finding problems](#2-finding-problems)
  - [The problem list](#the-problem-list)
  - [Filtering and searching](#filtering-and-searching)
  - [Bookmarks](#bookmarks)
- [3. Answering a problem](#3-answering-a-problem)
  - [Three ways to answer](#three-ways-to-answer)
  - [When only the final answer is not enough](#when-only-the-final-answer-is-not-enough)
  - [Submitting an image](#submitting-an-image)
- [4. Reading your results](#4-reading-your-results)
  - [Judging outcomes](#judging-outcomes)
  - [Why some results take longer](#why-some-results-take-longer)
  - [Submission history](#submission-history)
- [5. Tracking progress](#5-tracking-progress)
  - [Your profile page](#your-profile-page)
  - [Progress charts](#progress-charts)
  - [The calendar](#the-calendar)
  - [The leaderboard](#the-leaderboard)
- [6. Contests and matches](#6-contests-and-matches)
  - [Contests](#contests)
  - [Head-to-head matches](#head-to-head-matches)
- [7. Settings](#7-settings)
- [8. Common questions](#8-common-questions)

---

## 1. Signing in

Go to `/login` and enter your username and password.

### First-time setup

New accounts arrive with a temporary password. On your first sign-in you will be taken to `/auth/setup` and asked to choose a new one. Pick something you will remember — there is a password reset by email, but it is slower than just remembering it.

### Forgotten password

Use **Forgot password** on the sign-in page. You will be asked for your email or username; a reset link is sent to the registered address. Open the link and set a new password.

If the email does not arrive within a few minutes, check your spam folder before asking for help.

### What you can see without an account

Four pages are public:

- the home page
- the leaderboard
- the credits page
- this guide

Everything else requires signing in. If you open any other address while signed out, you will be sent back to the home page.

---

## 2. Finding problems

### The problem list

`/problems` shows the full question bank. Each row carries the problem identifier, its title, a difficulty rating, and topic tags.

Difficulty runs on a decimal scale. It is **calculated from how other students performed on that problem**, not assigned by hand — so a rating can shift over time as more attempts are recorded.

### Filtering and searching

You can narrow the list by topic, difficulty range, or status (attempted / solved / unsolved). Filters combine, and the current selection is written into the address bar — so you can bookmark a filtered view, or send the link to a classmate.

### Bookmarks

Press the bookmark icon on any problem to save it. Saved problems appear at `/problems/bookmarked`.

---

## 3. Answering a problem

### Three ways to answer

Which one you get depends on the problem, not on your preference:

| Mode | What you do |
|---|---|
| **Numeric** | Type a single value |
| **Expression** | Type a formula |
| **Written / image** | Write out your working, or photograph it |

The expression mode accepts algebraically equivalent forms. `2(x+3)` and `2x+6` are treated as the same answer — you do not need to guess which arrangement the system expects.

### When only the final answer is not enough

Some problems are marked as **requiring working**. For these, a bare final answer is not accepted. You must either:

- write your reasoning step by step, or
- upload a photograph of your handwritten solution

This is set per problem by whoever authored it, usually because the answer alone would not show whether you actually solved it.

### Submitting an image

Photograph your work, then upload it directly on the problem page. Take the photo in reasonable light, keep the page flat, and make sure the whole solution is in frame — the text is read automatically, and a clear image means a fairer assessment.

---

## 4. Reading your results

### Judging outcomes

| Result | Meaning |
|---|---|
| **Accepted** | Correct |
| **Wrong answer** | The answer does not match |
| **Partial** | Partially correct — the working earned some credit |
| **Pending** | Still being processed |
| **System error** | Something failed on our side; not your fault |

### Why some results take longer

Numeric and expression answers are checked immediately.

Written answers and photographs are assessed by a language model, which takes longer. The result appears once assessment finishes — you do not need to keep the page open, and you can find it later in your submission history.

Where a problem has a human reviewer, their judgement overrides the automated one.

### Submission history

`/submissions` lists your attempts, most recent first. Three views are available:

- **all submissions** — everyone's
- **by user** — one person's history
- **by problem** — everyone's attempts at a single problem

The last two are useful when comparing approaches.

---

## 5. Tracking progress

### Your profile page

`/users/<your-name>` collects your activity in one place: how many problems you have solved, how that splits across difficulty bands, and what you have worked on recently.

You can view anyone's profile, not just your own.

### Progress charts

`/charts` plots your solving history over time, broken down by difficulty and topic. Useful for spotting which area has gone quiet.

### The calendar

`/calendar` shows a day-by-day record of your activity. You can add notes to particular days.

### The leaderboard

`/leaderboard` ranks everyone. It is public — visible without signing in.

Two different measures are shown, and they do not always agree:

- **problems solved** — raw count
- **difficulty score** — weighted by how hard the problems were

Somebody who grinds easy problems can lead on one and trail on the other. Both are shown on purpose.

---

## 6. Contests and matches

### Contests

A contest is a set of problems with a start time and a fixed duration. You join beforehand; at the start the problems unlock; when time runs out submissions stop being accepted.

Contest problems are kept separate from the general bank so that nobody can look them up in advance. Results are published afterwards at `/contest/<id>/results`.

Contests are run only occasionally.

### Head-to-head matches

A match is two people answering the same problem at the same time, first correct answer winning.

The flow is three steps:

1. **Invite** — send a challenge from `/pk/invite`
2. **Wait** — both sides confirm at `/pk/waiting`
3. **Play** — the match runs at `/pk/room`

**Other people can watch.** This is deliberate, not a privacy gap — an audience is part of the point. Spectators see progress but cannot answer.

---

## 7. Settings

`/settings` holds your personal preferences. Everything here is stored in your own browser, not on the server, so it does not follow you to another device:

- **Theme** — light or dark
- **Animations** — turn off if motion is distracting
- **Sidebar** — pin it open or collapse it
- **Code font size** — for problems that show code

Two of the pages in this section are less obvious:

- **Clear cached scripts & styles** — forces the site to re-download its own files. Use it if a page looks broken or out of date.
- A hidden extra settings page exists. It is reached by a small easter egg on this page.

---

## 8. Common questions

**"I was sent back to the home page."**

You were signed out, or your session expired. Sign in again. If it keeps happening on a page that should be visible while signed out, the page may have lost its public marking — mention it to whoever maintains the site.

**"My answer was rejected but I am sure it is right."**

Check the expected format first — for expression problems, a numeric approximation is not the same as an exact expression. If it genuinely looks wrong, open the submission detail page; it shows what was actually submitted and what the system compared it against.

**"The problem page looks broken — text overlapping, formulas missing."**

Reload with a hard refresh first. If it persists, use **Clear cached scripts & styles** in settings. Formula rendering depends on a stylesheet that occasionally fails to load.

**"My writing submission has been pending for a long time."**

Written answers are queued for assessment. Under heavy load the queue is longer. If it stays pending for hours, report it — that usually means the assessment process has stopped rather than being slow.

**"Can I see the answer after submitting?"**

No. Reference solutions are not shown, even after an accepted submission. This is deliberate: problems are reused between cohorts.

**"Why does my rank differ between two pages?"**

The leaderboard shows both raw solved count and a difficulty-weighted score. Depending on which tab you are looking at, your position will differ.

---

*This guide covers the student-facing side. Technical notes for whoever maintains the platform are in [`dev/PAGEDETAIL.md`](dev/PAGEDETAIL.md).*
