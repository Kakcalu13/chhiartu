const { contextBridge, ipcRenderer, webUtils } = require('electron');
const fs = require('fs');
const path = require('path');
const url = require('url');

const md = require('./lib/markdown');
const ws = require('./lib/workspace');

function readAndRender(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const { meta, body } = md.splitFrontmatter(content);
  const stat = ws.statOf(filePath);
  const stats = md.readingStats(content);
  const name = path.basename(filePath);

  // A source-ish .txt is shown verbatim, and its first `# comment` line is a
  // comment rather than a title — so don't let firstHeading claim otherwise.
  const verbatim = ws.isPlainText(filePath) && md.looksPreformatted(content);

  return {
    path: filePath,
    dir: path.dirname(filePath),
    name,
    title: verbatim ? name : (meta.title || md.firstHeading(body) || ws.titleize(name)),
    meta: verbatim ? {} : meta,
    html: ws.isPlainText(filePath) ? md.renderTextFile(content, name) : md.renderMarkdown(content),
    text: content,
    words: stats.words,
    minutes: stats.minutes,
    mtime: stat ? stat.mtime : null,
    size: stat ? stat.size : null,
  };
}

// Resolve a relative href/src (from markdown) against the current file's folder.
function resolveRelative(dir, ref) {
  try {
    if (!ref) return null;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(ref)) return null; // absolute URL
    if (ref.startsWith('#')) return null; // in-page anchor
    if (ref.startsWith('data:')) return null;
    const clean = ref.replace(/[?#].*$/, '');
    return path.resolve(dir, decodeURI(clean));
  } catch {
    return null;
  }
}

const watchers = new Map();
function watchFile(filePath, cb) {
  unwatch(filePath);
  let timer = null;
  try {
    const w = fs.watch(filePath, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          if (fs.existsSync(filePath)) cb(readAndRender(filePath));
        } catch {
          /* ignore transient read errors during atomic saves */
        }
      }, 120);
    });
    watchers.set(filePath, w);
  } catch {
    /* file may be unwatchable; ignore */
  }
}
function unwatch(filePath) {
  const w = watchers.get(filePath);
  if (w) {
    try { w.close(); } catch {}
    watchers.delete(filePath);
  }
}

// Cheap text read for the search index — skips anything too big to be prose.
function readText(filePath, maxBytes = 1024 * 1024) {
  try {
    const s = fs.statSync(filePath);
    if (s.size > maxBytes) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

// The workspace root for a freshly opened file: its own folder, unless that
// folder is itself a `docs`-ish leaf, in which case the parent reads better as
// the project root in the sidebar.
function rootForFile(filePath) {
  const dir = path.dirname(filePath);
  const base = path.basename(dir).toLowerCase();
  if (['docs', 'doc', 'documentation'].includes(base)) return dir;
  return dir;
}

function projectVersion(root) {
  for (const rel of ['package.json', 'VERSION', 'version.txt']) {
    try {
      const raw = fs.readFileSync(path.join(root, rel), 'utf8');
      if (rel === 'package.json') {
        const v = JSON.parse(raw).version;
        if (v) return 'v' + v;
      } else if (raw.trim()) {
        return 'v' + raw.trim().split('\n')[0];
      }
    } catch {
      /* not present */
    }
  }
  return null;
}

contextBridge.exposeInMainWorld('md', {
  // ---- documents ----
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return null; }
  },
  isMarkdown: ws.isMarkdownPath,
  readAndRender: (filePath) => {
    try { return readAndRender(filePath); }
    catch (e) { return { error: String((e && e.message) || e), path: filePath }; }
  },
  // `name` lets live editing honour the same .txt decision as readAndRender.
  render: (text, name) => {
    try {
      return ws.isPlainText(name)
        ? md.renderTextFile(String(text), path.basename(name))
        : md.renderMarkdown(String(text));
    } catch (e) {
      return '<p>Render error: ' + md.escapeHtml(String((e && e.message) || e)) + '</p>';
    }
  },
  writeFile: (filePath, text) => {
    try { fs.writeFileSync(filePath, text, 'utf8'); return { ok: true }; }
    catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  },
  readText,
  firstHeading: md.firstHeading,
  readingStats: md.readingStats,

  // ---- workspace ----
  rootForFile,
  scanTree: (root) => {
    try { return ws.scanTree(root); }
    catch (e) { return { error: String((e && e.message) || e) }; }
  },
  flattenFiles: (tree) => ws.flattenFiles(tree),
  titleize: ws.titleize,
  gitInfo: (dir) => ws.gitInfo(dir),
  projectVersion,
  stat: ws.statOf,
  basename: (p) => path.basename(p || ''),
  dirname: (p) => path.dirname(p || ''),
  relative: (from, to) => path.relative(from || '', to || ''),
  sep: path.sep,

  // ---- paths & links ----
  resolveRelative,
  fileUrl: (abs) => (abs ? url.pathToFileURL(abs).href : null),
  exists: (p) => { try { return fs.existsSync(p); } catch { return false; } },
  watch: watchFile,
  unwatch,

  // ---- shell / ipc ----
  pickFile: () => ipcRenderer.invoke('pick-file'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  openExternal: (u) => ipcRenderer.invoke('open-external', u),
  showItem: (p) => ipcRenderer.invoke('show-item', p),
  openInEditor: (p) => ipcRenderer.invoke('open-in-editor', p),
  print: () => ipcRenderer.invoke('print'),
  exportPdf: (name) => ipcRenderer.invoke('export-pdf', name),
  setNativeTheme: (source) => ipcRenderer.invoke('set-native-theme', source),
  rendererReady: () => ipcRenderer.invoke('renderer-ready'),
  onOpenPath: (cb) => ipcRenderer.on('open-path', (_e, p) => cb(p)),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, action) => cb(action)),
  onFullscreen: (cb) => ipcRenderer.on('fullscreen', (_e, v) => cb(v)),
});
