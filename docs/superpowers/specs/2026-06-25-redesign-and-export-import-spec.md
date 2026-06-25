# Doc Viewer — Redesign + Export/Import Spec (handoff for fresh session)

**Date:** 2026-06-25
**Status:** v1 shipped & working; this spec covers the NEXT work (visual redesign +
export/import). Read this top-to-bottom to resume after a `/clear`.

> **RESUME PROMPT (paste after /clear):**
> "Continue the Doc Viewer work. Read
> `docs/superpowers/specs/2026-06-25-redesign-and-export-import-spec.md` and the
> v1 design spec next to it, then proceed with the redesign + export/import.
> Batch mode is on; build it and show me screenshots to confirm."

---

## 1. Where things stand (v1 — DONE, working, verified)

A working web app that lets you link Google Docs, view them live, and pull a
private editable copy. **All committed.** Last commit: `a73f443`.

- **Stack:** framework-free. Static `index.html` + `styles.css` + `app.js` at repo
  root; one serverless function `api/doc.js` (Vercel zero-config, Node 24, Web
  `export default { fetch }`); `dev-server.mjs` for local testing without the
  Vercel CLI; `package.json` (`type:module`, engines node 24).
- **Live view:** the app fetches the doc's exported HTML through `/api/doc` and
  renders it **itself** (read-only) in a sandboxed iframe. We do NOT embed
  Google's `/preview` viewer (browsers block that cross-site → blank). An
  "Open in Google Docs ↗" button opens the real doc in a new tab.
- **Editable copy:** same fetched HTML rendered in a `sandbox="allow-same-origin"`
  iframe with `designMode='on'`; edits saved to `localStorage` (`gdv:copy:<id>`);
  "Reset copy" re-pulls; "Select all" for Ctrl+C. Never writes to the real doc.
- **Doc list:** sidebar, add by pasting a link, rename (✎), remove (✕). Stored in
  `localStorage` (`gdv:docs`). No accounts, no DB.
- **Hosting:** not deployed yet. GitHub → Vercel is the pending OPTIONAL step
  (outward-facing — requires explicit user yes + their interactive GitHub login).

### Hard-won lessons — do NOT regress these
- **`[hidden]` must win.** `styles.css` has `[hidden]{display:none!important}`.
  Class rules like `.overlay{display:flex}` otherwise override the `hidden`
  attribute, which once left an empty error overlay covering the whole document
  (looked blank). Keep this reset; verify overlays actually hide.
- **localStorage can be blocked** (private windows / blocked storage). `saveDocs()`
  is wrapped so it never throws; the add flow renders before persisting and warns
  via `warnStorageBlocked()`. Keep this resilience.
- **Read-only integrity line holds** — `api/doc.js` only GETs Google's export
  endpoint. Never add a write/OAuth/credential path. Don't add `allow-scripts` to
  the doc iframes (the sandbox is the XSS boundary).
- **Verify visually with screenshots**, not just DOM values. Earlier DOM-only
  checks "passed" while an overlay hid everything. Use Playwright
  `browser_take_screenshot` + Read the image.

### Test assets
- Dev server: `node dev-server.mjs` → http://localhost:3000 (Node 24 installed).
- Public test docs (verified link-viewable):
  - `101MpeCidwLXGmTHL3TAW35XRa6kwXBdhSrUl7W2iI5I` = "AI prompts #2"
  - `1Ads4XsCjXmDrdGRgfmm_OgRdpFcl6Qhs6SOllNGyq7Y` = "Public data sources"
- Playwright MCP tools are available (load via ToolSearch "playwright browser").
  Headless renders OUR HTML fine (it's the doc render area); only Google's own
  embed rendered blank headless — and we no longer use that.

---

## 2. NEW WORK — what to build next

### 2A. Visual redesign — "super professional", modern, advanced (HUD-ish)

Goal: make the app look genuinely premium and modern (2026), with a sleek,
technical "command-center / HUD" feel that the owner (aerospace/engineering
student) likes — while keeping it clean and the **document reading area calm and
highly legible**.

**Research first (the user explicitly asked to research + learn from open-source
AI/professional projects).** Run a research pass (workflow) that studies CURRENT
2026 design and distills concrete, buildable guidance. Study the visual language
of these open-source / pro references and translate to vanilla CSS (we can't use
their React/Tailwind code — reimplement the look with CSS custom properties):
- **shadcn/ui** (the de-facto modern component look; study spacing, radii,
  borders, color tokens, component anatomy) and **tweakcn** (its theme editor —
  great for our token system).
- **Vercel Geist** design system + **v0** (AI-generated UI patterns).
- **Radix UI** primitives (states/accessibility), **Tailwind UI / Catalyst**.
- **Linear**, **Raycast** (precision + command-center feel), **Resend**,
  **Clerk**, **Vercel dashboard** (professional SaaS polish).
- Animated/modern component kits: **Aceternity UI**, **Magic UI**, **Origin UI**,
  **Tremor** (dashboards/HUD vibes).
Use Context7 and WebSearch to ground in current practice (e.g., is glassmorphism
in/out in 2026, current radii/shadow/elevation conventions, motion timing).

**Requirements:**
- **Theming, tunable live:** light + dark themes via CSS custom properties; an
  **accent color** control; persist choice in `localStorage`. Default can be a
  refined dark "command center" (deliver the HUD wow) OR polished light — provide
  both and let the user flip. (User wants to be able to dial the look without
  rework — theme toggle + accent satisfy this; a small settings control is fine.)
- A real **design-token system** (colors light+dark, spacing scale, type scale +
  tasteful font like Inter/Geist, radii, layered shadows, motion durations/easings).
- Polished **components**: sidebar, list rows (hover/selected/active), buttons
  (primary/ghost/icon), the Live/Edit **segmented toggle** (sliding active
  indicator), top bar, inputs, status badges (e.g. "Saved"), and a great **empty
  state**.
- **Micro-interactions & motion:** smooth hover/press, focus-visible rings,
  mode-switch transition, a tasteful loading state, subtle entrance for the doc.
  Respect `prefers-reduced-motion`. Keep it snappy.
- **HUD texture, tastefully:** dark surfaces, hairline borders, faint dot/grid
  background, subtle accent line/glow, monospace for metadata/IDs, status dots —
  but the **doc render pane stays clean/white/legible** (don't HUD-ify the reading
  surface).
- **Responsive** (sidebar collapses on narrow screens — already partially there).

**Constraints:** pure CSS, no framework, no build step. Don't break any working
functionality (live view, editable copy, storage, add/rename/remove, the
`[hidden]` fix, read-only integrity). The doc iframes stay
`sandbox="allow-same-origin"`.

**Definition of done (redesign):** the app looks clearly premium/modern in a
screenshot; light + dark + accent all work and persist; every existing feature
still works (verified by screenshots in BOTH themes for live view AND editable
copy); reduced-motion respected; nothing regresses the v1 lessons above.

### 2B. Export / Import all documents at once

Let a user move/share their whole set of linked docs.

- **Export:** a button that downloads a `.json` file containing the doc list
  (`{ app:"doc-viewer", version:1, exportedAt, docs:[{id,title,addedAt}] }`).
  Use a Blob + temporary anchor download. Filename like
  `doc-viewer-docs-YYYY-MM-DD.json` (stamp the date in JS at click time).
- **Import:** a button → hidden `<input type="file" accept="application/json">`.
  Read the file, `JSON.parse` safely, validate shape, then **MERGE** into the
  current list (add docs whose `id` isn't already present; never delete). After
  import, refresh titles for new docs via the existing `&meta=1` path (optional).
  Report a small result ("Added 4, skipped 2 already in your list"). On a bad file
  show a friendly error. Wrap all storage writes (storage may be blocked).
- **Scope:** the doc LIST only (links + titles). Editable-copy edits are personal
  per-browser scratch and are NOT exported. (Primary use case: the owner hands
  friends a file that loads all his shared docs at once.)
- **Definition of done:** export downloads a valid JSON of the list; importing it
  in a fresh browser recreates the list (merge, no dupes, no data loss); bad file
  → friendly error; verified in-browser.

---

## 3. Suggested execution order (fresh session)

1. Re-run the **design research workflow** (3 parallel agents: modern UI system +
   tokens; HUD/command-center; motion/micro-interactions) — NOW including "study
   open-source AI/pro projects" (shadcn/ui, Geist/v0, Radix, Linear, Raycast,
   Aceternity/Magic UI, tweakcn). The earlier run (task `w2wiyuasc`) was STOPPED
   before finishing because this open-source scope was added — re-run it. The
   script is at:
   `…/workflows/scripts/docviewer-ui-research-wf_e370d458-7fd.js` (extend it with
   the open-source-study angle, or write a new one).
2. Synthesize a token system + visual direction. (Optionally show the user 2–3
   directions or just build the recommended one with a theme toggle and let them
   react — user is in batch/confirm-at-end mode.)
3. Implement: rewrite `styles.css` (tokens + components + motion + light/dark +
   accent), update `index.html` (theme/settings control, export/import buttons,
   any structure tweaks), update `app.js` (theme persistence + accent, export/import
   logic). Keep all existing IDs/behavior working.
4. Add export/import (2B).
5. **Verify with Playwright screenshots**: live view + editable copy, light + dark,
   add/rename/remove, export downloads, import merges. Read the screenshots to
   confirm it looks premium and nothing is covered/broken.
6. Show the user screenshots; iterate on their reaction. Then (optional, gated)
   the GitHub → Vercel deploy.

## 4. File map
- `index.html` — structure (sidebar #addForm/#docList, top bar #docTitle,
  #viewer with #modes toggle, #liveFrame, #editFrame, overlays #loading/#viewerError,
  action buttons #refreshBtn/#openExtBtn/#selectAllBtn/#resetBtn, #saveState).
- `styles.css` — all styling (has the `[hidden]` reset at top).
- `app.js` — all logic (storage, list, live render `showLive/renderReadOnly`,
  editable `pullCopy/loadEditFrame/saveCopy`, `setMode`, add/remove/rename,
  `warnStorageBlocked`). Add theme + export/import here.
- `api/doc.js` — read-only export proxy (don't change behavior).
- `dev-server.mjs` — local test server. `CLAUDE.md` — project guardrails.
- `docs/superpowers/specs/2026-06-25-google-doc-viewer-design.md` — v1 spec.
