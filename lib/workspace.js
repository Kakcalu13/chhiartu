// Filesystem side of the docs workspace: the folder tree the sidebar draws,
// plus the small facts the status card shows (git revision, last modified).

const fs = require('fs');
const path = require('path');

// Two different questions, two different lists:
//   DOC_RE      — is this documentation? decides what the sidebar tree lists.
//   OPENABLE_RE — can we display this at all? decides drops, links, and dialogs.
// A repo is full of .txt files (CMakeLists.txt, LICENSE, NOTICE) that are not
// documentation and turn to mush if run through a markdown parser.
const DOC_RE = /\.(md|markdown|mdown|mkd|mdx|markdn)$/i;
const TEXT_RE = /\.(txt|text)$/i;
const OPENABLE_RE = /\.(md|markdown|mdown|mkd|mdx|markdn|txt|text)$/i;

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out', 'target',
  '.next', '.nuxt', '.cache', '.turbo', 'coverage', 'vendor', 'Pods',
  '.venv', 'venv', '__pycache__', '.tox', '.idea', '.vscode', '.DS_Store',
]);

// Guard rails so pointing the app at a huge tree can't wedge the UI.
const MAX_DEPTH = 6;
const MAX_ENTRIES = 3000;

function isMarkdownPath(p) {
  return OPENABLE_RE.test(p || '');
}

// True for files we can show but must not parse as markdown.
function isPlainText(p) {
  return TEXT_RE.test(p || '');
}

function titleize(name) {
  const base = name.replace(OPENABLE_RE, '').replace(/[-_]+/g, ' ').trim();
  if (!base) return name;
  return base.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

// README/index float to the top of their folder; then folders, then files.
function sortEntries(a, b) {
  const rank = (e) => {
    if (e.type === 'file' && /^(readme|index)\./i.test(e.name)) return 0;
    return e.type === 'dir' ? 1 : 2;
  };
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

function scanTree(root) {
  let budget = MAX_ENTRIES;

  function walk(dir, depth) {
    if (depth > MAX_DEPTH || budget <= 0) return [];
    let dirents;
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const out = [];
    for (const d of dirents) {
      if (budget <= 0) break;
      if (d.name.startsWith('.')) continue;
      const full = path.join(dir, d.name);
      if (d.isDirectory()) {
        if (IGNORED_DIRS.has(d.name)) continue;
        const children = walk(full, depth + 1);
        // A folder with no markdown under it is noise in a docs sidebar.
        if (!children.length) continue;
        out.push({ type: 'dir', name: d.name, path: full, label: titleize(d.name), children });
      } else if (d.isFile() && DOC_RE.test(d.name)) {
        budget--;
        out.push({ type: 'file', name: d.name, path: full, label: titleize(d.name) });
      }
    }
    return out.sort(sortEntries);
  }

  return {
    type: 'dir',
    name: path.basename(root),
    path: root,
    label: titleize(path.basename(root)),
    children: walk(root, 0),
    truncated: budget <= 0,
  };
}

// Depth-first flatten of just the files, which is the order Previous/Next walks.
function flattenFiles(node, out = []) {
  for (const c of node.children || []) {
    if (c.type === 'file') out.push(c);
    else flattenFiles(c, out);
  }
  return out;
}

function statOf(p) {
  try {
    const s = fs.statSync(p);
    return { size: s.size, mtime: s.mtimeMs };
  } catch {
    return null;
  }
}

function findGitDir(startDir) {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    const g = path.join(dir, '.git');
    try {
      const s = fs.statSync(g);
      if (s.isDirectory()) return g;
      // Worktrees / submodules use a `.git` file pointing elsewhere.
      if (s.isFile()) {
        const m = /gitdir:\s*(.+)/.exec(fs.readFileSync(g, 'utf8'));
        if (m) return path.resolve(dir, m[1].trim());
      }
    } catch {
      /* keep walking up */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Reads refs straight off disk rather than shelling out to `git` — no process
// spawn on every document load, and it works when git isn't installed.
function gitInfo(startDir) {
  const gitDir = findGitDir(startDir);
  if (!gitDir) return null;
  try {
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    const refMatch = /^ref:\s*(.+)$/.exec(head);
    if (!refMatch) return { branch: null, sha: head.slice(0, 7), detached: true };
    const ref = refMatch[1].trim();
    const branch = ref.replace(/^refs\/heads\//, '');
    let sha = null;
    try {
      sha = fs.readFileSync(path.join(gitDir, ref), 'utf8').trim();
    } catch {
      // Ref has been packed away.
      try {
        const packed = fs.readFileSync(path.join(gitDir, 'packed-refs'), 'utf8');
        const line = packed.split('\n').find((l) => l.endsWith(' ' + ref));
        if (line) sha = line.split(' ')[0];
      } catch {
        /* no packed-refs */
      }
    }
    return { branch, sha: sha ? sha.slice(0, 7) : null, detached: false };
  } catch {
    return null;
  }
}

module.exports = {
  isMarkdownPath,
  isPlainText,
  titleize,
  scanTree,
  flattenFiles,
  statOf,
  gitInfo,
  DOC_RE,
  OPENABLE_RE,
};
