# CISSP Question Bank

A weighted CISSP practice-question bank, built as a fully static site for GitHub Pages. Question
counts per domain follow the ISC2 exam outline effective 15 April 2024, scaling to 5,000 questions.
Each question allows exactly two attempts; answers and explanations stay hidden until the question
is resolved.

**Zero runtime dependencies.** Plain HTML, CSS, and ES modules. No framework, no bundler, no npm
packages, no backend. Node (builtins only) powers a local build script.

## Layout

| Path | Purpose |
|------|---------|
| `content/domain-N.json` | Authoring source — hand-edited, readable |
| `schema/question.schema.json` | The data contract (JSON Schema draft 2020-12) |
| `tools/build.mjs` | Validator + compiler |
| `data/` | **Generated** — never hand-edit; regenerate and commit |
| `index.html`, `assets/` | The app |

## Build

```sh
node tools/build.mjs
```

Validates all content and compiles `data/domain-N.json` plus `data/manifest.json`. Any contract
violation fails the build with exit code 1 and emits nothing. Run it after every content change;
a red build is never committed.

## Run locally

The app fetches JSON, so it must be served over HTTP (opening `index.html` directly via `file://`
will not work):

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

## A note on the "sealed" answer key

The build encodes each question's answer and explanations into a base64 blob that the app only
decodes at grading/reveal time. **This is friction, not security.** This is a static site: the
browser must receive the grading data, so anyone who opens DevTools can recover any answer. It
exists only to keep answers out of casual view (page source searches, accidental spoilers), not to
protect them.

## Content

All questions are original, derived from public standards and the published ISC2 exam outline.
Question IDs are permanent — user progress is keyed on them and they are never renumbered or reused.
