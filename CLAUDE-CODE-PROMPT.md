# Build prompt — CISSP Question Bank (static, GitHub Pages)

Paste everything below the line into Claude Code in an empty git repository.

---

You are building a static CISSP practice-question site from scratch, in this repository. Read this
entire brief before writing any code. It is the complete specification — do not improvise around it,
and do not ask me to re-explain parts of it.

## 1. What this is

A weighted CISSP practice bank that scales to **5,000 questions**, hosted on GitHub Pages. Each
question allows **exactly two attempts**. The answer and the reasoning for all four options stay
hidden until the question is resolved — either the user answers correctly, or both attempts are
spent.

It must run with **zero runtime dependencies**: no React, no bundler, no CSS framework, no npm
packages. Plain HTML, CSS, and ES modules in the browser; Node only for a local build script that
uses nothing outside `node:` builtins. GitHub Pages serves static files and nothing else — there is
no server, no database, no API.

## 2. Non-negotiable facts

Domain weights follow the ISC2 exam outline effective **15 April 2024**. Use exactly these numbers:

| # | Domain | Weight | Target questions |
|---|--------|--------|------------------|
| 1 | Security and Risk Management | 16% | 800 |
| 2 | Asset Security | 10% | 500 |
| 3 | Security Architecture and Engineering | 13% | 650 |
| 4 | Communication and Network Security | 13% | 650 |
| 5 | Identity and Access Management | 13% | 650 |
| 6 | Security Assessment and Testing | 12% | 600 |
| 7 | Security Operations | 13% | 650 |
| 8 | Software Development Security | 10% | 500 |
| | **Total** | **100%** | **5,000** |

Weights must sum to 100 and targets to 5,000. The build script asserts both and fails if either
drifts. **Do not use 11% for Domain 8** — that is the pre-2024 figure and it makes the table sum to
101%. If you have web access, verify against
`https://www.isc2.org/certifications/cissp/cissp-certification-exam-outline` before any bulk
authoring run, and tell me if the published weights differ from the table above rather than silently
adjusting.

## 3. Repository layout

```
index.html
.nojekyll                     empty file; stops GitHub Pages running Jekyll
README.md
CLAUDE.md                     rules for future sessions (see §11)
assets/styles.css
assets/app.js
content/domain-1.json … domain-8.json    authoring source, hand-edited, readable
schema/question.schema.json              the contract
tools/build.mjs                          validator + compiler
data/                                    GENERATED — never hand-edit
```

Everything uses relative paths so the site works from a repository subpath
(`https://<user>.github.io/<repo>/`) with no configuration.

## 4. Data contract

Authoring form, one array per domain file:

```json
{
  "id": "D1-0009",
  "domain": 1,
  "objective": "1.10",
  "difficulty": "medium",
  "stem": "Scenario text ... Which control BEST addresses this?",
  "options": ["...", "...", "...", "..."],
  "answer": 2,
  "explanations": ["why A fails", "why B fails", "why C is right", "why D fails"],
  "reference": "NIST SP 800-88r1"
}
```

Rules: `id` matches `^D[1-8]-\d{4}$` and the digit must equal `domain`. `objective` starts with the
domain number. `difficulty` is `easy` | `medium` | `hard`. Exactly four options, exactly four
explanations in the same order; the entry at the `answer` index explains why it is correct, the
other three explain why that specific distractor fails. `reference` is optional.

Write `schema/question.schema.json` as a real JSON Schema (draft 2020-12) encoding the above.

**IDs are permanent.** User progress is keyed on them. Never renumber, never reuse a retired ID.

**Syllabus mapping (added 20 Aug 2026).** The repository carries the ISC2 exam outline as data:
`content/syllabus.json` lists every domain's numbered objectives with their official titles, sourced
from the published outline effective 15 April 2024. Each question's `objective` must exist in the
syllabus — the build fails otherwise, and bare parent-domain placeholders are no longer allowed once
the syllabus lands. The UI shows the linked syllabus section (number and title) for each question so
the user can read/re-read the right material.

## 5. Build script — `tools/build.mjs`

Reads `content/`, validates, writes `data/domain-N.json` and `data/manifest.json`.

Hold the domain table (number, name, weight, target) here as the single source of truth. Assert the
sums.

**Hard errors — exit code 1, emit nothing:** id format or domain mismatch; duplicate id anywhere in
the corpus; objective prefix mismatch; not exactly four options or explanations; non-distinct
options; `answer` outside 0–3; stem under 30 characters; any explanation under 20 characters; an
option matching `^(all|none) of the above`.

**Warnings — print, still build:** the correct option is more than 1.6× longer than the longest
distractor (a length tell). Also print the A/B/C/D answer-position spread as information only, since
the runtime shuffles.

Transform each item into runtime form with short keys and move the answer plus explanations into a
single base64-encoded field:

```js
{ id, d: domain, o: objective, x: difficulty, q: stem, c: options,
  k: base64(JSON.stringify({ a: answer, e: explanations, r: reference ?? null })) }
```

Strip a redundant leading `Correct. ` from the correct explanation — the UI already labels it.

`data/manifest.json` carries build timestamp, total, and per-domain `{n, name, weight, target,
count, file}`.

## 6. Runtime behaviour — `assets/app.js`

**Option order.** Shuffle the four options deterministically from a hash of the question ID —
FNV-1a into a mulberry32 PRNG, then Fisher–Yates. Same question always renders in the same order for
every user, but display order is uncorrelated with the authored answer index. This removes any need
to hand-balance answer positions across 5,000 items. Keyboard keys 1–4 map to *displayed* position.

**Two attempts, precisely.**

- Attempt 1 correct → resolve, reveal everything, record `correctOn: 1`.
- Attempt 1 wrong → do **not** reveal. Strike through and disable the chosen option, show "Not
  correct. One attempt left — that option is now ruled out." One attempt remains.
- Attempt 2 correct → resolve, reveal, `correctOn: 2`.
- Attempt 2 wrong → resolve, reveal, `correctOn: null`.

On reveal: mark every option correct or incorrect, and print all four explanations inline beneath
their options. Never decode the sealed blob before the question is resolved — decode it inside the
grading function and inside the reveal render, not at load time.

**Progress.** `localStorage` under key `cissp-bank/v1`, shape `{ [id]: { tries: number[], resolved:
bool, correctOn: 1|2|null } }`. Wrap every read and write in try/catch and fall back to an in-memory
object — `file://` and private browsing will otherwise throw and take the page down. Provide a
"Clear my progress" action behind a confirm.

**Filtering.** Filter by domain or all domains; toggle "unanswered only". Lazy-load domain files —
never fetch all eight when the user has filtered to one. Shuffle the queue.

**Scoreboard.** Answered, first try, second try, missed.

**Keyboard.** 1–4 select, Enter checks (or advances when resolved), N for next. Ignore when a
modifier is held or focus is in an input.

**Failure state.** If `data/manifest.json` fails to fetch, render a message in the card telling the
user to serve over HTTP rather than opening the file directly. Do not fail silently.

## 7. Design direction

The audience is working security professionals reading dense text for long sessions. This is an
instrument, not an ed-tech toy. Light background, generous line height, restrained colour.

**Signature element:** a left rail listing the eight domains where each bar's **width encodes the
actual exam weight**. The structure carries real information — Domain 1's bar is genuinely wider
than Domain 2's. Clicking a row filters. Each row shows live count against target.

Typography: three roles, and pick faces that are not the defaults you would reach for on any
project — a grotesque for UI, a serif for question stems and options (long reading), a monospace for
IDs, labels, and metadata. Load from Google Fonts with local fallbacks.

Colour: a cool neutral page, white cards, one accent, plus semantic green / amber / red for correct
/ one-attempt-left / missed. **Avoid the warm-cream-plus-terracotta palette and the near-black-plus-
acid-green palette** — both are AI-design clichés and will make this look generated.

Quality floor, unannounced: responsive to 390px with the question card ordered above the rail on
mobile, visible keyboard focus rings, `prefers-reduced-motion` respected, semantic HTML,
`aria-pressed` on toggles. Motion is near-zero here; do not add flourishes.

## 8. Content authoring rules

CISSP tests managerial judgment, not recall. Write scenario-framed items where the best answer is
usually the one a risk manager picks, not the most technical one.

- Capitalise the qualifier: BEST, MOST, FIRST, LEAST.
- Every distractor must be a real concept a candidate could plausibly confuse with the answer. Its
  explanation names the specific confusion and corrects it. No filler options.
- Keep the four option lengths comparable.
- Map each item to a genuine task statement from the published outline. **If you are unsure whether
  a sub-objective number exists, look it up or use the parent domain number — do not invent one.**
- Vary difficulty. Roughly 25% easy, 50% medium, 25% hard.

**Write original questions.** Do not reproduce ISC2 exam items, and do not copy questions or
explanations from commercial banks, Quizlet, exam dumps, or any copyrighted study guide. Derive
content from public standards and the public outline. If a scraped source would be faster, do not
use it — tell me instead.

## 9. Guardrails

**Do**

- Run `node tools/build.mjs` after every content change and before every commit. A red build is
  never committed.
- Test in a real browser before claiming something works. If Playwright or a headless Chromium is
  available, script the flow: wrong-then-wrong, wrong-then-right, right-first-time, and confirm the
  answer is genuinely absent from the DOM in the intermediate state. Screenshot desktop and 390px.
- Keep `data/` committed. GitHub Pages serves what is in the repo; there is no build step on their
  side.
- Report honestly. If something is untested, say it is untested. If a rendered result looks wrong,
  fix it before moving on rather than describing it as done.
- Tell me when a decision is genuinely ambiguous, and propose a default rather than stalling.

**Do not**

- Do not add a framework, bundler, CSS library, or any npm dependency. Zero-dep is a requirement,
  not a preference.
- Do not add a backend, database, service worker, or auth. GitHub Pages cannot host one.
- Do not add analytics, telemetry, tracking pixels, third-party scripts, or ads.
- Do not claim the answer key is secure. Base64 sealing is *friction* on a static site — the
  browser must receive the grading data, so anyone with DevTools can recover it. Say so plainly in
  the README and never oversell it.
- Do not hand-edit anything in `data/`. Regenerate.
- Do not generate all 5,000 questions in one pass, and do not pad a batch with near-duplicates or
  trivial definition-lookup items to hit a count. **Fifty good questions beat five hundred filler
  ones.** If you are running low on distinct angles for a sub-objective, stop and say so.
- Do not renumber or reuse IDs.
- Do not `git push --force`, rewrite history, amend a pushed commit, or commit to any branch other
  than the one we agreed.
- Do not commit `.env`, tokens, keys, or anything from `~/.ssh`. If you find a credential in the
  repo, stop and tell me.
- Do not run `rm -rf` outside this repository, and do not touch files above the repo root.
- Do not silently change the domain weights, targets, schema, or storage key. Those are the contract;
  changing them breaks stored user progress.
- Do not mark a phase complete without running the build and looking at the page.

## 10. Phases — stop at each checkpoint

Build in this order. **Stop and report at the end of each phase; wait for my go-ahead.**

1. **Scaffold.** Repo structure, `.nojekyll`, `.gitignore`, `schema/`, `tools/build.mjs` with the
   domain table and full validation, empty content arrays. Prove the build runs and that a
   deliberately broken item makes it exit 1. Commit.
2. **Engine.** `index.html`, `styles.css`, `app.js` — full two-attempt logic, shuffle, storage,
   filters, scoreboard, keyboard. Author a throwaway handful of items just to drive the UI. Test the
   flow in a browser, screenshot desktop and mobile, then commit.
3. **Seed content.** Begin authoring the **5,000 real questions** distributed by exam weight
   (full targets per the §2 table: D1=800, D2=500, D3=650, D4=650, D5=650, D6=600, D7=650,
   D8=500). Seed in weighted batches of 50 (per batch: D1=8, D2=5, D3=7, D4=6, D5=7, D6=6, D7=6,
   D8=5) until 500 are in, then deploy (phase 4). Build clean, no warnings. Commit per batch.
4. **Deploy.** Push, enable Pages, confirm the live URL loads and grades correctly. Report the URL.
5. **Scale.** Continue authoring toward the full 5,000 in batches of 50 within a single domain, one
   commit per batch with a message like `content(d1): items 0009-0058`. After each batch, report
   the running count against target.

## 11. `CLAUDE.md`

In phase 1, write a `CLAUDE.md` at the repo root so future sessions inherit the rules without me
re-pasting this brief. It should contain: the domain weight table, the ID convention and the
never-reuse rule, the build command, the zero-dependency constraint, the "regenerate `data/`, never
hand-edit" rule, the authoring house rules from §8, and the Do-not list from §9. Keep it under 100
lines and update it whenever a rule changes.

## 12. Git and GitHub Pages

Work on `main`. Conventional-style messages: `feat(engine): two-attempt grading`,
`content(d3): items 0008-0057`, `fix(ui): rail bars collapsing on mobile`. One logical change per
commit; do not batch a content run and a refactor together.

`.gitignore`: `node_modules/`, `.DS_Store`, `*.log`, `.env*`.

Pages setup: Settings → Pages → Deploy from a branch → `main` → `/ (root)`. `.nojekyll` must be
committed or Pages will mangle paths.

After the first deploy, verify on the live URL specifically — not just locally — that `data/` files
load over HTTPS from the project subpath, that grading works, and that progress survives a reload.
>>>Once completed - user will share the github link to upload and also create github.io to host

## 13. Definition of done for each phase

- `node tools/build.mjs` exits 0 with no warnings.
- The page loads with no console errors.
- Wrong-then-wrong, wrong-then-right, and right-first-time all behave per §6, verified in a browser.
- In the one-attempt-left state, the correct answer and all explanations are absent from the DOM.
- Layout holds at 390px and 1280px.
- Live count per domain in the rail matches the manifest.
- Committed and pushed.

Start with phase 1. Show me the plan for it in one short paragraph before you write files.
