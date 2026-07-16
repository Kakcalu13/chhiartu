// Sanity check the exact rendering pipeline the preload uses (no Electron/GUI).
const fs = require('fs');
const path = require('path');
const { Marked } = require('marked');
const { markedHighlight } = require('marked-highlight');
const { gfmHeadingId } = require('marked-gfm-heading-id');
const hljs = require('highlight.js');

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const marked = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const l = (lang || '').trim().toLowerCase();
      if (l === 'mermaid') return code;
      const language = hljs.getLanguage(l) ? l : 'plaintext';
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    },
  }),
  gfmHeadingId()
);
marked.setOptions({ gfm: true, breaks: false });
marked.use({
  renderer: {
    code(token) {
      const lang = (token.lang || '').trim().toLowerCase();
      if (lang === 'mermaid') return `<pre class="mermaid">${escapeHtml(token.text)}</pre>\n`;
      return false;
    },
  },
});

const md = fs.readFileSync(path.join(__dirname, '..', 'samples', 'demo.md'), 'utf8');
const html = marked.parse(md);

const checks = {
  'heading id present': /<h2 id="text-formatting"/.test(html),
  'table rendered': /<table>/.test(html),
  'task list checkbox': /type="checkbox"/.test(html),
  'js highlighted': /class="hljs language-js"/.test(html) && /hljs-keyword/.test(html),
  'python highlighted': /class="hljs language-python"/.test(html),
  'mermaid block': /<pre class="mermaid">graph TD/.test(html),
  'strikethrough': /<del>/.test(html),
};

let ok = true;
for (const [name, pass] of Object.entries(checks)) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  if (!pass) ok = false;
}
console.log('\n' + (ok ? '✅ all checks passed' : '❌ some checks failed'));
process.exit(ok ? 0 : 1);
