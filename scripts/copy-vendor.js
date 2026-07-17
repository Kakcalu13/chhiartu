// Copies the browser-loadable assets we need into ./vendor so the packaged
// app is self-contained and doesn't depend on node_modules at runtime.
//
// The markdown and syntax themes are ours (renderer/style.css), so only the
// two libraries the renderer loads as <script> tags get vendored.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const vendor = path.join(root, 'vendor');
fs.mkdirSync(vendor, { recursive: true });

const jobs = [
  ['dompurify/dist/purify.min.js', 'purify.min.js'],
  ['mermaid/dist/mermaid.min.js', 'mermaid.min.js'],
  // KaTeX's JS stays in the preload (math is typeset before it reaches the
  // renderer) — only the stylesheet and its fonts need to be loadable.
  ['katex/dist/katex.min.css', 'katex.min.css'],
];

for (const [from, to] of jobs) {
  const src = path.join(root, 'node_modules', from);
  const dest = path.join(vendor, to);
  fs.copyFileSync(src, dest);
  console.log('vendored', to);
}

// woff2 only: every browser we run on supports it, and it's the first source in
// each @font-face, so the .woff/.ttf fallbacks are never requested. Copying all
// three formats would triple the payload for nothing.
const fontsSrc = path.join(root, 'node_modules', 'katex', 'dist', 'fonts');
const fontsDest = path.join(vendor, 'fonts');
fs.mkdirSync(fontsDest, { recursive: true });
let fontCount = 0;
for (const f of fs.readdirSync(fontsSrc)) {
  if (!f.endsWith('.woff2')) continue;
  fs.copyFileSync(path.join(fontsSrc, f), path.join(fontsDest, f));
  fontCount++;
}
console.log(`vendored ${fontCount} KaTeX woff2 fonts`);

// Sweep out the GitHub-style themes the redesign replaced, so a stale copy
// can't quietly get shipped in the asar.
for (const gone of [
  'github-markdown-light.css', 'github-markdown-dark.css',
  'hljs-github-light.css', 'hljs-github-dark.css',
]) {
  const p = path.join(vendor, gone);
  if (fs.existsSync(p)) { fs.unlinkSync(p); console.log('removed stale', gone); }
}

console.log('vendor ready:', vendor);
