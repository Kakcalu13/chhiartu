# Getting started

A page that is mostly prose, to check that the reading measure and paragraph rhythm
hold up without code or tables to break the page.

## Installing

Run the vendor step once, then start the app:

```bash
npm install
npm start
```

The vendor step copies DOMPurify and Mermaid into `vendor/` so the packaged app does
not reach into `node_modules` at runtime.

## Opening documents

Drop a Markdown file onto the window, or press ⌘O. The folder containing that file
becomes the workspace root, and the sidebar fills with everything markdown-ish
underneath it.

> [!IMPORTANT]
> The reader never writes to disk unless you explicitly save from the source editor.

## Keyboard

| Key    | Action              |
| ------ | ------------------- |
| `⌘K`   | Search everything   |
| `⇧⌘K`  | Quick outline       |
| `⌘[`   | Back                |
| `space`| Page down           |
| `g`    | Top of document     |
