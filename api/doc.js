// /api/doc — read-only proxy for a link-viewable Google Doc.
//
// Why this exists: browsers block a page from fetching docs.google.com directly
// (cross-origin rules), so this tiny server-side function fetches the doc's
// exported HTML and hands it back to our own page.
//
// INTEGRITY LINE: this is STRICTLY READ-ONLY. It only performs GET requests to
// Google's public export endpoint. There is no code path here that can write to,
// modify, or delete any Google Doc or Drive file. It stores nothing and uses no
// credentials.

export const config = { maxDuration: 20 };

const DOC_ID_RE = /^[a-zA-Z0-9_-]+$/;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

// Recover the real document title from the Content-Disposition header.
// Prefer the RFC 5987 `filename*=UTF-8''...` form — it preserves spaces/punctuation.
function parseTitle(cd) {
  if (!cd) return 'Untitled document';
  const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) {
    try {
      const t = decodeURIComponent(star[1]).replace(/\.html?$/i, '').trim();
      if (t) return t;
    } catch {
      /* fall through to plain filename */
    }
  }
  const plain = cd.match(/filename="([^"]+)"/i);
  if (plain) {
    const t = plain[1].replace(/\.html?$/i, '').trim();
    if (t) return t;
  }
  return 'Untitled document';
}

// Defense-in-depth strip of active content. The real security boundary is the
// sandboxed, script-disabled iframe on the client; this removes obvious actives
// (scripts, framing tags, event handlers, javascript: URLs, meta refresh) so the
// doc HTML is inert even outside that sandbox. Google's export contains none of
// these in practice — this is belt-and-suspenders.
function sanitize(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?(?:iframe|object|embed|base|link)\b[^>]*>/gi, '')
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?\s*refresh[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1=$2#$2');
}

async function fetchExport(docId, signal) {
  const url =
    `https://docs.google.com/document/d/${encodeURIComponent(docId)}/export?format=html`;
  let res;
  // Retry ONCE on a 5xx (Google's export host occasionally returns a transient
  // error). 4xx is final — that means the doc isn't public, don't retry.
  for (let attempt = 0; attempt < 2; attempt++) {
    res = await fetch(url, {
      redirect: 'follow', // follows the 307 to the signed download URL
      headers: { 'user-agent': UA },
      signal,
    });
    if (res.status < 500) break;
  }
  return res;
}

export default {
  async fetch(request) {
    const params = new URL(request.url).searchParams;
    const id = (params.get('id') || '').trim();
    const metaOnly = params.get('meta') === '1';

    if (!id) {
      return json({ ok: false, error: 'MISSING_ID', message: 'No document id was provided.' }, 400);
    }
    if (!DOC_ID_RE.test(id)) {
      return json(
        { ok: false, error: 'INVALID_ID', message: "That doesn't look like a valid Google Doc link." },
        400,
      );
    }

    let res;
    try {
      res = await fetchExport(id, request.signal);
    } catch {
      return json(
        { ok: false, error: 'NETWORK', message: 'Could not reach Google. Check your connection and try again.' },
        502,
      );
    }

    if (res.status === 401 || res.status === 403 || res.status === 404) {
      return json(
        {
          ok: false,
          error: 'DOC_NOT_PUBLIC',
          message: 'This doc isn’t shared publicly. In Google Docs: Share → General access → “Anyone with the link” → Viewer.',
        },
        404,
      );
    }
    if (!res.ok) {
      return json(
        { ok: false, error: 'UPSTREAM', message: 'Google returned a temporary error. Try again in a moment.' },
        502,
      );
    }

    // Defense-in-depth: a successful response must have stayed on a Google host
    // (the export redirect only ever goes to *.googleusercontent.com).
    try {
      const host = new URL(res.url).hostname;
      const okHost =
        host === 'docs.google.com' ||
        host.endsWith('.googleusercontent.com') ||
        host.endsWith('.google.com');
      if (host && !okHost) {
        return json({ ok: false, error: 'UPSTREAM', message: 'Unexpected response location.' }, 502);
      }
    } catch {
      /* res.url unavailable on some runtimes — skip the check */
    }

    const title = parseTitle(res.headers.get('content-disposition'));

    if (metaOnly) {
      // We only needed the title — discard the (potentially large) body.
      try { await res.body?.cancel(); } catch { /* ignore */ }
      return json({ ok: true, title });
    }

    const raw = await res.text();

    // A private/missing doc can also come back as a 200 HTML error page — catch that.
    if (
      /<title>\s*Page Not Found\s*<\/title>/i.test(raw) ||
      /the file you have requested does not exist/i.test(raw)
    ) {
      return json(
        {
          ok: false,
          error: 'DOC_NOT_PUBLIC',
          message: 'This doc isn’t shared publicly. In Google Docs: Share → General access → “Anyone with the link” → Viewer.',
        },
        404,
      );
    }

    return json({ ok: true, title, html: sanitize(raw) });
  },
};
