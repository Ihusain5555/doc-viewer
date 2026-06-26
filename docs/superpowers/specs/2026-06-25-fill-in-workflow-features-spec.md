# Doc Viewer — Fill-in Workflow Features Spec (handoff for fresh session)

**Date:** 2026-06-25
**Status:** v1 + visual redesign + (links-only) export/import are DONE & verified. This
spec covers the NEXT work: 4 features that fix the *fill-in → use* workflow. User has
**approved building all 4, one at a time, in the order below.** Batch mode is on; still
run the per-feature Plan → OK → Build → Test cycle and STOP for the irreversible items.

> **RESUME PROMPT (paste after /clear):**
> "Continue the Doc Viewer work. Read
> `docs/superpowers/specs/2026-06-25-fill-in-workflow-features-spec.md` (and the v1 +
> redesign specs beside it), then build the 4 approved fill-in features in order,
> one feature at a time with test steps and screenshots. Batch mode is on."

---

## 0. Why these 4 (research provenance)

A 10-persona simulation (ages 15–25, mixed devices/doc types, 3-month usage diaries +
synthesis + anti-bloat/integrity critic) found the app nails the first 20% (receive →
view → start typing) but **abandons users at the two moments that define this workflow:
keeping the work and getting it out.** All 10 personas demoted it to "a front porch, not
the house" and moved real work back to Google Docs/Notes. Three severity-5 gaps (each
10/10 personas): (1) one-template = one-copy is the wrong SHAPE for reuse-many docs
(per job, per school, per week, per day, per character); (2) fills live in one browser
and silently vanish on clear/device-switch; (3) no real exit — copy-paste mangles
formatting. These 4 features are the rule-compliant fixes. Everything the critic put in
"do not build" (accounts/sync, save-to-Drive, cloud backup, sync codes) is **out** —
it crosses the integrity line; the backup FILE is the lean, accountless answer to "sync."

---

## 1. Integrity line — unchanged, enforce it

- **No accounts, no database, no OAuth, no Google login.** localStorage only.
- **Read-only toward the friend's real Google Doc.** Copies are local scratch buffers.
- **Nothing server-side.** `api/doc.js` keeps only its read-only export GET. Do NOT add
  a write path, Drive integration, or any backend relay.
- The backup/restore FILE (Feature 3) is the ONLY cross-device story. No sync infra.

## 2. Stack / file map (current reality)

- Framework-free static site: `index.html` + `styles.css` + `app.js`; one serverless
  fn `api/doc.js`; `dev-server.mjs` for local; `package.json` (type:module, node 24).
- **localStorage keys today:**
  - `gdv:docs` → `[{ id, title, addedAt }]` (the template/link list).
  - `gdv:copy:<docId>` → full HTML string of THE single editable copy for that doc.
  - `gdv:theme` (`light|dark`), `gdv:accent` (hex or absent).
- **Editable copy** = the doc's exported HTML rendered in a `sandbox="allow-same-origin"`
  iframe with `designMode='on'`; autosaved (debounced) to `gdv:copy:<docId>`.
- Key `app.js` symbols: `loadDocs/saveDocs`, `renderList`, `openDoc`, `setMode`,
  `showLive/renderReadOnly`, `showEdit/pullCopy/loadEditFrame/saveCopy/resetCopy`,
  `exportDocs/importFromText`, theme/accent module, `extractDocId`.

## 3. Hard-won lessons — do NOT regress

- Keep `[hidden]{display:none!important}` reset; verify overlays actually hide.
- `saveDocs()` and every storage write is wrapped so a blocked/full localStorage never
  throws; the app works in-memory and warns via `warnStorageBlocked()`. Keep this.
- Doc iframes stay `sandbox="allow-same-origin"` (NO `allow-scripts`) — the sandbox is
  the XSS boundary.
- The HUD dot-grid/fade on `.main` must be a `::before` LAYER behind content — never a
  `mask-image` on `.main` itself (it fades the doc card). (Learned the hard way.)
- **Verify visually with Playwright screenshots** (live + edit, light + dark), not just
  DOM values. Read the images.

## 4. Test assets

- Dev server: `node dev-server.mjs` → http://localhost:3000 (Node 24 installed). NOTE: a
  server may already be running on :3000 from a prior session (EADDRINUSE just means
  it's already up — the app still works).
- Public test docs (verified link-viewable):
  - `101MpeCidwLXGmTHL3TAW35XRa6kwXBdhSrUl7W2iI5I` = "AI prompts #2"
  - `1Ads4XsCjXmDrdGRgfmm_OgRdpFcl6Qhs6SOllNGyq7Y` = "Public data sources"
- To seed for screenshots, set `gdv:docs` via Playwright `browser_evaluate`, then reload.
- Screenshots land in repo root by default — DELETE them after (they'd otherwise ship);
  `.playwright-mcp/` is already gitignored.

---

## 5. THE 4 FEATURES (build in this order, one at a time)

### Feature 1 — Multiple named copies per template  *(the #1 fix; do FIRST — it's the data-model change)*

**Goal:** one template (a saved Google Doc link) can spawn MANY independent, persistent,
named fills. "Make a copy" never destroys a previous fill. This is the structural fix.

**New data model (propose to user, then migrate — see STOP below):**
- Keep `gdv:docs` = the TEMPLATE list (unchanged shape).
- New `gdv:copies` = metadata array (kept light so list render never loads HTML):
  `[{ copyId, docId, name, createdAt, updatedAt }]`.
- New `gdv:copybody:<copyId>` = the full HTML of that copy (heavy; one key per copy).
- `copyId` = a local unique id (e.g. `c_` + timestamp + short counter; remember
  `Date.now()` is fine in the browser — only the Workflow sandbox forbids it).

**Migration (NON-destructive; STOP and confirm before running):** on load, for any
existing `gdv:copy:<docId>`, create one copy `{ copyId, docId, name: <doc title or
"My fill">, ... }`, move its HTML to `gdv:copybody:<copyId>`, leave the OLD key in place
(don't delete — reversible), and set a flag `gdv:copies:migrated = 2`. Idempotent.

**UI / flow (leanest version):**
- Sidebar lists templates; each template's copies appear indented beneath it with a
  small "last edited" subline. (One level deep — NO folders.)
- Selecting a TEMPLATE → Live view (read-only), as today. The editable side shows a
  small empty-state: "＋ New fill" (and, if copies exist, they're listed/clickable).
- "＋ New fill" / "Make a copy" → snapshot the template's current exported HTML into a
  new copy, auto-name ("Copy 1", or prompt), select it, open it in Edit.
- Selecting a COPY → opens it in Edit (its saved body). Live toggle shows its source
  template. Copies are renamable (✎) and removable (✕) like docs.
- "Reset copy" → re-pull fresh template HTML into THIS copy only (loud destructive
  confirm — see Feature 4).
- `setMode` / `selectedId` state must now track BOTH the selected doc and the active
  copyId. Plan this refactor explicitly in the per-feature Plan.

**Open design decision (resolve with a quick mockup at build time — user reacts well to
mockups):** exact "Editable copy" toggle semantics when a template (vs a copy) is
selected. Default proposal above; confirm before coding.

**STOP / confirm-first:** the localStorage SCHEMA CHANGE + MIGRATION touches stored user
data — name it, confirm it's non-destructive (keeps old keys), get explicit yes.

**Acceptance:** from a fresh app, a user can make 3 named copies from one template, fill
each differently, switch between them, refresh, and all 3 persist independently; Reset
affects only the active copy; the original Google Doc is untouched. Verify by screenshot.

---

### Feature 2 — Real file export: Download as Word + Print/PDF  *(the exit)*

**Goal:** get a finished fill OUT as a real, well-formatted file. No more copy-paste-
mangles-formatting. Client-side only; zero new backend; **prefer ZERO new dependencies.**

**Leanest version:**
- **Print / Save as PDF:** call `editFrame.contentWindow.print()` — prints just the copy
  iframe's content; the OS print dialog covers paper AND "Save as PDF" everywhere. Near
  zero effort. Add a "Print / PDF" toolbar button in Edit mode.
- **Download as Word (.doc):** build a Word-compatible HTML blob from the copy's HTML —
  NO library needed:
  ```js
  const header = "<html xmlns:o='urn:schemas-microsoft-com:office:office' " +
    "xmlns:w='urn:schemas-microsoft-com:office:word' " +
    "xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'></head><body>";
  const blob = new Blob(['﻿', header, copyHtmlBody, "</body></html>"],
    { type: 'application/msword' });
  // download as `<copy name>.doc`
  ```
  Opens in Word / Google Docs ("File → Open") with formatting intact. It's `.doc`
  (Word-HTML), not true `.docx`, but needs no build step and works on locked-down
  devices (no CDN). **Do NOT add a CDN JS lib** (school networks block them; breaks the
  "no dependencies" feel). True `.docx` via a library is maybe-later only if `.doc`
  compatibility disappoints in testing.

**Integrity:** reads the copy's HTML already in memory; read-only toward the real doc.

**Acceptance:** a filled copy downloads as a `.doc` that opens in Word/Docs with its
headings/lists/spacing; Print opens a clean print of the copy (and Save-as-PDF works).
Verify by actually downloading and opening the file.

---

### Feature 3 — Fills-inclusive Backup / Restore  *(rule-compliant "sync"; depends on F1)*

**Goal:** make the work (not just links) portable & recoverable WITHOUT accounts. The
current "Export" is dishonest (links only) — 6 personas felt betrayed losing weeks of
work. The backup FILE is the accountless answer to "sync."

**Leanest version:**
- Bump the export payload to **version 2**, additive:
  ```json
  { "app":"doc-viewer", "version":2, "exportedAt":"…",
    "docs":[{ "id","title","addedAt" }],
    "copies":[{ "copyId","docId","name","createdAt","updatedAt","html" }] }
  ```
- Import must accept **v1 (links only) AND v2** (back-compatible). On v2, MERGE docs (as
  today) AND copies: add copies whose `copyId` isn't present; never delete. If a copyId
  collides, keep both (new copyId) or skip — decide & state. Report "Added X fills…".
- Rename the UI "Export" → **"Back up"**, "Import" → **"Restore"** (with a one-line
  "saves your fills too" hint). Filename `doc-viewer-backup-YYYY-MM-DD.json`.
- Wrap all storage writes (storage may be blocked). The file can be large (HTML bodies)
  — that's fine for a download; warn only if a restore write fails.

**Bonus (no extra work):** this file is ALSO the distribution mechanism the owner's
original use case wanted — the template-maker can hand newcomers one file that loads the
whole template set (and starter fills) at once.

**Acceptance:** Back up downloads a JSON containing links + fills; Restoring it in a
fresh/incognito browser recreates the templates AND the filled copies (merge, no dupes,
no loss); a v1 (links-only) file still imports fine. Verify in-browser (two browser
profiles or clear-then-restore).

---

### Feature 4 — Honest labels + destructive-action safety  *(cheap; do anytime, fold in here)*

**Goal:** stop silent catastrophic loss; tell the truth about where work lives.

**Leanest version:**
- "Saved" badge → honest scope, e.g. **"SAVED · THIS DEVICE"** (mono badge already
  exists). Keep it calm, not alarming.
- One quiet line near the editor or sidebar: "Your fills live only in this browser — use
  **Back up** to keep them safe." (Link/scroll to the Back up button.)
- **Reset copy** and **Remove**: clearly-destructive confirm copy ("This permanently
  deletes this fill's edits — your real Google Doc is not affected"), and make Reset
  visually quiet + separated from the writing area (match button weight to risk).
- Surface the silent **"Too big to save"** state loudly (a visible warn badge already
  exists — make sure it's noticeable; long docs hit the localStorage ceiling).

**Acceptance:** the badge no longer implies cloud safety; Reset/Remove require an
explicit, clearly-worded confirm; a save failure is visibly surfaced, not silent.

---

## 6. Look / feel changes (apply alongside, from the research)

- Give the editable copy a **real "document" feel**: centered page, margins, comfortable
  body type, generous line spacing (personas trusted Google Docs partly because the
  editor felt like a doc, not a raw web page). Keep the reading-card "token island" rule.
- **Mobile:** make the Live ↔ Editable toggle big/obvious (it hides in the collapsed top
  bar — half the group asked "where do I type?"); tune tap targets/contrast for thumbs.
- A clear **visual line between read-only original and your private copy** (distinct
  accent or a slim "Your private copy — saved here" banner).
- Show each copy's **source template + "last edited"** subline so a stack stays scannable
  (kills the fake-folder name-prefix habit).

## 7. Explicitly OUT (do not build — over-features or crosses integrity line)

Account/sign-in sync · save-to-Google-Drive (OAuth) · cloud backup · "sync code" via any
relay · list thumbnails · more theme skins · QR/link set-sharing · engineering around
school network blocks. (The Back up FILE + Download-as-file already cover the real needs.)

## 8. Maybe-later (only after the core loop works end-to-end)

Search + sort + one level of folders/tags (clutter gets real once multi-copy multiplies
the list) · better structured-content editing (stable table cursor, real borders,
tappable checkboxes, non-collapsing bullets) · large-doc storage (chunk/compress; ship
the LOUD save-fail warning early though) · "copy as formatted" fallback for paste-only
portals · dated auto-instances for daily/weekly trackers · non-destructive template-update
(pull new structure without losing fills).

## 9. Suggested execution order (per-feature: Plan → OK → Build → Test steps → confirm)

1. **Feature 1** (data model + migration — STOP/confirm the migration). Everything builds
   on the new copies model, so it's first.
2. **Feature 2** (file export — independent, low risk).
3. **Feature 3** (backup/restore — needs the copies model from F1).
4. **Feature 4** (honest labels + confirms — trivial; can also be folded in earlier).
   Then the look/feel pass (§6). Optional, gated, last: GitHub → Vercel deploy.

Test each with Playwright screenshots in BOTH themes, live + edit, and actually exercise
downloads/restores. Nothing is committed for this work yet; local git commits are fine,
but pushing to GitHub / deploying to Vercel stays user-gated.
