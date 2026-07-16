const { contextBridge, ipcRenderer, webUtils } = require('electron');
const fs = require('fs');
const path = require('path');

const { Marked } = require('marked');
const { markedHighlight } = require('marked-highlight');
const { gfmHeadingId } = require('marked-gfm-heading-id');
const hljs = require('highlight.js');

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildMarked() {
  const marked = new Marked(
    markedHighlight({
      langPrefix: 'hljs language-',
      highlight(code, lang) {
        const l = (lang || '').trim().toLowerCase();
        if (l === 'mermaid') return code; // handled by the mermaid renderer override below
        const language = hljs.getLanguage(l) ? l : 'plaintext';
        try {
          return hljs.highlight(code, { language, ignoreIllegals: true }).value;
        } catch {
          return escapeHtml(code);
        }
      },
    }),
    gfmHeadingId()
  );

  marked.setOptions({ gfm: true, breaks: false });

  // Emit mermaid fences as <pre class="mermaid"> so the renderer can draw them.
  marked.use({
    renderer: {
      code(token) {
        const lang = (token.lang || '').trim().toLowerCase();
        if (lang === 'mermaid') {
          return `<pre class="mermaid">${escapeHtml(token.text)}</pre>\n`;
        }
        return false; // fall through to the default (highlighted) code renderer
      },
    },
  });

  return marked;
}

const marked = buildMarked();

function renderMarkdown(md) {
  return marked.parse(md);
}

function firstHeading(md) {
  const m = md.match(/^\s{0,3}#\s+(.+?)\s*#*\s*$/m);
  return m ? m[1].trim() : null;
}

function readAndRender(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return {
    path: filePath,
    dir: path.dirname(filePath),
    name: path.basename(filePath),
    title: firstHeading(content) || path.basename(filePath),
    html: renderMarkdown(content),
    text: content,
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
    const abs = path.resolve(dir, decodeURI(clean));
    return abs;
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

contextBridge.exposeInMainWorld('md', {
  // Drag & drop gives a File; Electron resolves its real path here.
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return null; }
  },
  isMarkdown: (p) => /\.(md|markdown|mdown|mkd|mdx|markdn|txt|text)$/i.test(p || ''),
  readAndRender: (filePath) => {
    try { return readAndRender(filePath); }
    catch (e) { return { error: String(e && e.message || e), path: filePath }; }
  },
  render: (text) => {
    try { return renderMarkdown(String(text)); }
    catch (e) { return '<p>Render error: ' + escapeHtml(String(e && e.message || e)) + '</p>'; }
  },
  writeFile: (filePath, text) => {
    try { fs.writeFileSync(filePath, text, 'utf8'); return { ok: true }; }
    catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  },
  firstHeading,
  resolveRelative,
  fileUrl: (abs) => (abs ? require('url').pathToFileURL(abs).href : null),
  exists: (p) => { try { return fs.existsSync(p); } catch { return false; } },
  watch: watchFile,
  unwatch,
  pickFile: () => ipcRenderer.invoke('pick-file'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  showItem: (p) => ipcRenderer.invoke('show-item', p),
  rendererReady: () => ipcRenderer.invoke('renderer-ready'),
  onOpenPath: (cb) => ipcRenderer.on('open-path', (_e, p) => cb(p)),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, action) => cb(action)),
});
