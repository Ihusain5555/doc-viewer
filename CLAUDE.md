# Project guardrails — Doc Viewer

A small web app to keep a list of Google Doc links, view them **live**, and pull a
private **editable copy** of a doc's content. Hosted on Vercel. No accounts, no
database — each person's list lives in their own browser.

Full design: `docs/superpowers/specs/2026-06-25-google-doc-viewer-design.md`.

## Integrity line (what this project will and won't do)

- **Read-only toward real Google Docs.** No feature may write to, modify, rename,
  or delete a user's actual Google Doc or Drive file. The "editable copy" is a
  local scratch buffer in the browser only.
- **No credentials, no OAuth, no Google login.** Only docs the user themselves
  set to "Anyone with the link → Viewer" are used. The backend (`/api/doc`) makes
  unauthenticated, read-only GET requests to Google's public export endpoint.
- **No third-party data sharing.** Doc content flows Google → our function →
  the user's browser. It is not stored server-side or sent anywhere else.
- **Stores nothing server-side.** The doc list and editable copies live in the
  user's `localStorage`.

## Confirm-first / irreversible actions (stop and get explicit yes each time)

- **Deploying publicly to Vercel** (preview or production) — outward-facing.
- **Creating or pushing to a public GitHub repo** — outward-facing.
- **Deleting files/features** once the project has real content.

Reversible (no stop needed): editing project files, local `git` commits,
running the local dev server, installing dev dependencies.

## "Done" definition (acceptance check)

From the running app, a fresh person can:
1. Paste a link-viewable Google Doc link → it is saved to their list.
2. Click it → the doc renders **live**.
3. Switch to **Editable copy** → the formatted text appears editable; they can
   edit it and Ctrl+C from it.
4. Refresh the browser → their saved docs **and** edits are still there.
5. The original Google Doc is **unchanged** throughout.

## Stack notes

- **No framework.** Static `index.html` / `styles.css` / `app.js` at repo root.
- **One serverless function:** `api/doc.js`, Web-standard `export default { fetch }`,
  global `fetch`, Node 24 (pinned in `package.json`). Zero-config on Vercel — no
  `vercel.json`.
- **Live view + editable copy both render the export HTML ourselves** in a
  sandboxed iframe (`sandbox="allow-same-origin"`, scripts disabled) so doc HTML
  can't run code and Google's CSS can't leak into the app UI. Live view is
  read-only and re-fetched fresh; the editable copy uses `designMode` + is saved
  to localStorage. We do NOT embed Google's `/preview` viewer — browsers block
  that cross-site embed (third-party cookies) and it renders blank; an "Open in
  Google Docs" button covers the full Google viewer.
- **Local testing without Vercel:** `node dev-server.mjs` serves the static files
  and routes `/api/doc` through the real handler.
- **Installable app (PWA):** `manifest.webmanifest` + `sw.js` + `icon-*.png` make it
  installable as a one-click desktop app. The service worker is **network-first for
  the shell** (so updates are never stuck behind a stale cache) and **MUST NEVER cache
  `/api/`** (live doc data stays fresh and unstored — part of the integrity line). Bump
  the `CACHE` name in `sw.js` when the shell file list changes.
