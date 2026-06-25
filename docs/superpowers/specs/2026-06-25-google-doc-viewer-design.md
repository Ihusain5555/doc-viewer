# Google Doc Viewer — v1 Design Spec

**Date:** 2026-06-25
**Status:** Approved (design); pending spec review before implementation

---

## Problem & who it's for

Ibraaheem and his friends need a single, simple place to keep links to Google
Docs and **view them live** (always showing the current content) inside one app.
Separately, they want to spin up an **in-app editable scratch copy** of a doc's
content — something to freely edit and Ctrl+C from — **without ever changing the
real Google Doc.**

Each person runs their own independent copy of the app. There is no shared
account system: a friend opens the same URL and adds *their own* doc links.
Ibraaheem will share his own docs with friends by giving them ordinary
"anyone with the link can view" links.

**Success looks like:** open the app, see your saved docs, click one, read it
live, and when you need to reuse its text, pull a formatted editable copy in one
click — original untouched.

---

## In scope for v1

1. **Add a doc** — paste a Google Doc share link; the app extracts the doc ID,
   auto-fills the doc's title (editable by the user), and saves it to the list.
2. **Doc list** — a sidebar of saved docs; click to open; remove a doc.
3. **Live view** — embeds the real doc (via Google's preview/embed URL); always
   shows the current content on load; a **Refresh** button re-pulls the latest.
4. **Editable copy** — one click pulls the doc's **formatted** content (bold,
   headings, lists) into an in-app rich editor the user can freely edit and
   Ctrl+C from. **Never writes back to the real Google Doc** (read-only, one-way
   pull). Edits are saved locally; **Reset copy** re-pulls the original.
5. **Local storage** — the doc list and the scratch edits live in the user's own
   browser (localStorage). No login, no server-side database.
6. **Shareable URL** — hosted on Vercel; Ibraaheem shares the link with friends;
   each friend adds their own docs.

---

## Explicitly OUT of v1 (the boundary)

- ❌ No Google sign-in / no private docs — docs must be set to
  "anyone with the link can view."
- ❌ No editing the *real* doc (the in-app copy is a one-way, read-only pull).
- ❌ No real-time auto-updating — the user refreshes to see the latest.
- ❌ No accounts, no syncing the list across devices, no shared lists between
  users.
- ❌ No phone-native app.
- ❌ No saving copies back to Google Drive.

---

## Definition of done

From the live URL, a fresh person can:

1. Paste a link-viewable Google Doc link → it is saved to their list.
2. Click it → the doc renders **live**.
3. Click **Edit copy** → the doc's formatted text appears in an editable pane;
   they can edit it and Ctrl+C from it.
4. Refresh the browser → their saved docs **and** their edits are still there.
5. **The original Google Doc is unchanged** throughout.

"Done" is this whole end-to-end flow working on the deployed URL — not just
"the buttons exist."

---

## Architecture

A lightweight front-end plus one tiny backend helper.

```
┌──────────────┐     paste link / click       ┌───────────────────────┐
│  Browser UI  │ ───────────────────────────▶ │  localStorage          │
│  (one page)  │   save list + scratch edits   │  (per-user, in browser)│
└──────┬───────┘                               └───────────────────────┘
       │
       │  Live view:  <iframe src=".../preview">  (direct, no backend)
       │
       │  Edit copy:  GET /api/doc?id=DOC_ID
       ▼
┌──────────────────────────┐   server-side fetch    ┌──────────────────┐
│  Backend helper (/api)   │ ─────────────────────▶ │  Google Docs      │
│  Vercel serverless fn    │   export?format=html   │  export endpoint  │
│  READ-ONLY proxy         │ ◀───────────────────── │  (link-viewable)  │
└──────────────────────────┘    formatted HTML       └──────────────────┘
```

- **Front-end:** one page handling the doc list, live view (iframe), and the
  editable copy (rich `contenteditable` editor).
- **Backend helper:** a single Vercel serverless function whose only job is to
  fetch a link-viewable doc's content server-side (browsers block this directly
  due to cross-origin rules) and return it to the page. It **only reads** — it
  never writes to any Google Doc. It also returns the doc title for auto-naming.
- **Storage:** localStorage only — the saved doc list and per-doc scratch edits.
  No accounts, no database.

**Recommended stack:** plain static front-end (HTML/CSS/JS) + one serverless
function under `/api`. Simplest and most legible. (Alternative considered:
Next.js/React — more standard and scalable, but more machinery than v1 needs.
Migrate later if the app grows accounts/sync.)

**Hosting:** Vercel free tier. Flow: push to GitHub → import into Vercel →
auto-deploy on push, stable shareable URL.

---

## Key risk (de-risk first)

The **editable copy** feature depends on Google serving a link-viewable doc's
content to an unauthenticated server request (the `export?format=html`
endpoint). This is expected to work for "anyone with the link can view" docs,
but it is the one thing not certain from memory.

**Mitigation:** the *very first* implementation step is a thin spike that fetches
one real link-viewable doc through the backend helper and confirms we get usable
formatted HTML — before building any UI around it. If Google requires an extra
"Publish to web" step per doc, we surface that immediately and adjust (small
change). The **live view** feature does not carry this risk.

---

## Guardrails (project integrity & safety)

- **Integrity line:** the app is strictly **read-only** toward real Google Docs.
  No feature may write to, modify, or delete a user's actual Doc or Drive. The
  "editable copy" is a local scratch buffer only. Docs are link-viewable public
  shares by the user's own choice; the app stores no credentials and requires no
  Google login.
- **Irreversible / confirm-first actions** (stop and get explicit yes each time):
  - First and subsequent **public deploys** to Vercel (outward-facing).
  - Creating/pushing to a **public GitHub repo** (outward-facing).
  - Any deletion of files/features once the project has real content.
- **Reversible (no stop needed):** installing dependencies, local builds, local
  git commits, editing project files.
- **"Done" per task:** each feature ships with explicit beginner-level test steps
  the user runs to verify it, checked against the Definition of Done above.

---

## Build order (smallest useful slice first)

1. **Backend spike** — `/api/doc` reads one real link-viewable doc, returns
   formatted HTML + title. (De-risks the one unknown.)
2. **Live view** — paste a link, save it, render the doc live in an iframe.
3. **Doc list + storage** — sidebar list, add/remove, persisted in localStorage.
4. **Editable copy** — pull formatted content into the editor; edit + Ctrl+C;
   persist edits; Reset copy.
5. **Polish + deploy** — layout cleanup, then GitHub → Vercel (with your OK).

Each step gets its own plan, your OK, the build, and test steps — one at a time.
