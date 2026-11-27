# Science Diagram Maker

A small web app that asks a free **Gemini** model to draw **5 animated SVG science diagrams** for
UK GCSE students, checks every diagram **in code**, and lets a human reviewer approve or reject it.

- **Live app:** https://science-diagram-maker-sars-projects-d2931c00.vercel.app
- **Repository:** https://github.com/sarveshsinghthakur/science-diagram-maker (public)

---

## 1. What it does

| Part | Requirement | Where it lives |
| :--- | :--- | :--- |
| A | Ask Gemini for one animated SVG per concept | `src/lib/gemini.ts` |
| A | Validate every SVG with 4 required checks + 1 custom check | `src/lib/validator.ts` |
| A | Retry once on a failed check and tell the model why | `src/lib/gemini.ts` (`VALIDATION_RETRY_LIMIT`) |
| A | Retry 429 / 503 API errors up to 3 times with backoff | `src/lib/gemini.ts` (`API_RETRY_LIMIT`) |
| A | Log model, tokens, cost, retries and check results | `src/lib/constants.ts` → `GenerationResult` |
| A | Save the 5 final results to `results.json` | `src/lib/generator.ts` → `saveResults()` |
| B | Table with 5 rows: diagram, per-check pass/fail, cost, retries | `src/components/Dashboard.tsx` |
| B | Approve / Reject buttons with a note box, persisted across refresh | `src/components/Dashboard.tsx` |
| B | "Generate" button that runs Part A live for one concept | `POST /api/generate-one` |
| B | 5 saved results show on first load with **no** API call | `src/app/page.tsx` (build-time import of `results.json`) |

---

## 2. How to run it on your computer

**Requirements:** Node.js 20.9+ and a free Gemini API key from
[aistudio.google.com/api-keys](https://aistudio.google.com/api-keys) (no credit card needed).

```bash
# 1. Install dependencies
npm install

# 2. Add your key (never commit this file)
cp .env.example .env.local
# .env.local
# GOOGLE_GENERATIVE_AI_API_KEY=your_key_here
# GEMINI_MODEL=gemini-3.5-flash-lite     # optional, this is the default

# 3. Generate the 5 diagrams and write results.json
npm run generate

# 4. Start the app
npm run dev
```

Open <http://localhost:3000>.

### Other useful commands

```bash
npm run test:validator   # unit tests for the SVG validation checks
npm run build            # production build
npm run lint             # ESLint
```

### Deploying to Vercel (free)

1. Push this repo to GitHub.
2. Go to [vercel.com/new](https://vercel.com/new) and import the repository.
3. Add **one** environment variable: `GOOGLE_GENERATIVE_AI_API_KEY` (and optionally `GEMINI_MODEL`).
4. Click **Deploy**. The app is live in about a minute.

Vercel runs the production build, which imports `results.json` at build time — so the table with
all 5 diagrams is present the moment the site opens, with no API call and no API key exposure.

---

## 3. How the code works

### 3.1 The validation checks (`src/lib/validator.ts`)

Every SVG returned by the model is parsed with `@xmldom/xmldom` and put through five checks. Each
check returns a boolean, and the UI shows one green/red tick per check.

| # | Check name | What it actually does |
| :-- | :--- | :--- |
| 1 | `isParsable` | Parses the string as XML. A malformed document makes the parser throw, which is caught and reported as a parse failure. A missing `<svg>` root also fails. |
| 2 | `withinViewBox` | Reads the `viewBox`, then computes an approximate bounding box for every `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `path` and `text`. Path data is tokenised so `M/L/H/V/C/S/Q/T/A` commands are followed properly, and `translate` / `scale` transforms on the element **and its ancestors** are accumulated. If any box escapes the viewBox (with a 0.5-unit tolerance) the check fails. |
| 3 | `hasTitleAndLabels` | Requires a non-empty `<title>` **and** at least three `<text>` elements. |
| 4 | `hasAnimation` | Looks for SMIL (`<animate>`, `<animateTransform>`, `<animateMotion>`, `<set>`), a `<style>` block containing `@keyframes` / `animation:`, or an `animate`-ish CSS class. |
| 5 | `noScripts` **(my custom check)** | Security check. Fails if the SVG contains a `<script>` element, a `<foreignObject>`, any inline `on*` event handler (`onclick`, `onload`, …) or any `javascript:` URL. This is also what makes it safe to render the model output with `dangerouslySetInnerHTML` in the dashboard. |

`npm run test:validator` runs twelve cases (one valid SVG and one for each failure mode) and prints
a pass/fail line per case.

> **Why `@xmldom/xmldom` and not `jsdom`?** `jsdom` pulls in `html-encoding-sniffer`, which
> `require()`s `@exodus/bytes` — a package that is ESM-only in every published version. That only
> works on Node ≥ 22.12 (where `require(esm)` is enabled) and breaks as soon as the bundler
> externalises the dependency, which is exactly what happens inside a Vercel serverless function.
> The app therefore ships with a parser that has **zero dependencies and is pure CommonJS**, so the
> validator behaves identically on a laptop and in production.

### 3.2 Retry and error handling (`src/lib/gemini.ts`)

Two **separate** retry budgets are used, because the brief describes them separately:

- **Validation retry (1):** if a check fails, the model is called again with the failure reason
  pasted back into the prompt ("your previous attempt was rejected by our validator because: …").
- **API retry (3):** if the API answers `429` (rate limit) or `503` (unavailable), the app waits
  `2s → 4s → 8s` (exponential backoff) and tries again, up to 3 times.

If the primary model is not available for the key (404 / 400), the app falls back through
`gemini-3.5-flash-lite → gemini-3.5-flash → gemini-2.5-flash-lite → gemini-2.5-flash` and logs
which one it settled on.

### 3.3 Cost and token logging

The Gemini response exposes `usageMetadata.promptTokenCount` and `usageMetadata.candidatesTokenCount`.
Those are stored on every result, together with the model name and the retry count, and the
estimated USD cost is computed with the published per-1M-token prices:

```
cost = inputTokens / 1e6 * 0.075 + outputTokens / 1e6 * 0.30
```

(Free-tier requests actually cost $0 — the number shown is the paid-tier price, which is the
useful figure for estimating the cost of a lesson-video pipeline.)

### 3.4 Where the review decision is stored — and why

**Approve / Reject and the note box are stored in the browser's `localStorage`**
(key: `science-diagram-maker:approvals`).

Why:

- The brief explicitly allows "database, a file on the server, or the browser".
- It needs **zero** infrastructure, so the app deploys to Vercel's free tier with no database,
  no migrations and no connection strings.
- The reviewer state is per-person: two reviewers grading the same page should not overwrite
  each other's notes.
- It survives a page refresh, which is the stated requirement.

The trade-off is that the decisions live in one browser and are not shared between devices. If a
shared review board is needed, the obvious next step is swapping the two `localStorage` calls in
`src/components/Dashboard.tsx` for a `POST /api/review` route backed by Postgres (Supabase/Neon).

### 3.5 How the page gets the 5 saved diagrams with no API call

`src/app/page.tsx` is a Server Component that statically imports `results.json`:

```ts
import savedResults from '../../results.json';
const initialResults = savedResults as GenerationResult[];
```

Next.js bundles that at build time and prerenders the page as static HTML, so the table (with all
5 animated diagrams, the check ticks, the cost and the retry count) is in the first response.
The "Generate" buttons then call the API routes for live results and update the table in place.

> On Vercel the file system is read-only at runtime, so `saveResults()` logs a warning instead of
> throwing when it cannot write `results.json`. The generated diagram is still returned to the
> browser. The committed `results.json` in the repository is the canonical saved set.

---

## 4. Results

The table below is generated from `results.json` after running `npm run generate`.

| # | Concept | Overall | Parsable | In viewBox | Title + 3 labels | Animated | No scripts | Model | Tokens (in/out) | Cost (USD) | Retries |
| :-- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :-- |
| 1 | Pythagoras' theorem | _see results.json_ | | | | | | | | | |
| 2 | Parts of a circle | _see results.json_ | | | | | | | | | |
| 3 | Series circuit | _see results.json_ | | | | | | | | | |
| 4 | Photosynthesis | _see results.json_ | | | | | | | | |
| 5 | States of matter | _see results.json_ | | | | | | | | | |

---

## 5. What failed, and how I fixed it

| Problem | Symptom | Fix |
| :--- | :--- | :--- |
| Gemini wraps the SVG in markdown | The validator saw ` ```svg ` and reported "not valid XML". | `cleanSvg()` in `src/lib/gemini.ts` strips a surrounding code fence and cuts anything before `<svg` / after `</svg>`. |
| Malformed XML was not thrown by `jsdom` | `new JSDOM(brokenXml, { contentType: 'image/svg+xml' })` resolves happily with a `<parsererror>` element, so the parse check silently passed. | The validator explicitly looks for `parsererror` and fails check 1 with the parser message. Caught by the `malformed XML` case in `npm run test:validator`. |
| `jsdom` could not be loaded inside the Vercel function | Every API route answered with an **empty 500**. The bundler externalised `html-encoding-sniffer`, which `require()`s the ESM-only `@exodus/bytes`, and the serverless runtime rejected it with `ERR_REQUIRE_ESM`. The page itself still rendered, because it is statically prerendered. | Replaced `jsdom` with `@xmldom/xmldom` (pure CommonJS, zero dependencies) behind a small `src/lib/svg-dom.ts` adapter. The API routes also import the generation modules lazily and return a JSON `{ error }` body, and `GET /api/health` reports the runtime version, whether each dependency loads, and whether the API key is configured. |
| The first "within viewBox" implementation was a stub | It only checked that a `viewBox` attribute existed, so it could never fail. | Replaced with a real geometric bounds check: per-element bounding boxes, path-data tokenising, and accumulated ancestor transforms. The `element outside viewBox` test now genuinely fails the check. |
| `localStorage` read during render | Reading it in the component body caused hydration mismatches. | The read moved into `useEffect`, behind a `hydrated` flag, so the server and first client render match. |
| The page initially fetched `/api/results` | The table was empty until the fetch resolved, which broke "the 5 saved results must already show". | `results.json` is now statically imported by the Server Component and prerendered into the HTML. The `/api/results` route was removed. |
| `next build` failed with `Cannot find name 'LayoutProps'` | Next.js 16 generates route types via `next typegen`. | Ran `npx next typegen` (the build runs it automatically) and fixed the metadata in `src/app/layout.tsx`. |
| `results.json` could not be written on Vercel | The runtime file system is read-only, which turned a successful generation into a 500. | `saveResults()` catches the error and logs a warning; the generated result is still returned. |

---

## 6. If I had one more day

1. **Real rendering-based validation.** The bounds check is a good approximation, but a true
   "is it on screen" check needs a real layout engine. Rendering each SVG in a headless Chromium
   via Playwright and comparing the rasterised bounds against the viewBox would catch cases that
   a static analysis cannot (text wrapping, `stroke-width` overflow, CSS transforms).
2. **Central review state.** Replace `localStorage` with a small Postgres table (Supabase) so
   several reviewers can work on the same board and the decisions are auditable.
3. **Prompt tuning with a golden set.** Run the prompt against a fixed set of concepts 20 times,
   measure the first-pass validation rate, and turn the prompt into something measurable rather
   than hand-tuned.
4. **Cost control.** Cache validated diagrams by a hash of (concept + prompt version) so a
   regeneration that produces the same diagram costs nothing, and add a per-day token budget.
5. **A11y and curriculum metadata.** Auto-generate `<desc>` content, verify colour contrast, and
   tag each diagram with the GCSE specification code so it can be searched by teacher.

---

## 7. AI tools used, and for what

| Tool | What I used it for |
| :--- | :--- |
| **Claude (Anthropic)** | Scaffolding the Next.js 16 project structure, writing the original `jsdom`-based SVG validator and the geometric bounds check, and reviewing the retry logic for edge cases. |
| **OpenAI Codex / ChatGPT** | Generating the Tailwind dashboard markup, the Gemini SDK calls (`generateContent`, `usageMetadata`), and debugging the `next typegen` / `LayoutProps` build error. |
| **GitHub Copilot** | Inline autocomplete for React components and TypeScript types while iterating on the dashboard. |
| **Gemini (the app itself)** | The AI that actually draws the five diagrams at runtime — that is the product, not the tooling. |

All code was written, reviewed and debugged by me; the AI tools were used as assistants, not as
autonomous authors, and every line in this repository is explained in the README above.

---

## 8. Project structure

```
science-diagram-maker/
├─ scripts/
│  ├─ generate-all.ts        # Part A entry point -> writes results.json
│  └─ test-validator.ts      # unit tests for the 5 validation checks
├─ src/
│  ├─ app/
│  │  ├─ api/
│  │  │  ├─ generate-all/route.ts   # POST -> regenerate all 5
│  │  │  └─ generate-one/route.ts   # POST -> regenerate one concept
│  │  ├─ globals.css
│  │  ├─ layout.tsx
│  │  └─ page.tsx            # Server Component: prerenders results.json
│  ├─ components/
│  │  └─ Dashboard.tsx       # Client Component: table, checks, approve/reject
│  └─ lib/
│     ├─ constants.ts        # the 5 concepts + the result/validation types
│     ├─ gemini.ts           # prompt, retries, fallback models, cost
│     ├─ generator.ts        # orchestrates Part A, writes results.json
│     └─ validator.ts        # the 5 checks
├─ .env.example
├─ results.json              # the 5 saved results
└─ README.md
```

---

## 9. Security notes

- The API key is **never** committed. It lives in `.env.local` locally and in the host's
  environment-variable settings in production. `.gitignore` excludes `.env*` (except
  `.env.example`, which only contains a placeholder).
- `results.json` contains generated SVG only — no key material.
- The dashboard renders model output with `dangerouslySetInnerHTML`. That is safe **because** the
  custom `noScripts` check rejects `<script>`, `<foreignObject>`, inline `on*` handlers and
  `javascript:` URLs before an SVG is ever accepted or stored.
