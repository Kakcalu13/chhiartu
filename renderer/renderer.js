/* global DOMPurify, mermaid */
const api = window.md;

const el = {
  content: document.getElementById('content'),
  dropzone: document.getElementById('dropzone'),
  previewPane: document.getElementById('preview-pane'),
  editorPane: document.getElementById('editor-pane'),
  editor: document.getElementById('editor'),
  title: document.getElementById('doc-title'),
  back: document.getElementById('btn-back'),
  open: document.getElementById('btn-open'),
  reveal: document.getElementById('btn-reveal'),
  theme: document.getElementById('btn-theme'),
  save: document.getElementById('btn-save'),
  seg: document.getElementById('mode-seg'),
  modePreview: document.getElementById('mode-preview'),
  modeEdit: document.getElementById('mode-edit'),
  dzOpen: document.getElementById('dz-open'),
  ghLight: document.getElementById('gh-light'),
  ghDark: document.getElementById('gh-dark'),
  hlLight: document.getElementById('hl-light'),
  hlDark: document.getElementById('hl-dark'),
};

let current = null; // { path, dir, name, title, html, text }
const history = [];
let mode = 'preview'; // 'preview' | 'edit'
let dirty = false;

// ---------------- Theme ----------------
const media = window.matchMedia('(prefers-color-scheme: dark)');
let themeMode = localStorage.getItem('themeMode') || 'auto';

function effectiveDark() {
  if (themeMode === 'dark') return true;
  if (themeMode === 'light') return false;
  return media.matches;
}
function applyTheme() {
  const dark = effectiveDark();
  document.body.dataset.theme = dark ? 'dark' : 'light';
  el.ghLight.disabled = dark;
  el.ghDark.disabled = !dark;
  el.hlLight.disabled = dark;
  el.hlDark.disabled = !dark;
  el.theme.textContent = themeMode.charAt(0).toUpperCase() + themeMode.slice(1);
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: dark ? 'dark' : 'default',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  });
  renderMermaid();
}
el.theme.addEventListener('click', () => {
  themeMode = themeMode === 'auto' ? 'light' : themeMode === 'light' ? 'dark' : 'auto';
  localStorage.setItem('themeMode', themeMode);
  applyTheme();
});
media.addEventListener('change', () => { if (themeMode === 'auto') applyTheme(); });

// ---------------- Mermaid ----------------
function renderMermaid() {
  const nodes = [...el.content.querySelectorAll('pre.mermaid')];
  if (!nodes.length) return;
  for (const n of nodes) {
    if (n.dataset.src === undefined) n.dataset.src = n.textContent;
    n.removeAttribute('data-processed');
    n.innerHTML = '';
    n.textContent = n.dataset.src;
  }
  try {
    mermaid.run({ nodes }).catch((e) => console.warn('mermaid render failed:', e));
  } catch (e) {
    console.warn('mermaid run error:', e);
  }
}

// ---------------- HTML injection ----------------
function decorate() {
  const dir = current ? current.dir : '';
  el.content.querySelectorAll('img[src], source[src], video[src], audio[src]').forEach((node) => {
    const src = node.getAttribute('src');
    if (!src || /^(https?:|data:|blob:|file:)/i.test(src)) return;
    const abs = api.resolveRelative(dir, src);
    if (abs) node.setAttribute('src', api.fileUrl(abs));
  });
  el.content.querySelectorAll('li > input[type="checkbox"]').forEach((cb) => {
    const li = cb.closest('li');
    if (li) li.classList.add('task-list-item');
    const list = cb.closest('ul');
    if (list) list.classList.add('contains-task-list');
  });
}

function renderHtml(html) {
  const clean = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'align', 'id', 'start'],
    ADD_TAGS: ['input'],
  });
  el.content.innerHTML = clean;
  el.content.hidden = false;
  el.dropzone.style.display = 'none';
  decorate();
  renderMermaid();
}

// ---------------- Chrome / state ----------------
function displayName() {
  if (!current) return '';
  return (dirty ? '• ' : '') + current.name;
}
function refreshChrome() {
  const has = !!current;
  el.seg.hidden = !has;
  el.reveal.disabled = !has;
  el.back.disabled = history.length === 0;
  el.save.hidden = mode !== 'edit';
  el.save.disabled = !dirty;
  el.title.textContent = displayName();
  if (current) {
    el.title.title = current.path;
    document.title = displayName() + ' — Markdown Viewer';
  } else {
    document.title = 'Markdown Viewer';
  }
}
function setDirty(v) {
  dirty = v;
  refreshChrome();
}

// ---------------- Mode ----------------
function setMode(m) {
  if (!current && m === 'edit') return;
  mode = m;
  document.body.classList.toggle('mode-edit', m === 'edit');
  el.modePreview.classList.toggle('active', m === 'preview');
  el.modeEdit.classList.toggle('active', m === 'edit');
  if (m === 'edit') {
    if (current && el.editor.value !== current.text) el.editor.value = current.text;
    refreshChrome();
    el.editor.focus();
  } else {
    refreshChrome();
  }
}
el.modePreview.addEventListener('click', () => setMode('preview'));
el.modeEdit.addEventListener('click', () => setMode('edit'));

// ---------------- Live editing ----------------
let renderTimer = null;
el.editor.addEventListener('input', () => {
  if (!current) return;
  current.text = el.editor.value;
  if (!dirty) setDirty(true);
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    const top = el.previewPane.scrollTop;
    renderHtml(api.render(current.text));
    el.previewPane.scrollTop = top;
  }, 150);
});
// Tab inserts two spaces instead of leaving the field.
el.editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    const s = el.editor.selectionStart;
    const en = el.editor.selectionEnd;
    el.editor.setRangeText('  ', s, en, 'end');
    el.editor.dispatchEvent(new Event('input'));
  }
});

function saveFile() {
  if (!current || !dirty) return;
  const res = api.writeFile(current.path, current.text);
  if (res && res.ok) {
    setDirty(false);
  } else {
    alert('Could not save file:\n' + (res && res.error ? res.error : 'unknown error'));
  }
}
el.save.addEventListener('click', saveFile);

// ---------------- Load a document ----------------
function renderDoc(doc) {
  current = doc;
  renderHtml(doc.html);
}
function showError(message, filePath) {
  el.content.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'error-card';
  const h = document.createElement('h2');
  h.textContent = 'Could not open file';
  const p = document.createElement('p');
  p.textContent = filePath || '';
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = message;
  pre.appendChild(code);
  card.append(h, p, pre);
  el.content.appendChild(card);
  el.content.hidden = false;
  el.dropzone.style.display = 'none';
}

function loadPath(filePath, pushHistory) {
  if (!filePath) return;
  const doc = api.readAndRender(filePath);
  if (doc && doc.error) { showError(doc.error, filePath); return; }

  if (pushHistory && current && current.path && current.path !== filePath) {
    history.push(current.path);
  }
  const keepScroll = current && current.path === filePath ? el.previewPane.scrollTop : 0;

  if (current && current.path) api.unwatch(current.path);
  renderDoc(doc);
  el.editor.value = doc.text;
  dirty = false;
  refreshChrome();
  el.previewPane.scrollTop = keepScroll;

  api.watch(filePath, (updated) => {
    if (!current || current.path !== filePath) return;
    if (updated.text === current.text) return; // our own save, or no real change
    if (dirty) return;                          // don't clobber unsaved edits
    const top = el.previewPane.scrollTop;
    current = updated;
    el.editor.value = updated.text;
    renderHtml(updated.html);
    refreshChrome();
    el.previewPane.scrollTop = top;
  });
}

// ---------------- Link handling ----------------
el.content.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href) return;
  e.preventDefault();
  if (href.startsWith('#')) {
    const id = decodeURIComponent(href.slice(1));
    const target = document.getElementById(id) || el.content.querySelector(`[name="${CSS.escape(id)}"]`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (/^(https?:|mailto:)/i.test(href)) { api.openExternal(href); return; }
  const abs = api.resolveRelative(current ? current.dir : '', href);
  if (abs && api.exists(abs)) {
    if (api.isMarkdown(abs)) loadPath(abs, true);
    else api.openExternal(api.fileUrl(abs));
  }
});

// ---------------- Drag & drop ----------------
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
window.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
window.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) document.body.classList.remove('dragging');
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  const p = api.pathForFile(file);
  if (p) loadPath(p, true);
});

// ---------------- Toolbar ----------------
async function pickAndOpen() {
  const p = await api.pickFile();
  if (p) loadPath(p, true);
}
el.open.addEventListener('click', pickAndOpen);
el.dzOpen.addEventListener('click', pickAndOpen);
el.reveal.addEventListener('click', () => { if (current) api.showItem(current.path); });
el.back.addEventListener('click', () => {
  const prev = history.pop();
  refreshChrome();
  if (prev) loadPath(prev, false);
});

// ---------------- Menu + external open events ----------------
api.onMenu((action) => {
  if (action === 'open') pickAndOpen();
  else if (action === 'toggle-theme') el.theme.click();
  else if (action === 'reload-file' && current) loadPath(current.path, false);
  else if (action === 'save') saveFile();
  else if (action === 'toggle-edit') setMode(mode === 'edit' ? 'preview' : 'edit');
});
api.onOpenPath((p) => loadPath(p, true));

// ---------------- Init ----------------
applyTheme();
refreshChrome();
api.rendererReady();
