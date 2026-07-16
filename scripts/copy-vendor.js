// Copies the browser-loadable assets we need into ./vendor so the packaged
// app is self-contained and doesn't depend on node_modules at runtime.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const vendor = path.join(root, 'vendor');
fs.mkdirSync(vendor, { recursive: true });

const jobs = [
  ['dompurify/dist/purify.min.js', 'purify.min.js'],
  ['mermaid/dist/mermaid.min.js', 'mermaid.min.js'],
  ['github-markdown-css/github-markdown-light.css', 'github-markdown-light.css'],
  ['github-markdown-css/github-markdown-dark.css', 'github-markdown-dark.css'],
  ['highlight.js/styles/github.min.css', 'hljs-github-light.css'],
  ['highlight.js/styles/github-dark.min.css', 'hljs-github-dark.css'],
];

for (const [from, to] of jobs) {
  const src = path.join(root, 'node_modules', from);
  const dest = path.join(vendor, to);
  fs.copyFileSync(src, dest);
  console.log('vendored', to);
}

console.log('vendor ready:', vendor);
