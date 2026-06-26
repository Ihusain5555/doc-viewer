/* Doc Viewer — client logic.
 *
 * What it does:
 *  - Keeps a list of Google Doc links ("templates") in this browser (localStorage).
 *  - "Live view": renders a template's exported HTML (via /api/doc) read-only in a
 *    sandboxed iframe — always re-fetched fresh.
 *  - "Fills": each template can spawn MANY independent, named, persistent editable
 *    copies ("fills"). A fill is the template's exported HTML rendered in a
 *    sandboxed, editable iframe you can change and Ctrl+C from. The real Google Doc
 *    is never written to — fills live only in your browser.
 *  - Theme (light/dark) + accent color, persisted locally.
 *  - Back up / Restore the whole list AND your fills as a JSON file (merge on restore).
 *
 * Data model (localStorage):
 *  - gdv:docs            -> [{ id, title, addedAt }]                 (the template list)
 *  - gdv:copies          -> [{ copyId, docId, name, createdAt, updatedAt }]  (fill metadata, light)
 *  - gdv:copybody:<copyId> -> full HTML string of that fill          (heavy; one key per fill)
 *  - gdv:copies:migrated -> "2" once the one-copy-per-doc model was migrated forward
 *  - gdv:theme, gdv:accent
 *  Legacy (kept, never deleted, for reversibility): gdv:copy:<docId> -> old single copy HTML.
 */

const API = '/api/doc';
const docEditUrl = (id) => `https://docs.google.com/document/d/${id}/edit`;

const LS_DOCS = 'gdv:docs';
const LS_COPIES = 'gdv:copies';
const LS_MIGRATED = 'gdv:copies:migrated';
const LS_THEME = 'gdv:theme';
const LS_ACCENT = 'gdv:accent';
const lsCopyBodyKey = (copyId) => `gdv:copybody:${copyId}`;
const lsLegacyCopyKey = (docId) => `gdv:copy:${docId}`; // pre-multi-copy single buffer

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

function loadCopies() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_COPIES));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function saveCopies() {
  try {
    localStorage.setItem(LS_COPIES, JSON.stringify(copies));
    return true;
  } catch {
    return false;
  }
}
function loadCopyBody(copyId) {
  try {
    return localStorage.getItem(lsCopyBodyKey(copyId));
  } catch {
    return null;
  }
}
function saveCopyBody(copyId, html) {
  try {
    localStorage.setItem(lsCopyBodyKey(copyId), html);
    return true;
  } catch {
    return false;
  }
}
function removeCopyBody(copyId) {
  try {
    localStorage.removeItem(lsCopyBodyKey(copyId));
  } catch {
    /* ignore */
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
let copies = loadCopies();
let selectedId = null;    // the selected TEMPLATE's docId
let activeCopyId = null;  // the open fill's copyId (null = template-level / no fill open)
let mode = 'live';        // 'live' | 'edit'
let saveTimer = null;
let liveLoadedId = null;  // which doc's live view is currently rendered
let copyCounter = 0;

// A local, collision-resistant id for a fill. Date.now() is fine in the browser.
function newCopyId() {
  return 'c_' + Date.now().toString(36) + '_' + (copyCounter++).toString(36);
}

// ---------- one-time migration: old single copy -> first named fill ----------
// NON-DESTRUCTIVE: creates a new fill (metadata + gdv:copybody) from any existing
// gdv:copy:<docId>, but LEAVES the old key in place so the change is reversible.
// Idempotent via the gdv:copies:migrated flag.
function migrateCopies() {
  // Idempotency does NOT rely on the flag alone — localStorage can be partially
  // cleared (flag gone, legacy key still there). Each migrated fill is marked
  // `fromLegacy`, and we skip a doc whose legacy buffer already produced one, so a
  // re-run can never duplicate a fill. The old key is always left in place.
  let changed = false;
  for (const d of docs) {
    let legacy = null;
    try { legacy = localStorage.getItem(lsLegacyCopyKey(d.id)); } catch { legacy = null; }
    if (legacy == null) continue;
    if (copies.some((c) => c.fromLegacy && c.docId === d.id)) continue; // already migrated
    const copyId = newCopyId();
    const name = d.title && d.title !== 'Loading…' ? d.title : 'My fill';
    copies.push({ copyId, docId: d.id, name, createdAt: Date.now(), updatedAt: Date.now(), fromLegacy: true });
    saveCopyBody(copyId, legacy); // old key intentionally left untouched (reversible)
    changed = true;
  }
  if (changed) saveCopies();
  try { localStorage.setItem(LS_MIGRATED, '2'); } catch { /* marker handles idempotency */ }
}

// ---------- dom ----------
const $ = (id) => document.getElementById(id);
const addForm = $('addForm');
const addInput = $('addInput');
const addError = $('addError');
const docList = $('docList');
const emptyHint = $('emptyHint');
const docCount = $('docCount');
const docTitle = $('docTitle');
const docMeta = $('docMeta');
const welcome = $('welcome');
const viewer = $('viewer');
const modes = $('modes');
const modeLive = $('mode-live');
const modeEdit = $('mode-edit');
const refreshBtn = $('refreshBtn');
const openExtBtn = $('openExtBtn');
const selectAllBtn = $('selectAllBtn');
const downloadBtn = $('downloadBtn');
const printBtn = $('printBtn');
const toolDivider = $('toolDivider');
const resetBtn = $('resetBtn');
const saveState = $('saveState');
const liveFrame = $('liveFrame');
const editFrame = $('editFrame');
const fillsPanel = $('fillsPanel');
const loading = $('loading');
const viewerError = $('viewerError');
const editHint = $('editHint');
const saveWarn = $('saveWarn');
// theme / accent
const themeToggle = $('themeToggle');
const accentBtn = $('accentBtn');
const accentMenu = $('accentMenu');
const swatches = $('swatches');
// back up / restore
const exportBtn = $('exportBtn');
const importBtn = $('importBtn');
const importInput = $('importInput');
const ioMsg = $('ioMsg');

// ---------- inline icons (row buttons) ----------
const ICON_RENAME = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const ICON_REMOVE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const ICON_NEWFILL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';

// ---------- helpers ----------
function extractDocId(input) {
  if (!input) return null;
  const s = String(input).trim();
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
function findCopy(copyId) {
  return copies.find((c) => c.copyId === copyId) || null;
}
function copiesForDoc(docId) {
  return copies
    .filter((c) => c.docId === docId)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
function touchCopy(copyId) {
  const c = findCopy(copyId);
  if (!c) return;
  c.updatedAt = Date.now();
  saveCopies();
}

function shortId(id) {
  return id.length > 16 ? id.slice(0, 8) + '…' + id.slice(-4) : id;
}

function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  if (d < 7) return d + 'd ago';
  const w = Math.floor(d / 7);
  if (w < 5) return w + 'w ago';
  try { return new Date(ts).toLocaleDateString(); } catch { return ''; }
}

function sanitizeFilename(name) {
  return (String(name || 'fill').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80)) || 'fill';
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
  saveState.hidden = !(mode === 'edit' && activeCopyId) || !text;
  saveState.textContent = text || '';
  let cls = 'badge';
  if (kind === 'ok') cls += ' ok';
  else if (kind === 'warn') cls += ' warn';
  else if (text) cls += ' saving';
  saveState.className = cls;
}

// Loud, persistent warning when a fill can't be saved to this device.
function showSaveWarn(on, kind) {
  if (!saveWarn) return;
  if (!on) { saveWarn.hidden = true; saveWarn.textContent = ''; return; }
  saveWarn.hidden = false;
  saveWarn.textContent =
    kind === 'couldnt'
      ? 'This device wouldn’t save your latest changes. Use “Download .doc” to keep this fill safe.'
      : 'This fill is too large to save on this device. Use “Download .doc” to keep it before you close the tab.';
}

// ---------- theme + accent ----------
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
}
function toggleTheme() {
  const next = currentTheme() === 'light' ? 'dark' : 'light';
  applyTheme(next);
  try { localStorage.setItem(LS_THEME, next); } catch {}
}

function inkFor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.6 ? '#0A0E17' : '#FFFFFF';
}
function applyAccent(hex) {
  const root = document.documentElement;
  if (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) {
    root.style.setProperty('--accent', hex);
    root.style.setProperty('--accent-ink', inkFor(hex));
  } else {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-ink');
  }
}
function setAccent(hex) {
  try {
    if (hex) localStorage.setItem(LS_ACCENT, hex);
    else localStorage.removeItem(LS_ACCENT);
  } catch {}
  applyAccent(hex);
  markSelectedSwatch(hex);
}

const ACCENTS = [
  { name: 'Blue', hex: '#2563EB' },
  { name: 'Violet', hex: '#6D28D9' },
  { name: 'Cyan', hex: '#0E7490' },
  { name: 'Emerald', hex: '#047857' },
  { name: 'Amber', hex: '#B45309' },
  { name: 'Rose', hex: '#BE123C' },
];

function storedAccent() {
  try { return localStorage.getItem(LS_ACCENT); } catch { return null; }
}
function buildSwatches() {
  const items = [{ name: 'Default (auto)', hex: null }, ...ACCENTS];
  swatches.innerHTML = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.title = it.name;
    b.setAttribute('aria-label', it.name + ' accent');
    b.dataset.hex = it.hex || '';
    if (it.hex) b.style.background = it.hex;
    else b.style.background = 'conic-gradient(#2563EB, #6D28D9, #0E7490, #047857, #B45309, #BE123C, #2563EB)';
    b.addEventListener('click', () => setAccent(it.hex));
    swatches.appendChild(b);
  }
  markSelectedSwatch(storedAccent());
}
function markSelectedSwatch(hex) {
  if (!swatches) return;
  for (const b of swatches.querySelectorAll('.swatch')) {
    b.classList.toggle('selected', (b.dataset.hex || '') === (hex || ''));
  }
}

// ---------- sidebar rendering (templates + nested fills) ----------
function renderList() {
  docList.innerHTML = '';
  emptyHint.hidden = docs.length > 0;
  if (docCount) docCount.textContent = String(docs.length);

  for (const d of docs) {
    const li = document.createElement('li');
    const isTplSelected = d.id === selectedId && !activeCopyId;
    li.className = 'doc-item template' + (isTplSelected ? ' selected' : '');
    li.title = d.title;
    if (isTplSelected) li.setAttribute('aria-current', 'true');

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = d.title || 'Untitled document';
    name.addEventListener('click', () => openDoc(d.id));

    const renameBtn = document.createElement('button');
    renameBtn.className = 'row-btn';
    renameBtn.innerHTML = ICON_RENAME;
    renameBtn.title = 'Rename';
    renameBtn.setAttribute('aria-label', 'Rename document');
    renameBtn.addEventListener('click', (e) => { e.stopPropagation(); renameDoc(d.id); });

    const delBtn = document.createElement('button');
    delBtn.className = 'row-btn del';
    delBtn.innerHTML = ICON_REMOVE;
    delBtn.title = 'Remove from list';
    delBtn.setAttribute('aria-label', 'Remove document from list');
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); removeDoc(d.id); });

    li.append(name, renameBtn, delBtn);
    docList.appendChild(li);

    // nested fills for this template
    for (const c of copiesForDoc(d.id)) {
      const cli = document.createElement('li');
      const isCopySel = c.copyId === activeCopyId;
      cli.className = 'copy-item' + (isCopySel ? ' selected' : '');
      cli.title = c.name;
      if (isCopySel) cli.setAttribute('aria-current', 'true');

      const main = document.createElement('span');
      main.className = 'copy-main';
      main.addEventListener('click', () => openCopy(c.copyId));
      const cname = document.createElement('span');
      cname.className = 'copy-name';
      cname.textContent = c.name;
      const csub = document.createElement('span');
      csub.className = 'copy-sub mono';
      csub.textContent = 'edited ' + (timeAgo(c.updatedAt) || 'recently');
      main.append(cname, csub);

      const cren = document.createElement('button');
      cren.className = 'row-btn';
      cren.innerHTML = ICON_RENAME;
      cren.title = 'Rename fill';
      cren.setAttribute('aria-label', 'Rename fill');
      cren.addEventListener('click', (e) => { e.stopPropagation(); renameCopy(c.copyId); });

      const cdel = document.createElement('button');
      cdel.className = 'row-btn del';
      cdel.innerHTML = ICON_REMOVE;
      cdel.title = 'Delete fill';
      cdel.setAttribute('aria-label', 'Delete fill');
      cdel.addEventListener('click', (e) => { e.stopPropagation(); removeCopy(c.copyId); });

      cli.append(main, cren, cdel);
      docList.appendChild(cli);
    }

    // "+ New fill" affordance under each template
    const add = document.createElement('li');
    add.className = 'new-fill-row';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'new-fill-btn';
    addBtn.innerHTML = ICON_NEWFILL + '<span>New fill</span>';
    addBtn.title = 'Make a new fill from this template';
    addBtn.addEventListener('click', () => makeCopy(d.id));
    add.appendChild(addBtn);
    docList.appendChild(add);
  }
}

function updateDocTitle() {
  if (activeCopyId) {
    const c = findCopy(activeCopyId);
    const d = c ? findDoc(c.docId) : null;
    docTitle.textContent = c ? c.name : '';
    if (docMeta) {
      docMeta.textContent = d ? 'from ' + (d.title || 'template') : '';
      docMeta.hidden = !d;
    }
    return;
  }
  const d = findDoc(selectedId);
  docTitle.textContent = d ? d.title : '';
  if (docMeta) {
    docMeta.textContent = d ? shortId(d.id) : '';
    docMeta.hidden = !d;
  }
}

function showLoading(on) {
  loading.hidden = !on;
}
function showViewerError(msg) {
  viewerError.hidden = !msg;
  viewerError.textContent = msg || '';
}

// ---------- doc (template) actions ----------
async function addDoc(e) {
  e.preventDefault();
  setAddError('');

  const id = extractDocId(addInput.value);
  if (!id) {
    addInput.classList.add('invalid');
    setAddError("That doesn't look like a Google Doc link. Copy the full URL from your browser's address bar.");
    return;
  }
  if (findDoc(id)) {
    addInput.value = '';
    openDoc(id);
    return;
  }

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
  const n = copiesForDoc(id).length;
  const msg = n
    ? `Remove “${d.title}” and its ${n} saved fill${n === 1 ? '' : 's'} from this device?\n\nThis permanently deletes those fills’ edits here. Your real Google Doc is not affected.`
    : `Remove “${d.title}” from your list?\n\nThis only removes it here — your real Google Doc is not affected.`;
  if (!confirm(msg)) return;

  for (const c of copiesForDoc(id)) removeCopyBody(c.copyId);
  copies = copies.filter((c) => c.docId !== id);
  saveCopies();
  docs = docs.filter((x) => x.id !== id);
  saveDocs();
  try { localStorage.removeItem(lsLegacyCopyKey(id)); } catch {}

  // Reconcile state: never leave selectedId/activeCopyId pointing at something gone.
  if (activeCopyId && !findCopy(activeCopyId)) activeCopyId = null;
  if (selectedId && !findDoc(selectedId)) {
    selectedId = null;
    activeCopyId = null;
    viewer.hidden = true;
    welcome.hidden = false;
    docTitle.textContent = '';
    if (docMeta) { docMeta.textContent = ''; docMeta.hidden = true; }
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
  if (selectedId === id && !activeCopyId) updateDocTitle();
}

function openDoc(id) {
  flushPendingSave();
  selectedId = id;
  activeCopyId = null;
  welcome.hidden = true;
  viewer.hidden = false;
  renderList();
  updateDocTitle();
  setMode('live');
}

// ---------- fill (copy) actions ----------
function openCopy(copyId) {
  const c = findCopy(copyId);
  if (!c) return;
  flushPendingSave();
  selectedId = c.docId;
  activeCopyId = copyId;
  welcome.hidden = true;
  viewer.hidden = false;
  renderList();
  updateDocTitle();
  setMode('edit');
}

async function makeCopy(docId) {
  const d = findDoc(docId);
  if (!d) return;
  flushPendingSave();

  // Show this template's pane with a loading overlay, but DON'T commit the toolbar
  // and frames to the fill state until the fetch actually succeeds — a failed fetch
  // must never strand the UI in a half-built edit mode with the spinner stuck on.
  selectedId = docId;
  activeCopyId = null;
  welcome.hidden = true;
  viewer.hidden = false;
  updateDocTitle();
  showViewerError('');
  showSaveWarn(false);
  showLoading(true);

  try {
    const r = await fetch(`${API}?id=${encodeURIComponent(docId)}`);
    const data = await r.json();
    if (!data.ok) throw new Error(data.message || 'Could not load this doc.');

    const copyId = newCopyId();
    const existing = copiesForDoc(docId).length;
    const name = 'Copy ' + (existing + 1);
    copies.push({ copyId, docId, name, createdAt: Date.now(), updatedAt: Date.now() });
    saveCopyBody(copyId, data.html);
    saveCopies();
    activeCopyId = copyId;
    renderList();
    updateDocTitle();
    setMode('edit'); // activeCopyId is set -> showEdit loads the new fill (and sets the save badge)
  } catch (e) {
    // Reconcile to a consistent template-level edit state, THEN surface the error.
    activeCopyId = null;
    showLoading(false);
    renderList();
    updateDocTitle();
    setMode('edit'); // activeCopyId null -> fills picker; toolbar/frames are reconciled
    showViewerError(e.message || 'Could not make a copy — the template wouldn’t load.');
  }
}

function renameCopy(copyId) {
  const c = findCopy(copyId);
  if (!c) return;
  const next = prompt('Rename this fill:', c.name);
  if (next == null) return;
  c.name = next.trim() || c.name;
  saveCopies();
  renderList();
  if (activeCopyId === copyId) updateDocTitle();
}

function removeCopy(copyId) {
  const c = findCopy(copyId);
  if (!c) return;
  if (!confirm(`Delete the fill “${c.name}”?\n\nThis permanently deletes this fill’s edits on this device. Your other fills and your real Google Doc are not affected.`)) return;

  removeCopyBody(copyId);
  copies = copies.filter((x) => x.copyId !== copyId);
  saveCopies();

  if (activeCopyId === copyId) {
    activeCopyId = null;
    renderList();
    updateDocTitle();
    setMode('live'); // fall back to the source template's live view
  } else {
    renderList();
  }
}

function resetCopy() {
  if (!activeCopyId) return;
  const c = findCopy(activeCopyId);
  const nm = c ? c.name : 'this fill';
  if (!confirm(`Reset “${nm}” to a fresh copy of the template?\n\nThis permanently deletes everything you’ve typed in THIS fill and pulls the original template text again. Your other fills and your real Google Doc are not affected.`)) return;
  pullCopyBody();
}

// ---------- modes ----------
function setMode(m) {
  mode = m;

  if (modeLive && modeEdit) {
    modeLive.checked = m === 'live';
    modeEdit.checked = m === 'edit';
  }

  const editingCopy = m === 'edit' && !!activeCopyId;
  const showFills = m === 'edit' && !activeCopyId;

  refreshBtn.hidden = m !== 'live';
  openExtBtn.hidden = m !== 'live';
  selectAllBtn.hidden = !editingCopy;
  downloadBtn.hidden = !editingCopy;
  printBtn.hidden = !editingCopy;
  if (toolDivider) toolDivider.hidden = !editingCopy;
  resetBtn.hidden = !editingCopy;
  editHint.hidden = !editingCopy;
  liveFrame.hidden = m !== 'live';
  editFrame.hidden = !editingCopy;
  if (fillsPanel) fillsPanel.hidden = !showFills;
  showViewerError('');
  showSaveWarn(false);
  saveState.hidden = !editingCopy;
  if (!editingCopy) { saveState.textContent = ''; saveState.className = 'badge'; }

  if (m === 'live') showLive();
  else if (editingCopy) showEdit();
  else showFillsPanel();
}

// ---------- live view (read-only render of the template's exported HTML) ----------
function renderReadOnly(frame, html) {
  frame.onload = () => showLoading(false);
  // Same page chrome as the editable copy so the live original reads as a real,
  // fit-to-width document page on a desk — not a narrow column on a blank field.
  frame.srcdoc = injectDocStyle(html); // sandboxed (no scripts) — display-only + selectable
}

async function showLive(force) {
  showViewerError('');
  if (!selectedId) { showLoading(false); return; }
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
  liveLoadedId = null;
  showLive(true);
}

function openInGoogleDocs() {
  if (selectedId) window.open(docEditUrl(selectedId), '_blank', 'noopener');
}

// ---------- editable copy (a fill) ----------
// Render the export HTML as a real "page": a centered white sheet with margins on a
// calm grey desk, sized to FIT the pane width at any browser zoom (responsive — the
// page reflows to the available width instead of overflowing or leaving a narrow
// column in a sea of white). Used for BOTH the live view and the editable copies so
// the original and your fills look like the same document.
//   `!important` is required: Google's own body class pins a fixed ~8.5in width with
//   1in padding, so without it the page can't shrink to fit and you'd still see the
//   white-space problem. Idempotent (guarded by id="dv-chrome") so re-loading a saved
//   fill — which already carries this style — never double-injects.
function injectDocStyle(html) {
  if (typeof html !== 'string') return html;
  if (html.indexOf('dv-chrome') !== -1) return html;
  const style =
    "<style id=\"dv-chrome\">" +
    "html{background:#eceef2!important;box-sizing:border-box;-webkit-text-size-adjust:100%;" +
    "padding:clamp(10px,2.5vw,36px) clamp(8px,2vw,28px)!important;}" +
    "body{box-sizing:border-box!important;width:100%!important;max-width:850px!important;" +
    "margin:0 auto!important;background:#fff!important;" +
    "padding:clamp(30px,7%,76px) clamp(22px,8%,84px)!important;" +
    "box-shadow:0 1px 3px rgba(16,24,40,.13),0 16px 44px rgba(16,24,40,.12)!important;" +
    "border-radius:4px;line-height:1.6;}" +
    "img{max-width:100%!important;height:auto!important;}table{max-width:100%!important;}" +
    "@media(max-width:760px){body{border-radius:0;" +
    "padding:clamp(20px,6%,40px) clamp(16px,6%,34px)!important;}}" +
    "</style>";
  if (html.indexOf('</head>') !== -1) return html.replace('</head>', style + '</head>');
  const b = html.indexOf('<body');
  if (b !== -1) return html.slice(0, b) + '<head>' + style + '</head>' + html.slice(b);
  return style + html;
}

function loadEditFrame(html) {
  editFrame.onload = () => {
    showLoading(false);
    const fdoc = editFrame.contentDocument;
    if (!fdoc) {
      showViewerError('Could not open the editable copy in this browser.');
      return;
    }
    try {
      fdoc.designMode = 'on';
      fdoc.addEventListener('input', scheduleSave);
    } catch {
      showViewerError('Could not open the editable copy in this browser.');
    }
  };
  editFrame.srcdoc = injectDocStyle(html);
}

async function showEdit() {
  showViewerError('');
  if (!activeCopyId) { showFillsPanel(); return; }
  const c = findCopy(activeCopyId);
  if (!c) { activeCopyId = null; showFillsPanel(); return; }

  const body = loadCopyBody(activeCopyId);
  if (body == null) {
    // Body lost (e.g. storage cleared / restored metadata only) — re-pull fresh.
    await pullCopyBody();
    return;
  }
  setSaveState('Saved · this device', 'ok');
  showSaveWarn(false);
  loadEditFrame(body);
}

// Re-pull fresh template HTML into the ACTIVE fill (used by Reset and recovery).
async function pullCopyBody() {
  if (!activeCopyId) return;
  showLoading(true);
  setSaveState('', null);
  try {
    const r = await fetch(`${API}?id=${encodeURIComponent(selectedId)}`);
    const data = await r.json();
    if (!data.ok) throw new Error(data.message || 'Could not load this doc.');
    const body = injectDocStyle(data.html);
    const ok = saveCopyBody(activeCopyId, body);
    touchCopy(activeCopyId);
    renderList();
    setSaveState(ok ? 'Saved · this device' : 'Too big to save', ok ? 'ok' : 'warn');
    showSaveWarn(!ok);
    loadEditFrame(body);
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
  if (mode !== 'edit' || !activeCopyId) return;
  const fdoc = editFrame.contentDocument;
  if (!fdoc || !fdoc.documentElement) return;
  try {
    const full = '<!DOCTYPE html>' + fdoc.documentElement.outerHTML;
    localStorage.setItem(lsCopyBodyKey(activeCopyId), full);
    touchCopy(activeCopyId);
    setSaveState('Saved · this device', 'ok');
    showSaveWarn(false);
  } catch (e) {
    if (e && e.name === 'QuotaExceededError') {
      setSaveState('Too big to save', 'warn');
      showSaveWarn(true);
    } else {
      setSaveState('Could not save', 'warn');
      showSaveWarn(true, 'couldnt');
    }
  }
}

// Flush a pending debounced save immediately. Call this BEFORE any transition that
// changes the active fill or leaves edit mode, so rapid clicks never drop the last
// keystrokes. It uses the CURRENT activeCopyId, so it must run before reassigning state.
function flushPendingSave() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  if (mode === 'edit' && activeCopyId) saveCopy();
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

// ---------- fills picker (edit mode, template-level) ----------
function showFillsPanel() {
  if (!fillsPanel) return;
  const list = copiesForDoc(selectedId);

  const head = document.createElement('div');
  head.className = 'fills-head';
  const title = document.createElement('span');
  title.className = 'fills-title';
  title.textContent = list.length ? 'Your fills' : 'Start a fill';
  const newBtn = document.createElement('button');
  newBtn.type = 'button';
  newBtn.className = 'btn-primary fills-new';
  newBtn.innerHTML = ICON_NEWFILL + '<span>New fill</span>';
  newBtn.addEventListener('click', () => makeCopy(selectedId));
  head.append(title, newBtn);

  const inner = document.createElement('div');
  inner.className = 'fills-inner';
  inner.appendChild(head);

  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'fills-empty';
    empty.textContent = 'No fills yet. Make a copy of this template to start filling it in — each fill saves separately on this device, and the original Google Doc is never touched.';
    inner.appendChild(empty);
  } else {
    const ul = document.createElement('ul');
    ul.className = 'fills-list';
    for (const c of list) {
      const li = document.createElement('li');
      li.className = 'fill-card' + (c.copyId === activeCopyId ? ' selected' : '');
      li.addEventListener('click', () => openCopy(c.copyId));

      const info = document.createElement('span');
      info.className = 'fill-info';
      const nm = document.createElement('span');
      nm.className = 'fill-name';
      nm.textContent = c.name;
      const sub = document.createElement('span');
      sub.className = 'fill-sub mono';
      sub.textContent = 'edited ' + (timeAgo(c.updatedAt) || 'recently');
      info.append(nm, sub);

      const go = document.createElement('span');
      go.className = 'fill-go';
      go.setAttribute('aria-hidden', 'true');
      go.textContent = '→';

      li.append(info, go);
      ul.appendChild(li);
    }
    inner.appendChild(ul);
  }

  const note = document.createElement('p');
  note.className = 'fills-note';
  note.innerHTML = 'Your fills live only in this browser. Use <strong>Back up</strong> in the sidebar to keep them safe or move them to another device.';
  inner.appendChild(note);

  fillsPanel.innerHTML = '';
  fillsPanel.appendChild(inner);
  showLoading(false);
}

// ---------- file export: Word (.doc) + Print / PDF ----------
function activeCopyName() {
  const c = findCopy(activeCopyId);
  return c ? c.name : 'fill';
}

function downloadCopyAsWord() {
  const fdoc = editFrame.contentDocument;
  if (!fdoc || !fdoc.body) { showViewerError('Nothing to download yet.'); return; }
  // Keep the doc's own styles for formatting; drop our on-screen page chrome.
  const styles = Array.from(fdoc.querySelectorAll('style'))
    .filter((n) => n.id !== 'dv-chrome')
    .map((n) => n.outerHTML)
    .join('');
  const bodyHtml = fdoc.body.innerHTML;
  const header =
    "<html xmlns:o='urn:schemas-microsoft-com:office:office' " +
    "xmlns:w='urn:schemas-microsoft-com:office:word' " +
    "xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'>" + styles + "</head><body>";
  const blob = new Blob(['﻿', header, bodyHtml, '</body></html>'], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = sanitizeFilename(activeCopyName()) + '.doc';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function printCopy() {
  try {
    const win = editFrame.contentWindow;
    win.focus();
    win.print();
  } catch {
    showViewerError('Could not open the print dialog here. Try “Download .doc” and print from Word instead.');
  }
}

// ---------- back up / restore (links + fills) ----------
let ioTimer = null;
function setIoMsg(text, kind) {
  if (!ioMsg) return;
  clearTimeout(ioTimer);
  if (!text) { ioMsg.hidden = true; ioMsg.textContent = ''; return; }
  ioMsg.hidden = false;
  ioMsg.textContent = text;
  ioMsg.className = kind === 'error' ? 'msg error' : 'msg io' + (kind === 'ok' ? ' ok' : '');
  ioTimer = setTimeout(() => { ioMsg.hidden = true; ioMsg.textContent = ''; }, 8000);
}

function exportBackup() {
  if (docs.length === 0 && copies.length === 0) {
    setIoMsg('Nothing to back up yet — add a doc first.', null);
    return;
  }
  const now = new Date();
  const payload = {
    app: 'doc-viewer',
    version: 2,
    exportedAt: now.toISOString(),
    docs: docs.map((d) => ({ id: d.id, title: d.title, addedAt: d.addedAt || null })),
    copies: copies.map((c) => ({
      copyId: c.copyId,
      docId: c.docId,
      name: c.name,
      createdAt: c.createdAt || null,
      updatedAt: c.updatedAt || null,
      html: loadCopyBody(c.copyId) || '',
    })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = `doc-viewer-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  const nf = copies.length;
  setIoMsg(`Backed up ${docs.length} doc${docs.length === 1 ? '' : 's'} and ${nf} fill${nf === 1 ? '' : 's'}.`, 'ok');
}

function importFromText(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    setIoMsg("That file isn’t valid JSON. Use a file you backed up from Doc Viewer.", 'error');
    return;
  }
  const incomingDocs = Array.isArray(data) ? data : (data && Array.isArray(data.docs) ? data.docs : null);
  if (!incomingDocs) {
    setIoMsg("That file doesn’t look like a Doc Viewer backup.", 'error');
    return;
  }

  // --- merge templates (works for v1 links-only AND v2) ---
  let added = 0, skipped = 0, invalid = 0;
  const newlyAdded = [];
  for (const item of incomingDocs) {
    let raw = null, title = null, addedAt = null;
    if (typeof item === 'string') {
      raw = item;
    } else if (item && typeof item === 'object') {
      raw = item.id || item.url || item.link || null;
      title = item.title || null;
      addedAt = typeof item.addedAt === 'number' ? item.addedAt : null;
    }
    const id = extractDocId(typeof raw === 'string' ? raw : '');
    if (!id) { invalid++; continue; }
    if (findDoc(id)) { skipped++; continue; }
    const doc = { id, title: (title && String(title).trim()) || 'Untitled document', addedAt: addedAt || Date.now() };
    docs.push(doc);
    newlyAdded.push(doc);
    added++;
  }

  // --- merge fills (v2 only) ---
  let copiesAdded = 0, copiesSkipped = 0, copyFailed = 0, copiesInvalid = 0;
  const incomingCopies = data && Array.isArray(data.copies) ? data.copies : [];
  for (const c of incomingCopies) {
    if (!c || typeof c !== 'object') continue;
    const cid = typeof c.copyId === 'string' ? c.copyId : null;
    const did = typeof c.docId === 'string' ? extractDocId(c.docId) : null;
    if (!cid || !did) { copiesInvalid++; continue; } // malformed id -> don't create an unopenable orphan
    if (findCopy(cid)) { copiesSkipped++; continue; } // copyId collision -> keep existing fill, skip incoming

    // Make sure the fill's template exists so it shows up in the list.
    if (!findDoc(did)) {
      const placeholder = { id: did, title: 'Untitled document', addedAt: Date.now() };
      docs.push(placeholder);
      newlyAdded.push(placeholder);
      added++;
    }

    const meta = {
      copyId: cid,
      docId: did,
      name: (c.name && String(c.name).trim()) || 'Fill',
      createdAt: typeof c.createdAt === 'number' ? c.createdAt : Date.now(),
      updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : Date.now(),
    };
    copies.push(meta);
    const ok = saveCopyBody(cid, typeof c.html === 'string' ? c.html : '');
    if (!ok) copyFailed++;
    copiesAdded++;
  }

  if (copiesAdded) saveCopies();
  if (added) { if (!saveDocs()) warnStorageBlocked(); }
  if (added || copiesAdded) { renderList(); updateDocTitle(); }
  if (added) refreshTitles(newlyAdded.filter((d) => d.title === 'Untitled document'));

  const parts = [`Added ${added} doc${added === 1 ? '' : 's'}`];
  if (copiesAdded) parts.push(`${copiesAdded} fill${copiesAdded === 1 ? '' : 's'}`);
  if (skipped) parts.push(`skipped ${skipped} already in your list`);
  if (copiesSkipped) parts.push(`kept your ${copiesSkipped} existing fill${copiesSkipped === 1 ? '' : 's'}`);
  if (copyFailed) parts.push(`${copyFailed} fill${copyFailed === 1 ? '' : 's'} too big to save`);
  if (invalid) parts.push(`${invalid} unreadable`);
  if (copiesInvalid) parts.push(`${copiesInvalid} fill${copiesInvalid === 1 ? '' : 's'} unreadable`);
  setIoMsg(parts.join(', ') + '.', (added || copiesAdded) ? 'ok' : null);
}

async function refreshTitles(list) {
  for (const doc of list) {
    try {
      const r = await fetch(`${API}?id=${encodeURIComponent(doc.id)}&meta=1`);
      const data = await r.json();
      if (data.ok && data.title) {
        doc.title = data.title;
        saveDocs();
        renderList();
        if (selectedId === doc.id) updateDocTitle();
      }
    } catch { /* leave as Untitled */ }
  }
}

function importDocs() {
  importInput.value = ''; // allow re-importing the same file
  importInput.click();
}
function onImportFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => importFromText(String(reader.result || ''));
  reader.onerror = () => setIoMsg('Could not read that file.', 'error');
  reader.readAsText(file);
}

// ---------- wire up ----------
addForm.addEventListener('submit', addDoc);
addInput.addEventListener('input', () => addInput.classList.remove('invalid'));

modes.addEventListener('change', () => {
  const r = modes.querySelector('input[name="mode"]:checked');
  if (r) { flushPendingSave(); setMode(r.value); }
});

refreshBtn.addEventListener('click', refreshLive);
openExtBtn.addEventListener('click', openInGoogleDocs);
resetBtn.addEventListener('click', resetCopy);
selectAllBtn.addEventListener('click', selectAllCopy);
if (downloadBtn) downloadBtn.addEventListener('click', downloadCopyAsWord);
if (printBtn) printBtn.addEventListener('click', printCopy);

themeToggle.addEventListener('click', toggleTheme);
accentBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const willOpen = accentMenu.hidden;
  accentMenu.hidden = !willOpen;
  accentBtn.setAttribute('aria-expanded', String(willOpen));
});
document.addEventListener('click', (e) => {
  if (!accentMenu.hidden && !accentMenu.contains(e.target) && !accentBtn.contains(e.target)) {
    accentMenu.hidden = true;
    accentBtn.setAttribute('aria-expanded', 'false');
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !accentMenu.hidden) {
    accentMenu.hidden = true;
    accentBtn.setAttribute('aria-expanded', 'false');
  }
});

exportBtn.addEventListener('click', exportBackup);
importBtn.addEventListener('click', importDocs);
importInput.addEventListener('change', onImportFile);

// ---------- init ----------
migrateCopies();
applyAccent(storedAccent()); // re-assert accent (and correct ink) after load
buildSwatches();
renderList();
if (docs.length > 0) {
  openDoc(docs[0].id);
} else {
  welcome.hidden = false;
  viewer.hidden = true;
}
