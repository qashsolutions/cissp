# CISSP Question Bank — session rules

Static CISSP practice bank on GitHub Pages. Full brief: `CLAUDE-CODE-PROMPT.md` — read it before
large tasks. The rules below are the contract; changing weights, targets, the schema, or the
storage key (`cissp-bank/v1`) breaks stored user progress. Never change them silently.

## Domain table (ISC2 exam outline effective 15 April 2024)

| # | Domain | Weight | Target |
|---|--------|--------|--------|
| 1 | Security and Risk Management | 16% | 800 |
| 2 | Asset Security | 10% | 500 |
| 3 | Security Architecture and Engineering | 13% | 650 |
| 4 | Communication and Network Security | 13% | 650 |
| 5 | Identity and Access Management | 13% | 650 |
| 6 | Security Assessment and Testing | 12% | 600 |
| 7 | Security Operations | 13% | 650 |
| 8 | Software Development Security | 10% | 500 |

Sums: 100% / 5,000. Domain 8 is 10% — 11% is the pre-2024 figure; do not use it.
`tools/build.mjs` holds this table as the single source of truth and asserts the sums.

## Build

- `node tools/build.mjs` after every content change and before every commit. A red build is never
  committed.
- `data/` is GENERATED from `content/` — never hand-edit it; regenerate and commit it (Pages serves
  the repo as-is, no build step on their side).
- The contract lives in `schema/question.schema.json`; the build script enforces it plus
  cross-field rules.

## IDs

`^D[1-8]-\d{4}$`; the digit must equal the domain. **IDs are permanent** — user progress is keyed
on them. Never renumber, never reuse a retired ID.

## Zero dependencies

Plain HTML/CSS/ES modules in the browser; `node:` builtins only in `tools/`. No framework, bundler,
CSS library, or npm package. Everything uses relative paths so the site works from a repo subpath.

## Authoring house rules

- CISSP tests managerial judgment, not recall. Scenario-framed items; the best answer is usually
  the one a risk manager picks, not the most technical one.
- Capitalise qualifiers: BEST, MOST, FIRST, LEAST.
- Every distractor is a real concept a candidate could plausibly confuse with the answer; its
  explanation names that specific confusion and corrects it. No filler options.
- Keep the four option lengths comparable.
- Map each item to a real syllabus section in `content/syllabus.json` (the ISC2 outline as data;
  62 objectives). The build fails unknown objectives; bare domain numbers are not allowed.
- Difficulty mix: roughly 25% easy, 50% medium, 25% hard.
- **Original questions only.** Never reproduce ISC2 items or copy from commercial banks, Quizlet,
  dumps, or copyrighted guides. Derive from public standards and the public outline.
- Author in batches of 50 within one domain; never generate thousands in one pass; never pad with
  near-duplicates or trivial definition lookups. Fifty good questions beat five hundred filler ones.
- Run the `question-auditor` agent (.claude/agents/question-auditor.md) on every new or edited
  batch before committing: it verifies answer veracity, explanation accuracy, and syllabus fit.

## Do not

- Do not add a framework, bundler, CSS library, npm dependency, backend, database, service worker,
  or auth.
- Do not add analytics, telemetry, tracking pixels, third-party scripts, or ads.
- Do not claim the base64-sealed answer key is secure — it is friction on a static site, nothing
  more; the README says so plainly.
- Do not hand-edit `data/`; regenerate.
- Do not renumber or reuse IDs.
- Do not `git push --force`, rewrite history, amend a pushed commit, or commit off the agreed
  branch (`main`).
- Do not commit `.env`, tokens, keys, or anything from `~/.ssh`. Found a credential? Stop and say so.
- Do not run `rm -rf` outside this repo or touch files above the repo root.
- Do not mark a phase complete without running the build and looking at the page in a browser.

## Git

Conventional-style messages: `feat(engine): …`, `content(d3): items 0008-0057`, `fix(ui): …`.
One logical change per commit; never batch a content run with a refactor.
