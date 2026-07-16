/* global DOMPurify, mermaid */
const api = window.md;

const $ = (id) => document.getElementById(id);
const el = {
  body: document.body,
  titlebarFile: $('tb-file'),
  sidebar: $('sidebar'),
  resizer: $('sb-resizer'),
  brandName: $('brand-name'),
  brandVersion: $('brand-version'),
  tree: $('tree'),
  statusCard: $('status-card'),
  statusLabel: $('status-label'),
  statusBadge: $('status-badge'),
  statusModified: $('status-modified'),
  panes: $('panes'),
  paneTpl: $('pane-tpl'),
  crumbs: $('crumbs'),
  progressFill: $('progress-fill'),
  editor: $('editor'),
  editorPath: $('editor-path'),
  palette: $('palette'),
  paletteScrim: $('palette-scrim'),
  paletteInput: $('palette-input'),
  paletteResults: $('palette-results'),
  paletteCount: $('palette-count'),
  lightbox: $('lightbox'),
  lightboxImg: $('lightbox-img'),
  lightboxCap: $('lightbox-cap'),
  toast: $('toast'),
  btn: {
    sidebar: $('btn-sidebar'), toc: $('btn-toc'), focus: $('btn-focus'), split: $('btn-split'),
    back: $('btn-back'), forward: $('btn-forward'),
    theme: $('btn-theme'), print: $('btn-print'), export: $('btn-export'),
    edit: $('btn-edit'), editLabel: $('btn-edit-label'),
    save: $('btn-save'), closeEdit: $('btn-close-edit'),
    search: $('sb-search'),
  },
};

// ---------------------------------------------------------------- state ----
// A pane owns a tab strip, a reading canvas, and its own history. There is one
// normally and two when split; the toolbar and sidebar always act on `active`.
let panes = [];
let active = null;
let split = false;

let root = null;   // workspace root directory
let tree = null;   // scanned folder tree
let files = [];    // depth-first flat list of files in `tree`
let index = [];    // search index, built lazily
let indexed = false;
let editing = false;

const store = {
  get(k, fallback) {
    try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota */ } },
};

let sidebarVisible = store.get('sidebarVisible', true);
let tocVisible = store.get('tocVisible', true);

function toast(msg) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.toast.hidden = true; }, 1600);
}

function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

function icon(name, cls) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', cls || 'icon');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#' + name);
  svg.appendChild(use);
  return svg;
}

const curTab = (p) => (p && p.activeTab >= 0 ? p.tabs[p.activeTab] : null);
const curDoc = (p) => { const t = curTab(p); return t ? t.doc : null; };

// ---------------------------------------------------------------- theme ----
const media = window.matchMedia('(prefers-color-scheme: dark)');
let themeMode = store.get('themeMode', 'auto');

function effectiveDark() {
  if (themeMode === 'dark') return true;
  if (themeMode === 'light') return false;
  return media.matches;
}

function applyTheme() {
  const dark = effectiveDark();
  el.body.dataset.theme = dark ? 'dark' : 'light';
  api.setNativeTheme(themeMode === 'auto' ? 'system' : themeMode);
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: dark ? 'dark' : 'default',
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
  });
  for (const p of panes) renderMermaid(p);
}

el.btn.theme.addEventListener('click', () => {
  themeMode = themeMode === 'auto' ? (effectiveDark() ? 'light' : 'dark') : (themeMode === 'dark' ? 'light' : 'dark');
  store.set('themeMode', themeMode);
  applyTheme();
});
media.addEventListener('change', () => { if (themeMode === 'auto') applyTheme(); });

// -------------------------------------------------------------- mermaid ----
function renderMermaid(p) {
  const nodes = [...p.content.querySelectorAll('pre.mermaid')];
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

// ------------------------------------------------------------- decorate ----
// Everything that turns sanitized markdown HTML into the reading surface.
// Runs on the live DOM after sanitizing, so no markup is trusted from source.

function decorateHeadings(p) {
  let h2n = 0;
  p.content.querySelectorAll('h1, h2, h3, h4').forEach((h) => {
    if (h.tagName === 'H2') {
      const badge = document.createElement('span');
      badge.className = 'h2-badge';
      badge.textContent = String(++h2n);
      badge.setAttribute('aria-hidden', 'true');
      h.dataset.hue = String((h2n - 1) % 5);
      h.dataset.num = String(h2n);
      h.prepend(badge);
    }
    if (!h.id) return;
    const a = document.createElement('button');
    a.type = 'button';
    a.className = 'h-anchor';
    a.title = 'Copy link to this heading';
    a.dataset.anchor = h.id;
    a.appendChild(icon('i-hash'));
    h.appendChild(a);
  });

  const h1 = p.content.querySelector('h1');
  if (h1) {
    const mark = document.createElement('span');
    mark.className = 'h1-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.appendChild(icon('i-doc'));
    h1.prepend(mark);
  }
}

function metaItem(iconName, text, title) {
  const s = document.createElement('span');
  s.className = 'mi';
  if (iconName) s.appendChild(icon(iconName));
  const t = document.createElement('span');
  t.textContent = text;
  s.appendChild(t);
  if (title) s.title = title;
  return s;
}

function buildDocMeta(p, doc, git) {
  const h1 = p.content.querySelector('h1');
  if (!h1) return;
  const row = document.createElement('div');
  row.className = 'doc-meta';

  const status = doc.meta && (doc.meta.status || doc.meta.state);
  if (status) {
    const s = document.createElement('span');
    s.className = 'mi mi-status';
    s.textContent = status;
    row.appendChild(s);
  }
  row.appendChild(metaItem('i-clock', `${doc.minutes} min read`));
  row.appendChild(metaItem(null, `${doc.words.toLocaleString()} words`));
  if (doc.meta && doc.meta.author) row.appendChild(metaItem(null, doc.meta.author));
  row.appendChild(metaItem(null, `Updated ${fmtDate(doc.mtime)}`));
  if (git && git.branch) {
    row.appendChild(metaItem('i-branch', git.sha ? `${git.branch} · ${git.sha}` : git.branch, 'Git revision'));
  }

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mi-path';
  btn.textContent = root ? api.relative(root, doc.path) || doc.name : doc.path;
  btn.title = 'Reveal in Finder\n' + doc.path;
  btn.addEventListener('click', () => api.showItem(doc.path));
  row.appendChild(btn);

  h1.after(row);
}

function decorateTables(p) {
  p.content.querySelectorAll('table').forEach((table) => {
    if (table.parentElement.classList.contains('table-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
    const ths = [...table.querySelectorAll('thead th')];
    ths.forEach((th, i) => {
      if (i === ths.length - 1) return;
      const grip = document.createElement('span');
      grip.className = 'col-grip';
      grip.addEventListener('mousedown', (e) => startColResize(e, table, th, grip));
      th.appendChild(grip);
    });
  });
}

function startColResize(e, table, th, grip) {
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX;
  const startW = th.getBoundingClientRect().width;
  // Freeze every column at its current width before switching to fixed layout,
  // or the browser redistributes them all on the first drag pixel.
  if (!table.dataset.fixed) {
    const ths = [...table.querySelectorAll('thead th')];
    const widths = ths.map((c) => c.getBoundingClientRect().width);
    table.style.width = table.getBoundingClientRect().width + 'px';
    ths.forEach((c, i) => { c.style.width = widths[i] + 'px'; });
    table.style.tableLayout = 'fixed';
    table.dataset.fixed = '1';
  }
  el.body.classList.add('col-resizing');
  grip.classList.add('active');

  const move = (ev) => { th.style.width = Math.max(64, startW + (ev.clientX - startX)) + 'px'; };
  const up = () => {
    el.body.classList.remove('col-resizing');
    grip.classList.remove('active');
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

function decorateImages(p) {
  p.content.querySelectorAll('img').forEach((img) => {
    if (img.closest('figure')) return;
    const parent = img.parentElement;
    const fig = document.createElement('figure');
    fig.className = 'img';
    // An image alone in a paragraph becomes the figure; inline ones stay put.
    const alone = parent.tagName === 'P' && parent.childNodes.length === 1;
    (alone ? parent : img).replaceWith(fig);
    fig.appendChild(img);
    const cap = img.getAttribute('title') || img.getAttribute('alt');
    if (cap) {
      const c = document.createElement('figcaption');
      c.textContent = cap;
      fig.appendChild(c);
    }
    img.addEventListener('click', () => openLightbox(img));
  });
}

function decorateCode(p) {
  p.content.querySelectorAll('figure.code-card').forEach((card) => {
    const scroll = card.querySelector('.code-scroll');
    if (!scroll || scroll.scrollHeight <= 460) return;
    card.classList.add('foldable');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'code-fold';
    btn.textContent = 'Expand';
    btn.addEventListener('click', () => {
      btn.textContent = card.classList.toggle('open') ? 'Collapse' : 'Expand';
    });
    card.appendChild(btn);
  });
}

function decorateTasks(p) {
  p.content.querySelectorAll('li > input[type="checkbox"]').forEach((cb) => {
    const li = cb.closest('li');
    if (!li) return;
    li.classList.add('task');
    if (cb.checked) li.classList.add('done');
    cb.disabled = true;
  });
}

function decorateMedia(p, doc) {
  p.content.querySelectorAll('img[src], source[src], video[src], audio[src]').forEach((node) => {
    const src = node.getAttribute('src');
    if (!src || /^(https?:|data:|blob:|file:)/i.test(src)) return;
    const abs = api.resolveRelative(doc.dir, src);
    if (abs) node.setAttribute('src', api.fileUrl(abs));
  });
}

// MathML rides along for accessibility and copy-paste, so it must survive
// sanitizing; without the profile DOMPurify strips <math> and math vanishes.
const SANITIZE = {
  USE_PROFILES: { html: true, svg: true, mathMl: true },
  ADD_TAGS: ['input', 'button', 'figure', 'figcaption'],
  ADD_ATTR: ['target', 'align', 'id', 'start', 'type', 'checked', 'disabled', 'rel', 'viewBox'],
};

function renderDocInto(p, doc, git) {
  p.content.innerHTML = DOMPurify.sanitize(doc.html, SANITIZE);
  p.content.hidden = false;
  decorateMedia(p, doc);
  decorateHeadings(p);
  buildDocMeta(p, doc, git);
  decorateTables(p);
  decorateImages(p);
  decorateTasks(p);
  renderMermaid(p);
  // After mermaid so a tall diagram isn't mistaken for a long code block.
  decorateCode(p);
}

// ------------------------------------------------------------------ TOC ----
function headingText(h) {
  const clone = h.cloneNode(true);
  clone.querySelectorAll('.h2-badge, .h-anchor, .h1-mark').forEach((n) => n.remove());
  return clone.textContent.trim();
}

function buildToc(p) {
  p.tocList.innerHTML = '';
  p.tocEntries = [];
  const heads = [...p.content.querySelectorAll('h1, h2, h3, h4')].filter((h) => h.id);
  // The first H1 is the document title — it's already the breadcrumb leaf.
  const first = p.content.querySelector('h1');
  const list = heads.filter((h) => h !== first);

  p.toc.hidden = !list.length;
  if (!list.length) { applyPanels(); return; }

  for (const h of list) {
    const li = document.createElement('li');
    li.className = 'lvl-' + h.tagName[1];
    const a = document.createElement('a');
    a.href = '#' + h.id;
    a.textContent = (h.dataset.num ? h.dataset.num + '. ' : '') + headingText(h);
    li.appendChild(a);
    p.tocList.appendChild(li);
    p.tocEntries.push({ h, li });
  }
  applyPanels();
  updateToc(p);
}

function updateToc(p) {
  const top = p.scroller.scrollTop;
  const max = p.scroller.scrollHeight - p.scroller.clientHeight;
  const pct = max > 4 ? Math.min(100, Math.max(0, (top / max) * 100)) : (curDoc(p) ? 100 : 0);
  if (p === active) el.progressFill.style.width = pct + '%';

  if (!p.tocEntries.length) return;
  const line = top + 110;
  let current = p.tocEntries[0];
  for (const e of p.tocEntries) {
    if (e.h.offsetTop <= line) current = e;
    else break;
  }
  // Near the bottom the last section wins, however tall it is.
  if (max > 4 && top >= max - 4) current = p.tocEntries[p.tocEntries.length - 1];

  for (const e of p.tocEntries) e.li.classList.toggle('active', e === current);
  p.tocFoot.textContent = `${Math.round(pct)}% read`;
}

// ----------------------------------------------------------------- tabs ----
function renderTabs(p) {
  p.tabsEl.innerHTML = '';
  p.tabs.forEach((tab, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab' + (i === p.activeTab ? ' active' : '') + (tab.pinned ? ' pinned' : '');
    b.setAttribute('role', 'tab');
    b.title = tab.path;
    b.appendChild(icon(tab.pinned ? 'i-pin' : 'i-file'));

    if (!tab.pinned) {
      const label = document.createElement('span');
      label.className = 'tab-label';
      // Unvisited tabs have no doc yet, so fall back to the same name the
      // sidebar uses rather than a raw filename.
      label.textContent = tab.doc ? tab.doc.title : api.titleize(api.basename(tab.path));
      b.appendChild(label);

      const x = document.createElement('span');
      x.className = 'tab-close';
      x.title = 'Close tab (⌘W)';
      x.appendChild(icon('i-close'));
      x.addEventListener('click', (e) => { e.stopPropagation(); closeTab(p, i); });
      b.appendChild(x);
    }

    b.addEventListener('click', () => { setActivePane(p); activateTab(p, i); });
    // Middle-click closes, matching every browser.
    b.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); closeTab(p, i); } });
    b.addEventListener('dblclick', () => togglePin(p, i));
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); togglePin(p, i); });
    p.tabsEl.appendChild(b);
  });
}

// Pinned tabs live at the front, in pin order; the rest keep their own order.
function sortTabs(p) {
  const keep = curTab(p);
  p.tabs.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  p.activeTab = keep ? p.tabs.indexOf(keep) : -1;
}

function togglePin(p, i) {
  const tab = p.tabs[i];
  if (!tab) return;
  tab.pinned = !tab.pinned;
  sortTabs(p);
  renderTabs(p);
  saveSession();
  toast(tab.pinned ? 'Pinned' : 'Unpinned');
}

function activateTab(p, i, opts = {}) {
  const prev = curTab(p);
  if (prev && p.tabs[i] !== prev) prev.scrollTop = p.scroller.scrollTop;
  if (i < 0 || i >= p.tabs.length) { p.activeTab = -1; renderPane(p); return; }
  p.activeTab = i;
  renderPane(p, opts);
  renderTabs(p);
  saveSession();
}

function closeTab(p, i) {
  const tab = p.tabs[i];
  if (!tab) return;
  if (p.dirty && i === p.activeTab && !confirm('Discard unsaved changes?')) return;
  p.tabs.splice(i, 1);
  if (p.activeTab >= p.tabs.length) p.activeTab = p.tabs.length - 1;
  else if (i < p.activeTab) p.activeTab--;
  releaseUnwatched();
  // An empty second pane has no reason to exist.
  if (!p.tabs.length && split && panes.length > 1) { setSplit(false, p); return; }
  renderTabs(p);
  renderPane(p);
  saveSession();
}

function openInPane(p, filePath, opts = {}) {
  if (!filePath) return;
  setActivePane(p);

  // A document already open is focused, never opened twice — otherwise opening
  // the same file from Finder repeatedly stacks identical tabs. This check has
  // to come before the newTab branch, or `newTab` would skip straight past it.
  const existing = p.tabs.findIndex((t) => t.path === filePath);
  if (existing >= 0) { activateTab(p, existing, opts); return; }

  const cur = curTab(p);
  // A pinned tab is a promise the document stays put, so navigation forks a
  // new tab instead of replacing it.
  const newTab = opts.newTab || !cur || cur.pinned;

  if (!newTab && cur) {
    if (cur.path !== filePath) { p.back.push(cur.path); p.forward.length = 0; }
    cur.path = filePath;
    cur.doc = null;
    cur.scrollTop = 0;
  } else {
    p.tabs.push({ path: filePath, pinned: false, scrollTop: 0, doc: null });
    sortTabs(p);
    p.activeTab = p.tabs.findIndex((t) => t.path === filePath);
  }
  renderPane(p, opts);
  renderTabs(p);
  pushRecent(filePath);
  saveSession();
}

// ------------------------------------------------------------- rendering ---
function showError(p, message, filePath) {
  p.content.innerHTML = '';
  p.content.hidden = false;
  const c = document.createElement('div');
  c.className = 'callout callout-danger';
  const body = document.createElement('div');
  body.className = 'callout-body';
  const t = document.createElement('p');
  t.className = 'callout-title';
  t.textContent = 'Could not open this file';
  const path = document.createElement('p');
  path.textContent = filePath || '';
  const pre = document.createElement('pre');
  pre.textContent = message;
  body.append(t, path, pre);
  c.appendChild(body);
  p.content.appendChild(c);
  p.toc.hidden = true;
  p.pager.hidden = true;
}

function renderPane(p, opts = {}) {
  const tab = curTab(p);
  p.root.classList.toggle('empty', !tab);

  if (!tab) {
    p.content.hidden = true;
    p.content.innerHTML = '';
    p.toc.hidden = true;
    p.pager.hidden = true;
    p.tocEntries = [];
    renderWelcomeRecent(p);
    refreshChrome();
    return;
  }

  if (!tab.doc) {
    const doc = api.readAndRender(tab.path);
    if (doc && doc.error) {
      showError(p, doc.error, tab.path);
      refreshChrome();
      return;
    }
    tab.doc = doc;
  }
  const doc = tab.doc;
  const git = api.gitInfo(doc.dir);

  if (!root || !doc.path.startsWith(root)) setRoot(api.rootForFile(doc.path));

  p.root.classList.add('fading');
  setTimeout(() => {
    renderDocInto(p, doc, git);
    buildToc(p);
    buildPager(p);
    if (p === active) { buildCrumbs(); refreshStatusCard(doc, git); }
    revealInTree(doc.path);
    renderTree();
    if (p === active) el.editor.value = doc.text;
    refreshChrome();

    // Jump without animating the scroll on a fresh document.
    const prev = p.scroller.style.scrollBehavior;
    p.scroller.style.scrollBehavior = 'auto';
    p.scroller.scrollTop = opts.keepScroll ? p.scroller.scrollTop : (tab.scrollTop || 0);
    p.scroller.style.scrollBehavior = prev;

    p.root.classList.remove('fading');
    updateToc(p);
    if (opts.hash) scrollToId(p, opts.hash);
  }, 150);

  ensureWatch(tab.path);
}

// --------------------------------------------------------------- watching --
const watched = new Set();

function ensureWatch(path) {
  if (watched.has(path)) return;
  watched.add(path);
  api.watch(path, onFileChanged);
}

// Drop watches for files no pane has open any more.
function releaseUnwatched() {
  const live = new Set();
  for (const p of panes) for (const t of p.tabs) live.add(t.path);
  for (const path of [...watched]) {
    if (!live.has(path)) { api.unwatch(path); watched.delete(path); }
  }
}

function onFileChanged(updated) {
  for (const p of panes) {
    let hit = false;
    for (const t of p.tabs) {
      if (t.path !== updated.path) continue;
      if (t.doc && t.doc.text === updated.text) continue; // our own save
      t.doc = updated;
      hit = true;
    }
    const tab = curTab(p);
    if (!hit || !tab || tab.path !== updated.path) continue;
    if (p.dirty) continue; // don't clobber unsaved edits
    renderPane(p, { keepScroll: true });
    toast('Reloaded from disk');
  }
}

// -------------------------------------------------------------- workspace --
function setRoot(dir, force) {
  if (!dir || (root === dir && !force)) return;
  root = dir;
  tree = api.scanTree(dir);
  if (tree.error) { tree = null; files = []; return; }
  files = api.flattenFiles(tree);
  indexed = false;
  index = [];
  el.brandName.textContent = tree.label || api.basename(dir);
  el.brandName.title = dir;
  const v = api.projectVersion(dir);
  el.brandVersion.textContent = v || '';
  el.brandVersion.hidden = !v;
  renderTree();
}

function refreshStatusCard(doc, git) {
  el.statusCard.hidden = !doc;
  if (!doc) return;
  const status = doc.meta && (doc.meta.status || doc.meta.state);
  el.statusLabel.textContent = status ? 'Status' : git && git.branch ? 'Revision' : 'Document';
  el.statusBadge.textContent = '';
  el.statusBadge.title = '';
  if (status) {
    const dot = document.createElement('span');
    dot.className = 'status-dot';
    el.statusBadge.append(dot, document.createTextNode(status));
  } else if (git && git.branch) {
    // Branch names get long ("feature/tighten-design"); let the name ellipsize
    // and keep the sha, rather than letting the name shove the sha out.
    const b = document.createElement('span');
    b.className = 'git-branch';
    b.textContent = git.branch;
    el.statusBadge.append(icon('i-branch'), b);
    if (git.sha) {
      const s = document.createElement('span');
      s.className = 'git-sha';
      s.textContent = git.sha;
      el.statusBadge.appendChild(s);
    }
    el.statusBadge.title = git.sha ? `${git.branch} · ${git.sha}` : git.branch;
  } else {
    el.statusBadge.textContent = `${doc.minutes} min · ${doc.words.toLocaleString()} words`;
  }
  el.statusModified.textContent = fmtDate(doc.mtime);
}

// ---------------------------------------------------------------- sidebar --
const expanded = new Set(store.get('expandedDirs', []));

function treeFileRow(path, label) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tree-row';
  btn.dataset.path = path;
  btn.appendChild(icon('i-file'));
  const t = document.createElement('span');
  t.className = 'tree-text';
  t.textContent = label;
  btn.appendChild(t);
  const dot = document.createElement('span');
  dot.className = 'tree-dot';
  btn.appendChild(dot);
  btn.title = path;
  btn.addEventListener('click', (e) => openInPane(active, path, { newTab: e.metaKey || e.ctrlKey }));
  return btn;
}

function renderTree() {
  el.tree.innerHTML = '';
  if (!tree) return;
  const openPath = curDoc(active) ? curDoc(active).path : null;

  // The open document is already highlighted in the tree below — listing it up
  // here too just says the same thing twice.
  const recents = store.get('recents', [])
    .filter((p) => api.exists(p) && p !== openPath)
    .slice(0, 4);
  if (recents.length) {
    const g = document.createElement('div');
    g.className = 'tree-group';
    const lbl = document.createElement('div');
    lbl.className = 'tree-label';
    lbl.textContent = 'Recent';
    g.appendChild(lbl);
    for (const path of recents) g.appendChild(treeFileRow(path, api.titleize(api.basename(path))));
    el.tree.appendChild(g);
  }

  const g = document.createElement('div');
  g.className = 'tree-group';
  const lbl = document.createElement('div');
  lbl.className = 'tree-label';
  lbl.textContent = tree.label || 'Documents';
  g.appendChild(lbl);
  g.appendChild(renderNodes(tree.children));
  el.tree.appendChild(g);
  markCurrentInTree();
}

function renderNodes(nodes) {
  const frag = document.createDocumentFragment();
  for (const node of nodes) {
    if (node.type === 'file') { frag.appendChild(treeFileRow(node.path, node.label)); continue; }

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'tree-row';
    row.dataset.path = node.path;
    row.setAttribute('aria-expanded', String(expanded.has(node.path)));
    row.appendChild(icon('i-chevron', 'icon tree-twist'));
    const t = document.createElement('span');
    t.className = 'tree-text';
    t.textContent = node.label;
    row.appendChild(t);
    frag.appendChild(row);

    const kids = document.createElement('div');
    kids.className = 'tree-children';
    kids.appendChild(renderNodes(node.children));
    kids.hidden = !expanded.has(node.path);
    frag.appendChild(kids);

    row.addEventListener('click', () => {
      const open = !expanded.has(node.path);
      if (open) expanded.add(node.path);
      else expanded.delete(node.path);
      row.setAttribute('aria-expanded', String(open));
      kids.hidden = !open;
      store.set('expandedDirs', [...expanded]);
    });
  }
  return frag;
}

function markCurrentInTree() {
  // Every document open in any pane is marked; the active one gets the dot.
  const open = new Set();
  for (const p of panes) for (const t of p.tabs) open.add(t.path);
  const activePath = curDoc(active) ? curDoc(active).path : null;
  el.tree.querySelectorAll('.tree-row').forEach((r) => {
    const path = r.dataset.path;
    r.classList.toggle('open-elsewhere', open.has(path) && path !== activePath);
    r.classList.toggle('current', path === activePath);
  });
  const cur = el.tree.querySelector('.tree-row.current');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}

// Open every folder on the path to a file, so it's visible.
function revealInTree(filePath) {
  if (!root) return;
  let dir = api.dirname(filePath);
  let changed = false;
  while (dir && dir.startsWith(root) && dir !== root) {
    if (!expanded.has(dir)) { expanded.add(dir); changed = true; }
    dir = api.dirname(dir);
  }
  if (changed) store.set('expandedDirs', [...expanded]);
}

// ----------------------------------------------------------------- chrome --
function buildCrumbs() {
  el.crumbs.innerHTML = '';
  const doc = curDoc(active);
  if (!doc) return;
  const parts = [];
  if (root) {
    const rel = api.relative(root, doc.path);
    parts.push({ label: tree ? tree.label : api.basename(root), path: root });
    if (rel && !rel.startsWith('..')) {
      const segs = rel.split(api.sep);
      let acc = root;
      segs.forEach((s, i) => {
        acc = acc + api.sep + s;
        const leaf = i === segs.length - 1;
        parts.push({ label: leaf ? doc.title : s, path: acc, leaf });
      });
    } else {
      parts.push({ label: doc.title, path: doc.path, leaf: true });
    }
  } else {
    parts.push({ label: doc.title, path: doc.path, leaf: true });
  }

  parts.forEach((part, i) => {
    if (i) {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = '/';
      el.crumbs.appendChild(sep);
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'crumb' + (part.leaf ? ' leaf' : '');
    b.textContent = part.label;
    b.title = part.path;
    if (part.leaf) b.addEventListener('click', () => api.showItem(doc.path));
    else b.addEventListener('click', () => {
      if (part.path !== root && !expanded.has(part.path)) {
        expanded.add(part.path);
        store.set('expandedDirs', [...expanded]);
        renderTree();
      }
    });
    el.crumbs.appendChild(b);
  });
}

function buildPager(p) {
  p.pager.innerHTML = '';
  const doc = curDoc(p);
  if (!doc || !files.length) { p.pager.hidden = true; return; }
  const i = files.findIndex((f) => f.path === doc.path);
  if (i < 0) { p.pager.hidden = true; return; }
  const prev = files[i - 1];
  const next = files[i + 1];
  if (!prev && !next) { p.pager.hidden = true; return; }
  p.pager.hidden = false;

  const mk = (node, dir) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pager-btn ' + dir;
    b.appendChild(icon(dir === 'prev' ? 'i-back' : 'i-forward'));
    const txt = document.createElement('span');
    txt.className = 'pager-txt';
    const l = document.createElement('span');
    l.className = 'pager-lbl';
    l.textContent = dir === 'prev' ? 'Previous' : 'Next';
    const n = document.createElement('span');
    n.className = 'pager-name';
    n.textContent = node.label;
    txt.append(l, n);
    b.appendChild(txt);
    b.addEventListener('click', () => openInPane(p, node.path));
    return b;
  };
  if (prev) p.pager.appendChild(mk(prev, 'prev'));
  if (next) p.pager.appendChild(mk(next, 'next'));
}

function refreshChrome() {
  const doc = curDoc(active);
  const has = !!doc;
  el.body.classList.toggle('no-doc', !has);
  el.btn.back.disabled = !active || !active.back.length;
  el.btn.forward.disabled = !active || !active.forward.length;
  el.btn.print.disabled = !has;
  el.btn.export.disabled = !has;
  el.btn.edit.disabled = !has;
  el.btn.save.disabled = !active || !active.dirty;
  el.btn.editLabel.textContent = editing ? (active && active.dirty ? 'Unsaved' : 'Editing') : 'Edit Source';
  el.btn.edit.classList.toggle('on', editing);
  el.btn.split.classList.toggle('on', split);
  if (doc) {
    el.titlebarFile.textContent = (active.dirty ? '• ' : '') + doc.name;
    el.titlebarFile.title = doc.path;
    el.editorPath.textContent = doc.path;
    document.title = doc.title;
  } else {
    el.titlebarFile.textContent = '';
    el.crumbs.innerHTML = '';
    el.statusCard.hidden = true;
    document.title = 'Markdown Viewer';
  }
  markCurrentInTree();
}

function applyPanels() {
  el.body.classList.toggle('no-sidebar', !sidebarVisible);
  el.btn.sidebar.classList.toggle('on', sidebarVisible);
  let anyToc = false;
  for (const p of panes) {
    // Two panes side by side leave no room for a third column.
    const show = tocVisible && !p.toc.hidden && !p.root.classList.contains('narrow');
    p.root.classList.toggle('no-toc', !show);
    if (show) anyToc = true;
  }
  el.btn.toc.classList.toggle('on', anyToc);
}

// ------------------------------------------------------------------ panes --
function createPane() {
  const node = el.paneTpl.content.cloneNode(true);
  const rootEl = node.querySelector('.pane');
  const p = {
    root: rootEl,
    tabsEl: rootEl.querySelector('.tabs'),
    newTabBtn: rootEl.querySelector('.tab-new'),
    scroller: rootEl.querySelector('.pane-scroll'),
    canvas: rootEl.querySelector('.canvas'),
    content: rootEl.querySelector('.doc'),
    pager: rootEl.querySelector('.pager'),
    toc: rootEl.querySelector('.toc'),
    tocList: rootEl.querySelector('.toc-list'),
    tocFoot: rootEl.querySelector('.toc-foot'),
    welcome: rootEl.querySelector('.welcome'),
    welcomeRecent: rootEl.querySelector('.welcome-recent'),
    tabs: [],
    activeTab: -1,
    back: [],
    forward: [],
    tocEntries: [],
    dirty: false,
  };

  let raf = 0;
  p.scroller.addEventListener('scroll', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; updateToc(p); });
  }, { passive: true });

  rootEl.addEventListener('mousedown', () => setActivePane(p), true);
  p.newTabBtn.addEventListener('click', () => { setActivePane(p); newTab(p); });
  p.content.addEventListener('click', (e) => onContentClick(e, p));
  rootEl.querySelector('.welcome-open').addEventListener('click', () => { setActivePane(p); pickAndOpen(); });
  rootEl.querySelector('.welcome-folder').addEventListener('click', () => { setActivePane(p); pickFolder(); });

  // The right rail needs ~940px to exist without crowding the measure.
  new ResizeObserver(() => {
    const narrow = p.root.getBoundingClientRect().width < 940;
    if (narrow === p.root.classList.contains('narrow')) return;
    p.root.classList.toggle('narrow', narrow);
    applyPanels();
  }).observe(rootEl);

  return p;
}

function mountPanes() {
  el.panes.innerHTML = '';
  panes.forEach((p, i) => {
    if (i) {
      const div = document.createElement('div');
      div.className = 'pane-divider';
      div.addEventListener('mousedown', startPaneResize);
      el.panes.appendChild(div);
    }
    el.panes.appendChild(p.root);
  });
  el.body.classList.toggle('split', split);
  for (const p of panes) { renderTabs(p); renderPane(p); }
  applyPanels();
}

function setActivePane(p) {
  if (!p || active === p) return;
  active = p;
  for (const q of panes) q.root.classList.toggle('active-pane', q === p);
  const doc = curDoc(p);
  if (doc) el.editor.value = doc.text;
  buildCrumbs();
  if (doc) refreshStatusCard(doc, api.gitInfo(doc.dir));
  refreshChrome();
  updateToc(p);
}

function setSplit(on, closing) {
  if (on === split) return;
  split = on;
  if (on) {
    const p = createPane();
    panes.push(p);
    // Split the current document so both halves start somewhere useful.
    const doc = curDoc(active);
    if (doc) p.tabs.push({ path: doc.path, pinned: false, scrollTop: 0, doc: null });
    p.activeTab = p.tabs.length - 1;
    mountPanes();
    setActivePane(p);
  } else {
    const survivor = panes.find((p) => p !== closing) || panes[0];
    panes = [survivor];
    active = survivor;
    el.panes.style.removeProperty('--pane-a');
    mountPanes();
    setActivePane(survivor);
  }
  el.btn.split.classList.toggle('on', split);
  saveSession();
  refreshChrome();
}

function startPaneResize(e) {
  e.preventDefault();
  const rect = el.panes.getBoundingClientRect();
  el.body.classList.add('resizing');
  const move = (ev) => {
    const pct = Math.min(75, Math.max(25, ((ev.clientX - rect.left) / rect.width) * 100));
    el.panes.style.setProperty('--pane-a', pct + '%');
  };
  const up = () => {
    el.body.classList.remove('resizing');
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

function newTab(p) {
  const prev = curTab(p);
  if (prev) prev.scrollTop = p.scroller.scrollTop;
  p.activeTab = -1;
  renderTabs(p);
  renderPane(p);
}

// --------------------------------------------------------------- recents ---
function pushRecent(p) {
  const list = store.get('recents', []).filter((x) => x !== p);
  list.unshift(p);
  store.set('recents', list.slice(0, 10));
  for (const pane of panes) renderWelcomeRecent(pane);
}

function renderWelcomeRecent(p) {
  const list = store.get('recents', []).filter((x) => api.exists(x)).slice(0, 5);
  p.welcomeRecent.innerHTML = '';
  for (const path of list) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.appendChild(icon('i-file'));
    const n = document.createElement('span');
    n.className = 'rc-name';
    n.textContent = api.basename(path);
    const d = document.createElement('span');
    d.className = 'rc-path';
    d.textContent = api.basename(api.dirname(path));
    b.append(n, d);
    b.title = path;
    b.addEventListener('click', () => openInPane(p, path));
    li.appendChild(b);
    p.welcomeRecent.appendChild(li);
  }
}

// --------------------------------------------------------------- session ---
function saveSession() {
  store.set('session', {
    split,
    activeIndex: panes.indexOf(active),
    panes: panes.map((p) => ({
      activeTab: p.activeTab,
      tabs: p.tabs.map((t) => ({ path: t.path, pinned: t.pinned, scrollTop: t.scrollTop || 0 })),
    })),
  });
}

function restoreSession() {
  const s = store.get('session', null);
  if (!s || !s.panes || !s.panes.length) return false;
  const built = [];
  for (const saved of s.panes) {
    // Files move and get deleted between launches; drop them quietly. The
    // dedupe also heals sessions saved before duplicate tabs were prevented.
    const seen = new Set();
    const tabs = (saved.tabs || []).filter((t) => {
      if (!t.path || !api.exists(t.path) || seen.has(t.path)) return false;
      seen.add(t.path);
      return true;
    });
    if (!tabs.length) continue;
    const p = createPane();
    p.tabs = tabs.map((t) => ({ path: t.path, pinned: !!t.pinned, scrollTop: t.scrollTop || 0, doc: null }));
    p.activeTab = Math.min(Math.max(0, saved.activeTab ?? 0), p.tabs.length - 1);
    built.push(p);
  }
  if (!built.length) return false;
  panes = built.slice(0, 2);
  split = panes.length > 1 && !!s.split;
  if (!split) panes = [panes[0]];
  active = panes[Math.min(s.activeIndex ?? 0, panes.length - 1)] || panes[0];
  const first = curTab(active);
  if (first) setRoot(api.rootForFile(first.path));
  mountPanes();
  setActivePane(active);
  return true;
}

// -------------------------------------------------------- content clicks ---
function scrollToId(p, id) {
  const target = p.content.querySelector('#' + CSS.escape(id));
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  target.classList.remove('flash');
  void target.offsetWidth; // restart the animation
  target.classList.add('flash');
}

function onContentClick(e, p) {
  const copy = e.target.closest('.code-copy');
  if (copy) {
    const code = copy.closest('.code-card').querySelector('code');
    navigator.clipboard.writeText(code.textContent.replace(/\n$/, '')).then(() => {
      copy.classList.add('done');
      setTimeout(() => copy.classList.remove('done'), 1100);
      toast('Code copied');
    });
    return;
  }

  const anchor = e.target.closest('.h-anchor');
  if (anchor) {
    const id = anchor.dataset.anchor;
    const doc = curDoc(p);
    navigator.clipboard.writeText(`${doc ? doc.name : ''}#${id}`);
    scrollToId(p, id);
    toast('Heading link copied');
    return;
  }

  const zoom = e.target.closest('.diagram-btn');
  if (zoom) {
    const pre = zoom.closest('.diagram').querySelector('pre.mermaid');
    const cur = parseFloat(pre.dataset.zoom || '1');
    const next = zoom.dataset.zoom === 'reset' ? 1
      : zoom.dataset.zoom === 'in' ? Math.min(3, cur + 0.25)
      : Math.max(0.4, cur - 0.25);
    pre.dataset.zoom = String(next);
    pre.style.transform = `scale(${next})`;
    return;
  }

  const a = e.target.closest('a');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href) return;
  e.preventDefault();
  if (href.startsWith('#')) { scrollToId(p, decodeURIComponent(href.slice(1))); return; }
  if (/^(https?:|mailto:)/i.test(href)) { api.openExternal(href); return; }
  const [refPath, hash] = href.split('#');
  const doc = curDoc(p);
  const abs = api.resolveRelative(doc ? doc.dir : '', refPath || '');
  if (abs && api.exists(abs)) {
    if (api.isMarkdown(abs)) openInPane(p, abs, { hash, newTab: e.metaKey || e.ctrlKey });
    else api.openExternal(api.fileUrl(abs));
  }
}

// -------------------------------------------------------------- lightbox ---
function openLightbox(img) {
  el.lightboxImg.src = img.src;
  el.lightboxImg.alt = img.alt || '';
  const fig = img.closest('figure');
  const cap = fig && fig.querySelector('figcaption');
  el.lightboxCap.textContent = cap ? cap.textContent : '';
  el.lightbox.hidden = false;
}
el.lightbox.addEventListener('click', () => { el.lightbox.hidden = true; });

// ---------------------------------------------------------------- search ---
function buildIndex() {
  if (indexed || !files.length) return;
  index = files.map((f) => {
    const text = api.readText(f.path) || '';
    const heads = [];
    const re = /^(#{1,6})\s+(.+?)\s*#*$/gm;
    let m;
    while ((m = re.exec(text))) heads.push({ level: m[1].length, text: m[2].trim() });
    return {
      path: f.path,
      name: f.name,
      label: f.label,
      title: api.firstHeading(text) || f.label,
      text,
      lower: text.toLowerCase(),
      heads,
    };
  });
  indexed = true;
}

function slugish(s) {
  return s.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
}

function escapeHtmlText(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function highlight(text, q) {
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return escapeHtmlText(text);
  return escapeHtmlText(text.slice(0, i)) + '<mark>' + escapeHtmlText(text.slice(i, i + q.length)) +
         '</mark>' + escapeHtmlText(text.slice(i + q.length));
}

function snippet(text, q) {
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return '';
  const start = Math.max(0, i - 34);
  const raw = text.slice(start, i + q.length + 70).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '…' : '') + raw;
}

function search(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  buildIndex();
  const out = [];
  for (const d of index) {
    if (out.length > 60) break;
    if (d.label.toLowerCase().includes(q) || d.title.toLowerCase().includes(q) || d.name.toLowerCase().includes(q)) {
      out.push({ kind: 'Document', path: d.path, title: d.title, sub: d.name, q, weight: 0 });
    }
    for (const h of d.heads) {
      if (h.text.toLowerCase().includes(q)) {
        out.push({ kind: 'Heading', path: d.path, title: h.text, sub: d.label, hash: slugish(h.text), q, weight: 1 });
      }
    }
    const hit = d.lower.indexOf(q);
    if (hit >= 0) {
      // A body hit inside a fence is worth calling out as code.
      const before = d.text.slice(0, hit);
      const inCode = (before.match(/```/g) || []).length % 2 === 1;
      out.push({ kind: inCode ? 'Code' : 'Text', path: d.path, title: snippet(d.text, q), sub: d.label, q, mono: inCode, weight: 2 });
    }
  }
  return out.sort((a, b) => a.weight - b.weight).slice(0, 40);
}

let paletteSel = 0;
let paletteItems = [];
let paletteMode = 'search'; // 'search' | 'outline'

function paletteRow(r, i) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pr-item' + (i === paletteSel ? ' sel' : '');
  b.dataset.i = String(i);
  b.appendChild(icon(r.kind === 'Heading' ? 'i-hash' : 'i-file'));
  const main = document.createElement('div');
  main.className = 'pr-main';
  const t = document.createElement('div');
  t.className = 'pr-title';
  t.innerHTML = r.q ? highlight(r.title, r.q) : escapeHtmlText(r.title);
  main.appendChild(t);
  if (r.sub) {
    const s = document.createElement('div');
    s.className = 'pr-sub' + (r.mono ? ' mono' : '');
    s.textContent = r.sub;
    main.appendChild(s);
  }
  b.appendChild(main);
  const k = document.createElement('span');
  k.className = 'pr-kind';
  k.textContent = r.kind;
  b.appendChild(k);
  b.addEventListener('click', (e) => openResult(i, e.metaKey || e.ctrlKey));
  b.addEventListener('mousemove', () => selectResult(i));
  return b;
}

function renderPalette(query) {
  paletteSel = 0;
  el.paletteResults.innerHTML = '';

  if (!query.trim()) {
    const recents = store.get('recents', []).filter((p) => api.exists(p)).slice(0, 6);
    paletteItems = recents.map((p) => ({
      kind: 'Recent', path: p, title: api.titleize(api.basename(p)), sub: api.basename(api.dirname(p)),
    }));
    el.paletteCount.textContent = '';
    if (!paletteItems.length) {
      el.paletteResults.innerHTML = '<p class="palette-empty">Search titles, headings, body text, and code.</p>';
      return;
    }
  } else {
    paletteItems = search(query);
    if (!paletteItems.length) {
      el.paletteCount.textContent = '';
      const p = document.createElement('p');
      p.className = 'palette-empty';
      p.textContent = `No matches for “${query}”`;
      el.paletteResults.appendChild(p);
      return;
    }
    el.paletteCount.textContent = `${paletteItems.length} result${paletteItems.length === 1 ? '' : 's'}`;
  }

  let lastKind = null;
  paletteItems.forEach((r, i) => {
    if (r.kind !== lastKind) {
      const g = document.createElement('div');
      g.className = 'pr-group';
      g.textContent = r.kind === 'Text' ? 'In page' : r.kind;
      el.paletteResults.appendChild(g);
      lastKind = r.kind;
    }
    el.paletteResults.appendChild(paletteRow(r, i));
  });
}

function selectResult(i) {
  if (i === paletteSel) return;
  paletteSel = i;
  el.paletteResults.querySelectorAll('.pr-item').forEach((n) => {
    n.classList.toggle('sel', Number(n.dataset.i) === i);
  });
}

function openResult(i, newTab) {
  const r = paletteItems[i];
  if (!r) return;
  closePalette();
  const doc = curDoc(active);
  // A hit in the document already on screen is a jump, not a load.
  if (!newTab && doc && r.path === doc.path) {
    if (r.hash) scrollToId(active, r.hash);
    else active.scroller.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  openInPane(active, r.path, { hash: r.hash, newTab });
}

function openPalette(mode) {
  paletteMode = mode || 'search';
  el.palette.hidden = false;
  el.paletteInput.value = '';
  if (paletteMode === 'outline') renderOutline('');
  else renderPalette('');
  el.paletteInput.focus();
}

function closePalette() {
  el.palette.hidden = true;
  el.paletteInput.blur();
}

// Quick outline reuses the palette, scoped to the current document's headings.
function renderOutline(query) {
  const q = query.trim().toLowerCase();
  const doc = curDoc(active);
  paletteSel = 0;
  paletteItems = active.tocEntries
    .map((e) => ({ kind: 'Heading', path: doc ? doc.path : '', title: headingText(e.h), hash: e.h.id, q: q || undefined }))
    .filter((r) => !q || r.title.toLowerCase().includes(q));
  el.paletteResults.innerHTML = '';
  el.paletteCount.textContent = `${paletteItems.length} heading${paletteItems.length === 1 ? '' : 's'}`;
  if (!paletteItems.length) {
    el.paletteResults.innerHTML = '<p class="palette-empty">No headings in this document.</p>';
    return;
  }
  paletteItems.forEach((r, i) => el.paletteResults.appendChild(paletteRow(r, i)));
}

let searchTimer = null;
el.paletteInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const run = () => (paletteMode === 'outline' ? renderOutline(el.paletteInput.value) : renderPalette(el.paletteInput.value));
  searchTimer = setTimeout(run, paletteMode === 'outline' ? 0 : 80);
});
el.paletteInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectResult(Math.min(paletteItems.length - 1, paletteSel + 1));
    scrollSelIntoView();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectResult(Math.max(0, paletteSel - 1));
    scrollSelIntoView();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    openResult(paletteSel, e.metaKey || e.ctrlKey);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closePalette();
  }
});
function scrollSelIntoView() {
  const n = el.paletteResults.querySelector('.pr-item.sel');
  if (n) n.scrollIntoView({ block: 'nearest' });
}
el.paletteScrim.addEventListener('click', closePalette);
el.btn.search.addEventListener('click', () => openPalette('search'));

// ---------------------------------------------------------------- editor ---
function setEditing(on) {
  if (on && !curDoc(active)) return;
  editing = on;
  el.body.classList.toggle('editing', on);
  if (on) {
    const doc = curDoc(active);
    if (doc && el.editor.value !== doc.text) el.editor.value = doc.text;
    el.editor.focus();
  }
  refreshChrome();
}

let renderTimer = null;
el.editor.addEventListener('input', () => {
  const p = active;
  const doc = curDoc(p);
  if (!doc) return;
  doc.text = el.editor.value;
  if (!p.dirty) { p.dirty = true; refreshChrome(); }
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    const top = p.scroller.scrollTop;
    doc.html = api.render(doc.text, doc.path);
    renderDocInto(p, doc, api.gitInfo(doc.dir));
    buildToc(p);
    const prev = p.scroller.style.scrollBehavior;
    p.scroller.style.scrollBehavior = 'auto';
    p.scroller.scrollTop = top;
    p.scroller.style.scrollBehavior = prev;
  }, 160);
});
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
  const p = active;
  const doc = curDoc(p);
  if (!doc || !p.dirty) return;
  const res = api.writeFile(doc.path, doc.text);
  if (res && res.ok) { p.dirty = false; refreshChrome(); toast('Saved'); }
  else toast('Could not save: ' + ((res && res.error) || 'unknown error'));
}

// -------------------------------------------------------- sidebar resize ---
el.resizer.addEventListener('mousedown', (e) => {
  e.preventDefault();
  const startX = e.clientX;
  const startW = el.sidebar.getBoundingClientRect().width;
  el.body.classList.add('resizing');
  // Suspend the open/close spring so dragging tracks the cursor exactly.
  el.sidebar.style.transition = 'none';
  const move = (ev) => {
    const w = Math.min(460, Math.max(200, startW + (ev.clientX - startX)));
    document.documentElement.style.setProperty('--sidebar-w', w + 'px');
  };
  const up = () => {
    el.body.classList.remove('resizing');
    el.sidebar.style.transition = '';
    store.set('sidebarW', getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w').trim());
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
});

// ----------------------------------------------------------- drag & drop ---
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  el.body.classList.add('dragging');
});
window.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
window.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) el.body.classList.remove('dragging');
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  el.body.classList.remove('dragging');
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  const path = api.pathForFile(file);
  // Drop onto a pane and that's the pane it opens in.
  const pane = panes.find((p) => p.root.contains(e.target)) || active;
  if (path) openInPane(pane, path, { newTab: true });
});

// --------------------------------------------------------------- toolbar ---
async function pickAndOpen() {
  const p = await api.pickFile();
  if (p) openInPane(active, p, { newTab: true });
}
async function pickFolder() {
  const dir = await api.pickFolder();
  if (!dir) return;
  setRoot(dir, true);
  if (files[0]) openInPane(active, files[0].path);
  else toast('No Markdown files in that folder');
}

el.btn.sidebar.addEventListener('click', () => {
  sidebarVisible = !sidebarVisible;
  store.set('sidebarVisible', sidebarVisible);
  applyPanels();
});
el.btn.toc.addEventListener('click', () => {
  tocVisible = !tocVisible;
  store.set('tocVisible', tocVisible);
  applyPanels();
});
el.btn.focus.addEventListener('click', () => {
  const on = el.body.classList.toggle('focus');
  el.btn.focus.classList.toggle('on', on);
});
el.btn.split.addEventListener('click', () => setSplit(!split));
el.btn.back.addEventListener('click', () => {
  const prev = active.back.pop();
  if (!prev) return;
  const doc = curDoc(active);
  if (doc) active.forward.push(doc.path);
  const tab = curTab(active);
  if (tab) { tab.path = prev; tab.doc = null; tab.scrollTop = 0; }
  renderPane(active);
  renderTabs(active);
});
el.btn.forward.addEventListener('click', () => {
  const next = active.forward.pop();
  if (!next) return;
  const doc = curDoc(active);
  if (doc) active.back.push(doc.path);
  const tab = curTab(active);
  if (tab) { tab.path = next; tab.doc = null; tab.scrollTop = 0; }
  renderPane(active);
  renderTabs(active);
});
el.btn.print.addEventListener('click', () => api.print());
el.btn.export.addEventListener('click', async () => {
  const doc = curDoc(active);
  if (!doc) return;
  const res = await api.exportPdf(doc.name.replace(/\.[^.]+$/, '') + '.pdf');
  if (res && res.ok) toast('PDF exported');
  else if (res && res.error) toast('Export failed: ' + res.error);
});
el.btn.edit.addEventListener('click', () => setEditing(!editing));
el.btn.closeEdit.addEventListener('click', () => setEditing(false));
el.btn.save.addEventListener('click', saveFile);
el.brandName.addEventListener('click', pickFolder);

// -------------------------------------------------------------- keyboard ---
window.addEventListener('keydown', (e) => {
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key.toLowerCase() === 'k' && !e.shiftKey) { e.preventDefault(); openPalette('search'); return; }
  if (e.key === 'Escape') {
    if (!el.lightbox.hidden) { el.lightbox.hidden = true; return; }
    if (!el.palette.hidden) { closePalette(); return; }
    if (el.body.classList.contains('focus')) { el.body.classList.remove('focus'); el.btn.focus.classList.remove('on'); return; }
    if (editing) { setEditing(false); return; }
  }
  if (e.target === el.editor || e.target === el.paletteInput) return;

  // Space / shift-space page through the document, like a real reader.
  if (e.key === ' ' && curDoc(active) && el.palette.hidden) {
    e.preventDefault();
    active.scroller.scrollBy({ top: (active.scroller.clientHeight - 80) * (e.shiftKey ? -1 : 1), behavior: 'smooth' });
  }
  if (!meta) {
    if (e.key === 'j') active.scroller.scrollBy({ top: 90, behavior: 'smooth' });
    if (e.key === 'k') active.scroller.scrollBy({ top: -90, behavior: 'smooth' });
    if (e.key === 'g') active.scroller.scrollTo({ top: 0, behavior: 'smooth' });
    if (e.key === 'G') active.scroller.scrollTo({ top: active.scroller.scrollHeight, behavior: 'smooth' });
  }
});

function stepDoc(delta) {
  const doc = curDoc(active);
  if (!doc || !files.length) return;
  const i = files.findIndex((f) => f.path === doc.path);
  const next = files[i + delta];
  if (next) openInPane(active, next.path);
}

function stepTab(delta) {
  if (!active.tabs.length) return;
  const n = active.tabs.length;
  activateTab(active, (active.activeTab + delta + n) % n);
}

// Focus follows the split: ⌘1 / ⌘2 land you in the left / right pane.
function focusPane(i) {
  if (panes[i]) setActivePane(panes[i]);
}

// -------------------------------------------------------- menu + IPC ------
api.onMenu((action) => ({
  open: pickAndOpen,
  'open-folder': pickFolder,
  save: saveFile,
  'reload-file': () => {
    const tab = curTab(active);
    if (tab) { tab.doc = null; renderPane(active, { keepScroll: true }); }
  },
  export: () => el.btn.export.click(),
  print: () => api.print(),
  find: () => openPalette('search'),
  search: () => openPalette('search'),
  outline: () => openPalette('outline'),
  'toggle-sidebar': () => el.btn.sidebar.click(),
  'toggle-toc': () => el.btn.toc.click(),
  'toggle-focus': () => el.btn.focus.click(),
  'toggle-edit': () => setEditing(!editing),
  'toggle-theme': () => el.btn.theme.click(),
  'toggle-split': () => setSplit(!split),
  'new-tab': () => newTab(active),
  'close-tab': () => closeTab(active, active.activeTab),
  'pin-tab': () => togglePin(active, active.activeTab),
  'next-tab': () => stepTab(1),
  'prev-tab': () => stepTab(-1),
  'focus-pane-1': () => focusPane(0),
  'focus-pane-2': () => focusPane(1),
  back: () => el.btn.back.click(),
  forward: () => el.btn.forward.click(),
  'next-doc': () => stepDoc(1),
  'prev-doc': () => stepDoc(-1),
}[action] || (() => {}))());

api.onOpenPath((p) => openInPane(active, p, { newTab: true }));
api.onFullscreen((on) => el.body.classList.toggle('fullscreen', on));

// ------------------------------------------------------------------ init ---
const savedW = store.get('sidebarW', null);
if (savedW) document.documentElement.style.setProperty('--sidebar-w', savedW);

applyTheme();
if (!restoreSession()) {
  panes = [createPane()];
  active = panes[0];
  mountPanes();
  setActivePane(active);
}
applyPanels();
refreshChrome();
api.rendererReady();
