# 📄 Doc Viewer

A simple web app to keep your Google Docs in one place: **view them live** and pull
a **private editable copy** of any doc's content to tinker with and copy from —
without ever changing the real Google Doc.

- No sign-in, no accounts.
- Your list of docs is saved in **your own browser**.
- Share the app with friends — they just open the same link and add **their own** docs.

---

## Make a doc work with this app

A doc must be shared publicly by its owner:

1. Open the doc in Google Docs.
2. **Share → General access → “Anyone with the link”**, role **Viewer**.
3. Copy the link. Paste it into Doc Viewer and click **Add**.

Docs that are private (restricted) won't load — the app will tell you so.

---

## Run it on your computer (for testing)

You need [Node.js](https://nodejs.org) installed. Then, in this folder:

```bash
node dev-server.mjs
```

Open **http://localhost:3000**. This runs the full app — live view *and* editable
copy — locally.

> Just opening `index.html` directly also works for the **live view**, but the
> **editable copy** needs the little server above (browsers block fetching Google
> directly).

---

## Put it online (so friends can use it)

Hosted free on **Vercel**, connected to **GitHub** for auto-deploys:

1. Push this folder to a GitHub repository.
2. At [vercel.com](https://vercel.com) → **Add New → Project** → import the repo.
3. Framework preset: **Other** (no build settings needed). Click **Deploy**.
4. Vercel gives you a URL like `your-app.vercel.app` — share that with friends.

Every push to GitHub re-deploys automatically. No `vercel.json` or build config
is required.

---

## How it works (plain version)

- **Live view** embeds the real Google Doc using its `/preview` URL — always the
  current content.
- **Editable copy** asks a tiny backend (`/api/doc`) to fetch the doc's formatted
  content, then drops it into a sandboxed, editable box in your browser. That copy
  is yours alone; editing it never touches the real Google Doc.

The app is **strictly read-only** toward your real Docs — see `CLAUDE.md` for the
full integrity rules.
