// Sanity check the exact rendering pipeline the preload uses (no Electron/GUI).
// This imports lib/markdown.js directly, so what it asserts is what ships.
const fs = require('fs');
const path = require('path');
const md = require('../lib/markdown');
const ws = require('../lib/workspace');

const samples = path.join(__dirname, '..', 'samples');
const source = fs.readFileSync(path.join(samples, 'demo.md'), 'utf8');
const html = md.renderMarkdown(source);

const { meta, body } = md.splitFrontmatter(source);
const stats = md.readingStats(source);
const tree = ws.scanTree(samples);
const files = ws.flattenFiles(tree);

// Trimmed from the real CMakeLists.txt that exposed the .txt reflow bug. The
// leading `#` comment is the trap: it is also a markdown H1.
const CMAKE = `cmake_minimum_required(VERSION 3.10)
project(kawr LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_executable(kawr src/main.cpp src/App.cpp)
target_include_directories(kawr PRIVATE src)
if(APPLE)
# macOS ships OpenGL + GLUT as system frameworks — nothing to install.
  find_library(OPENGL_FRAMEWORK OpenGL REQUIRED)
endif()
`;

// Shaped after the real here.txt: an indented outline whose continuation lines
// markdown would swallow into the paragraph above. No code constructs at all,
// so only the indentation signal catches it.
const OUTLINE = `src/MeshExport.cpp / .h
    - the .glb writer, no dependencies. Each closed Shape -> two
      panels (front at y=0, back at front + gap offset), lattice
      quads triangulated, back winding reversed.
CMakeLists.txt
    - MeshExport.cpp added to the sources.
src/Shape.cpp / .h
    - buildMesh(divisions) now emits the lattice directly.
`;

const PROSE = `# Shopping

Things to pick up on the way home, in no particular order.

- milk
- bread
- coffee beans, the dark roast

Remember the reusable bags this time.
`;

const checks = {
  // Markdown fundamentals
  'heading id present': /<h2 id="panels"/.test(html),
  'table rendered': /<table>/.test(html),
  'task list checkbox': /type="checkbox"/.test(html),
  'strikethrough support': md.renderMarkdown('~~x~~').includes('<del>'),

  // Syntax highlighting
  'ts highlighted': /class="hljs language-ts"/.test(html) && /hljs-keyword/.test(html),
  'python highlighted': /class="hljs language-python"/.test(html),
  'mermaid passthrough': /<pre class="mermaid">graph TD/.test(html),

  // Premium rendering: code cards
  'code card wrapper': /<figure class="code-card" data-lang="json">/.test(html),
  'language badge': /<span class="code-lang">JSON<\/span>/.test(html),
  'copy button': /class="code-copy"/.test(html),
  'fence filename parsed': /<span class="code-file">kawr_export\.glb<\/span>/.test(html),
  'no filename yields empty slot': /<span class="code-file code-file-empty">/.test(html),
  'diagram figure + zoom tools': /<figure class="diagram">/.test(html) && /data-zoom="in"/.test(html),

  // Premium rendering: callouts
  'note -> info callout': /<div class="callout callout-info">/.test(html),
  'warning callout': /<div class="callout callout-warning">/.test(html),
  'tip callout': /<div class="callout callout-tip">/.test(html),
  'important -> tip callout': md.renderMarkdown('> [!IMPORTANT]\n> x').includes('callout-tip'),
  'caution -> danger callout': md.renderMarkdown('> [!CAUTION]\n> x').includes('callout-danger'),
  'callout default title': /<p class="callout-title">Note<\/p>/.test(html),
  'callout custom title': md.renderMarkdown('> [!NOTE] Heads up\n> x').includes('>Heads up<'),
  'callout body is parsed markdown': md.renderMarkdown('> [!NOTE]\n> a **b**').includes('<strong>b</strong>'),
  'plain blockquote stays a blockquote': /<blockquote>/.test(html),
  'unknown alert stays a blockquote': md.renderMarkdown('> [!BOGUS]\n> x').includes('<blockquote>'),

  // Links
  'external link marked': /<a href="https:\/\/registry\.khronos\.org\/glTF\/"[^>]*data-external="true"/.test(html),
  'relative link not marked': /<a href="\.\/guides\/getting-started\.md">/.test(html),

  // Frontmatter + stats
  'frontmatter parsed': meta.status === 'Draft' && meta.author === 'Platform Team',
  'frontmatter stripped from body': !body.startsWith('---'),
  'frontmatter not rendered': !html.includes('Platform Team'),
  'word count is prose-only': stats.words > 100 && stats.words < 500,
  'reading time computed': stats.minutes >= 1,

  // Math (typeset in-process by KaTeX, so the browser only needs the CSS)
  'inline math renders': md.renderMarkdown('mass $E = mc^2$ here').includes('katex'),
  'block math renders': md.renderMarkdown('$$\n\\int_0^1 x^2\n$$').includes('katex-display'),
  'block math wrapped in figure': md.renderMarkdown('$$\na^2\n$$').includes('<figure class="math-block">'),
  'bracket block math': md.renderMarkdown('\\[ a^2 + b^2 = c^2 \\]').includes('katex-display'),
  'paren inline math': md.renderMarkdown('see \\(a^2\\) there').includes('katex'),
  'math emits mathml for a11y': md.renderMarkdown('$x$').includes('<math'),
  // Guards against eating ordinary prose
  'money is not math': !md.renderMarkdown('It costs $5 and $10 total.').includes('katex'),
  'price range is not math': !md.renderMarkdown('Costs $5-$10 per unit.').includes('katex'),
  'shell var in code span is not math': !md.renderMarkdown('Use `$HOME/.config` here.').includes('katex'),
  'shell var in fence is not math': !md.renderMarkdown('```bash\necho $PATH $HOME\n```').includes('katex'),
  'mismatched delimiters ignored': !md.renderMarkdown('$$\na^2\n\\]').includes('katex-display'),
  'bad tex degrades, does not throw': md.renderMarkdown('$\\frac{1}{$').includes('katex-error'),

  // Workspace scan
  'tree finds nested docs': files.length === 4,
  'readme sorts first': tree.children[0].name === 'README.md',
  'dirs get labels': tree.children.some((c) => c.type === 'dir' && c.label === 'Guides'),
  'tree lists markdown only': !ws.DOC_RE.test('CMakeLists.txt') && ws.DOC_RE.test('a.md'),
  'txt still openable': ws.isMarkdownPath('notes.txt') && ws.isPlainText('notes.txt'),
  'md is not plain text': !ws.isPlainText('a.md'),

  // .txt auto-detect: layout-dependent stays verbatim, prose renders as prose
  'cmake reads as preformatted': md.looksPreformatted(CMAKE),
  'indented outline reads as preformatted': md.looksPreformatted(OUTLINE),
  'outline keeps its indentation': md.renderTextFile(OUTLINE, 'here.txt').includes('      panels (front at y=0'),
  'prose does not read as preformatted': !md.looksPreformatted(PROSE),
  'nested md list is not preformatted': !md.looksPreformatted('- a\n  - b\n  - c\n- d\n  - e\n'),
  'hash comments do not fool it': md.looksPreformatted(CMAKE) && CMAKE.includes('\n# macOS'),
  'fenced txt reads as prose': !md.looksPreformatted('```\nx();\ny();\n```\n'),
  'short txt reads as prose': !md.looksPreformatted('hello\nworld\n'),
  'code txt renders verbatim': md.renderTextFile(CMAKE, 'CMakeLists.txt').includes('<figure class="code-card"'),
  'code txt keeps line breaks': md.renderTextFile(CMAKE, 'CMakeLists.txt').includes('project(kawr LANGUAGES CXX)\nset('),
  'code txt titled by filename': md.renderTextFile(CMAKE, 'CMakeLists.txt').includes('>CMakeLists.txt</h1>'),
  'prose txt renders as markdown': md.renderTextFile(PROSE, 'notes.txt').includes('<h1 id="shopping"'),
  'prose txt gets real lists': md.renderTextFile(PROSE, 'notes.txt').includes('<li>'),
};

let ok = true;
for (const [name, pass] of Object.entries(checks)) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  if (!pass) ok = false;
}
console.log(`\n${ok ? '✅' : '❌'} ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length} checks passed`);
process.exit(ok ? 0 : 1);
