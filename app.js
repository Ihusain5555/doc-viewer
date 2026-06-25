/* Doc Viewer — client logic.
 *
 * What it does:
 *  - Keeps a list of Google Doc links in this browser (localStorage).
 *  - "Live view": embeds the real doc via Google's /preview URL (always current).
 *  - "Editable copy": pulls the doc's formatted HTML (via /api/doc) into a
 *    sandboxed, editable iframe you can change and Ctrl+C from. The real Google
 *    Doc is never written to — this copy lives only in your browser.
 */

const API = '/api/doc';
const docEditUrl = (id) => `https://docs.google.com/document/d/${id}/edit`;

const LS_DOCS = 'gdv:docs';
const lsCopyKey = (id) => `gdv:copy:${id}`;

// ---------- storage ----------
function loadDocs() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_DOCS));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function saveDocs() {
  // Never let a blocked/full localStorage throw and abort the caller — the app
  // must keep working in-memory even when the browser won't persist.
  try {
    localStorage.setItem(LS_DOCS, JSON.stringify(docs));
    return true;
  } catch {
    return false;
  }
}

let storageWarned = false;
function warnStorageBlocked() {
  if (storageWarned) return;
  storageWarned = true;
  setAddError(
    'Heads up: your browser is blocking site storage, so this list won’t be remembered after you close the tab. ' +
    'This usually means a private/incognito window, or that you opened the file directly instead of through http://localhost:3000.'
  );
}

// ---------- state ----------
let docs = loadDocs();
let selectedId = null;
let mode = 'live'; // 'live' | 'edit'
let saveTimer = null;
let liveLoadedId = null; // which doc's live view is currently rendered

// ---------- dom ----------
const $ = (id) => document.getElementById(id);
const addForm = $('addForm');
const addInput = $('addInput');
const addError = $('addError');
const docList = $('docList');
const emptyHint = $('emptyHint');
const docTitle = $('docTitle');
const welcome = $('welcome');
const viewer = $('viewer');
const modes = $('modes');
const refreshBtn = $('refreshBtn');
const openExtBtn = $('openExtBtn');
const selectAllBtn = $('selectAllBtn');
const resetBtn = $('resetBtn');
const saveState = $('saveState');
const liveFrame = $('liveFrame');
const editFrame = $('editFrame');
const loading = $('loading');
const viewerError = $('viewerError');
const editHint = $('editHint');

// ---------- helpers ----------
function extractDocId(input) {
  if (!input) return null;
  const s = input.trim();
  let m = s.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s; // a bare id pasted on its own
  return null;
}

function findDoc(id) {
  return docs.find((d) => d.id === id) || null;
}

function setAddError(msg) {
  if (!msg) {
    addError.hidden = true;
    addError.textContent = '';
  } else {
    addError.hidden = false;
    addError.textContent = msg;
  }
}

function setSaveState(text, kind) {
  saveState.hidden = mode !== 'edit';
  saveState.textContent = text || '';
  saveState.className = 'savestate' + (kind ? ' ' + kind : '');
}

// ---------- rendering ----------
function renderList() {
  docList.innerHTML = '';
  emptyHint.hidden = docs.length > 0;

  for (const d of docs) {
    const li = document.createElement('li');
    li.className = 'doc-item' + (d.id === selectedId ? ' selected' : '');
    li.title = d.title;

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = d.title || 'Untitled document';
    name.addEventListener('click', () => openDoc(d.id));

    const renameBtn = document.createElement('button');
    renameBtn.className = 'row-btn';
    renameBtn.textContent = '✎';
    renameBtn.title = 'Rename';
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      renameDoc(d.id);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'row-btn del';
    delBtn.textContent = '✕';
    delBtn.title = 'Remove from list';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeDoc(d.id);
    });

    li.append(name, renameBtn, delBtn);
    docList.appendChild(li);
  }
}

function updateDocTitle() {
  const d = findDoc(selectedId);
  docTitle.textContent = d ? d.title : '';
}

function showLoading(on) {
  loading.hidden = !on;
}
function showViewerError(msg) {
  viewerError.hidden = !msg;
  viewerError.textContent = msg || '';
}

// ---------- doc actions ----------
async function addDoc(e) {
  e.preventDefault();
  setAddError('');

  const id = extractDocId(addInput.value);
  if (!id) {
    setAddError("That doesn't look like a Google Doc link. Copy the full URL from your browser's address bar.");
    return;
  }
  if (findDoc(id)) {
    addInput.value = '';
    openDoc(id);
    return;
  }

  // Add immediately with a placeholder, then fill in the real title.
  const doc = { id, title: 'Loading…', addedAt: Date.now() };
  docs.push(doc);
  addInput.value = '';
  openDoc(id); // render + open FIRST — never gated on whether storage works
  if (!saveDocs()) warnStorageBlocked();

  try {
    const r = await fetch(`${API}?id=${encodeURIComponent(id)}&meta=1`);
    const data = await r.json();
    if (data.ok) {
      doc.title = data.title || 'Untitled document';
    } else {
      doc.title = 'Untitled document';
      if (data.error === 'DOC_NOT_PUBLIC') {
        setAddError('Added — but this doc isn’t shared publicly yet, so it won’t load. Set it to “Anyone with the link → Viewer.”');
      } else {
        setAddError('Added — couldn’t auto-name it just now. Click the ✎ to rename it.');
      }
    }
  } catch {
    doc.title = 'Untitled document';
    setAddError('Added — couldn’t auto-name it just now. Click the ✎ to rename it.');
  }
  saveDocs();
  renderList();
  updateDocTitle();
}

function removeDoc(id) {
  const d = findDoc(id);
  if (!d) return;
  if (!confirm(`Remove “${d.title}” from your list?\n\nThis only removes it here — your real Google Doc is not affected.`)) return;

  docs = docs.filter((x) => x.id !== id);
  saveDocs();
  try { localStorage.removeItem(lsCopyKey(id)); } catch {}

  if (selectedId === id) {
    selectedId = null;
    viewer.hidden = true;
    welcome.hidden = false;
    docTitle.textContent = '';
  }
  renderList();
}

function renameDoc(id) {
  const d = findDoc(id);
  if (!d) return;
  const next = prompt('Rename this doc:', d.title);
  if (next == null) return;
  d.title = next.trim() || d.title;
  saveDocs();
  renderList();
  if (selectedId === id) updateDocTitle();
}

function openDoc(id) {
  selectedId = id;
  welcome.hidden = true;
  viewer.hidden = false;
  renderList();
  updateDocTitle();
  setMode('live');
}

// ---------- modes ----------
function setMode(m) {
  mode = m;

  for (const b of modes.querySelectorAll('button')) {
    b.classList.toggle('active', b.dataset.mode === m);
  }
  refreshBtn.hidden = m !== 'live';
  openExtBtn.hidden = m !== 'live';
  selectAllBtn.hidden = m !== 'edit';
  resetBtn.hidden = m !== 'edit';
  editHint.hidden = m !== 'edit';
  liveFrame.hidden = m !== 'live';
  editFrame.hidden = m !== 'edit';
  showViewerError('');
  saveState.hidden = m !== 'edit';
  if (m !== 'edit') saveState.textContent = '';

  if (m === 'live') showLive();
  else showEdit();
}

// ---------- live view (rendered from the doc's exported HTML, read-only) ----------
// We render the doc ourselves instead of embedding Google's viewer, because
// browsers block that cross-site embed (third-party cookies) and it shows blank.
// This works in every browser. "Open in Google Docs" gives the full Google viewer.
function renderReadOnly(frame, html) {
  frame.onload = () => showLoading(false);
  frame.srcdoc = html; // sandboxed (no scripts) — content is display-only + selectable
}

async function showLive(force) {
  showViewerError('');
  // Already showing this doc's live view (e.g. toggled back from Edit) — don't refetch.
  if (!force && liveLoadedId === selectedId) {
    showLoading(false);
    return;
  }
  showLoading(true);
  try {
    const r = await fetch(`${API}?id=${encodeURIComponent(selectedId)}`);
    const data = await r.json();
    if (!data.ok) throw new Error(data.message || 'Could not load this doc.');
    liveLoadedId = selectedId;
    renderReadOnly(liveFrame, data.html);
  } catch (e) {
    liveLoadedId = null;
    showLoading(false);
    showViewerError(e.message || 'Could not load this doc.');
  }
}

function refreshLive() {
  liveLoadedId = null; // force a fresh pull of the current document
  showLive(true);
}

function openInGoogleDocs() {
  if (selectedId) window.open(docEditUrl(selectedId), '_blank', 'noopener');
}

// ---------- editable copy ----------
function loadEditFrame(html) {
  editFrame.onload = () => {
    showLoading(false);
    const fdoc = editFrame.contentDocument;
    if (!fdoc) {
      showViewerError('Could not open the editable copy in this browser.');
      return;
    }
    try {
      fdoc.designMode = 'on'; // make the whole copy editable
      fdoc.addEventListener('input', scheduleSave);
    } catch {
      showViewerError('Could not open the editable copy in this browser.');
    }
  };
  editFrame.srcdoc = html;
}

async function showEdit() {
  showViewerError('');
  // Use the saved working copy if we have one; otherwise pull a fresh one.
  let stored = null;
  try { stored = localStorage.getItem(lsCopyKey(selectedId)); } catch {}
  if (stored != null) {
    setSaveState('Saved', 'ok');
    loadEditFrame(stored);
  } else {
    await pullCopy();
  }
}

async function pullCopy() {
  showLoading(true);
  setSaveState('', null);
  try {
    const r = await fetch(`${API}?id=${encodeURIComponent(selectedId)}`);
    const data = await r.json();
    if (!data.ok) throw new Error(data.message || 'Could not load this doc.');
    let cached = true;
    try { localStorage.setItem(lsCopyKey(selectedId), data.html); }
    catch { cached = false; }
    setSaveState(cached ? 'Saved' : 'Too big to save', cached ? 'ok' : 'warn');
    loadEditFrame(data.html);
  } catch (e) {
    showLoading(false);
    showViewerError(e.message || 'Could not load this doc.');
  }
}

function scheduleSave() {
  setSaveState('Saving…', null);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCopy, 600);
}

function saveCopy() {
  // A debounced save can fire after the user left Edit mode or the frame was torn
  // down — bail quietly instead of showing a false "Could not save" warning.
  if (mode !== 'edit') return;
  const fdoc = editFrame.contentDocument;
  if (!fdoc || !fdoc.documentElement) return;
  try {
    const full = '<!DOCTYPE html>' + fdoc.documentElement.outerHTML;
    localStorage.setItem(lsCopyKey(selectedId), full);
    setSaveState('Saved', 'ok');
  } catch (e) {
    if (e && e.name === 'QuotaExceededError') {
      setSaveState('Too big to save', 'warn');
    } else {
      setSaveState('Could not save', 'warn');
    }
  }
}

function resetCopy() {
  if (!confirm('Replace this editable copy with a fresh pull of the current Google Doc?\n\nYour edits in this copy will be lost. The real Google Doc is not affected.')) return;
  try { localStorage.removeItem(lsCopyKey(selectedId)); } catch {}
  pullCopy();
}

function selectAllCopy() {
  try {
    const win = editFrame.contentWindow;
    const fdoc = editFrame.contentDocument;
    win.focus();
    const sel = win.getSelection();
    sel.removeAllRanges();
    const range = fdoc.createRange();
    range.selectNodeContents(fdoc.body);
    sel.addRange(range);
  } catch {
    showViewerError('Could not select the text automatically — click inside the copy and press Ctrl+A.');
  }
}

// ---------- wire up ----------
addForm.addEventListener('submit', addDoc);
modes.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-mode]');
  if (b) setMode(b.dataset.mode);
});
refreshBtn.addEventListener('click', refreshLive);
openExtBtn.addEventListener('click', openInGoogleDocs);
resetBtn.addEventListener('click', resetCopy);
selectAllBtn.addEventListener('click', selectAllCopy);

// ---------- init ----------
renderList();
if (docs.length > 0) {
  openDoc(docs[0].id);
} else {
  welcome.hidden = false;
  viewer.hidden = true;
}
