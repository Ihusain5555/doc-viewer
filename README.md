# 📄 Doc Viewer

Keep your Google Doc links in one place, **read them live**, and make private
**fills** — editable copies you can type into, keep, and download — without ever
changing the real Google Doc.

- **No sign-in, no accounts, no database.** Your docs and fills are saved in **your
  own browser**.
- **Many fills per doc.** Reuse one doc as a template and make as many independent,
  named, saved fills as you want.
- **Take your work out.** Download any fill as a **Word (.doc)** file or **Print / PDF**.
- **Back up & restore.** One file saves your docs *and* your fills — move them to
  another computer or hand the whole set to a friend.
- **Read-only toward your real Docs.** Nothing here can edit, rename, or delete your
  actual Google Doc or Drive files.

---

## Install it as an app (one click)

Doc Viewer is a **PWA** — a website that installs like a desktop app.

1. Open the app link in **Chrome** or **Edge** (on desktop or Android).
2. Click the **Install** icon in the address bar (a little monitor/⊕), or open the
   **⋮ menu → Install Doc Viewer**.
3. It gets its own **desktop / Start-menu icon** and opens in its own window — no
   browser tabs, no address bar. Click once to open it any time.

> On iPhone/iPad (Safari): **Share → Add to Home Screen.**

Uninstalling is just "Uninstall" from the app's menu — it leaves nothing behind.

---

## Make a doc work with this app

A doc must be shared publicly by its owner:

1. Open the doc in Google Docs.
2. **Share → General access → “Anyone with the link”**, role **Viewer**.
3. Copy the link, paste it into Doc Viewer, and click **Add**.

Private (restricted) docs won't load — the app will tell you so.

---

## Run it on your own computer

You need [Node.js](https://nodejs.org) installed. Then, in this folder:

```bash
node dev-server.mjs
```

Open **http://localhost:3000**. This runs the full app — live view, fills, export,
and backup — locally. (The app needs this little server because browsers block a web
page from fetching `docs.google.com` directly, so a tiny backend fetches it instead.)

---

## Host your own copy (free, on Vercel)

1. Push this folder to a GitHub repository.
2. At [vercel.com](https://vercel.com) → **Add New → Project** → import the repo.
3. Framework preset: **Other** (no build settings needed). Click **Deploy**.
4. Vercel gives you a URL like `your-app.vercel.app`. Open it and **Install** (above).

Every push to GitHub re-deploys automatically. No `vercel.json` or build config
needed.

---

## How it works (plain version)

- **Live view** fetches your doc through a tiny backend (`/api/doc`) and renders it
  read-only inside the app. **Open in Google Docs** opens the full Google viewer in a
  new tab.
- **Fills** use the same backend to grab the doc's formatted content, then drop it
  into a sandboxed, editable box in your browser. Each fill is yours alone; editing
  one never touches the real Google Doc, and you can keep many per doc.
- **Offline:** once installed, the app *shell* opens without internet (you still need
  a connection to load or refresh a Google Doc). Your live doc data is never cached.

The app is **strictly read-only** toward your real Docs, uses **no accounts or
Google login**, and stores **nothing on a server** — see `CLAUDE.md` for the full
integrity rules.
