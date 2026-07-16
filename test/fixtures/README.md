# Fixture workspace

Not documentation — this folder is the input for `npm test`.

`scanTree` is pointed here to check that the sidebar lists Markdown only, sorts
README first, titleizes folder names, and ignores `CMakeLists.txt`. `demo.md` is
the document every rendering assertion runs against.

Four Markdown files live here, and the count is asserted, so adding one means
updating `scripts/test-render.js`.
