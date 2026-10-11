# Matekos Doksi 0.4

WYSIWYG editor for print-ready documents with live inline TeX, built with
**TipTap** (editor), **MathJax 4** (formulas) and **Tauri 2** (Windows/macOS app).

All document text is TeX Gyre Bonum, all math is TeX Gyre Bonum Math. Both fonts are
built into the app and embedded in every PDF, so documents look identical on every
computer and on paper.

## Installers without a terminal

See **HOW-TO-MAKE-INSTALLERS.md**: GitHub builds the Windows setup wizard and the Mac .dmg for you.

## Build the desktop app yourself

You build on the system you are targeting: the Windows installer on Windows,
the macOS app on a Mac.

### One-time setup

**Windows 10/11**
1. Install [Node.js LTS](https://nodejs.org).
2. Install [Rust](https://www.rust-lang.org/tools/install) (`rustup`, default options).
3. Install "Microsoft C++ Build Tools" with the **Desktop development with C++** workload.
4. WebView2 is already part of Windows 10/11.

**macOS 11 or newer**
1. `xcode-select --install`
2. Install [Node.js LTS](https://nodejs.org) and [Rust](https://www.rust-lang.org/tools/install).

### Build

```
npm install
npm run tauri build
```

The installer ends up in `src-tauri/target/release/bundle/`
(`msi/` and `nsis/` on Windows, `dmg/` and `macos/` on macOS).

For development with hot reload: `npm run tauri dev`.

### Browser test version

```
npm run build:web
```

This writes one self-contained `dist-web/index.html` that testers can open in
Chrome, Edge, Safari or Firefox. It needs an internet connection for MathJax;
the desktop app works fully offline.

## How printing stays exact

* **Pagination** (`src/editor/pagination.js`) measures the real layout after every change
  and inserts invisible spacers, so every line, table row and picture sits inside a
  page's text area. Paragraphs split across pages line by line, with orphan/widow
  control and keep-with-next for headings.
* **PDF export** (`src/pdf.js`) places every word, glyph, line, picture and formula at the
  exact position the layout engine gave it on screen, using the same embedded font files.
  Formulas are written as vector outlines.
* **Print** in the desktop app opens that exact PDF in the system PDF viewer.
  Print at **Actual size / 100 %**, not "Fit to page".
* In the browser version, Print uses the browser's print dialog with the same page
  layout; there, too, set scale to 100 % and margins to "None" if asked.

## Fonts

* `src/fonts/bonum-*.ttf` – TeX Gyre Bonum (regular, bold, italic, bold italic), converted
  to TrueType outlines for PDF embedding.
* `fonts-official/texgyrebonum-math.otf` – the official TeX Gyre Bonum Math 1.005.
  MathJax cannot read OpenType math fonts directly; it uses its own conversion of this
  font (`@mathjax/mathjax-bonum-font`). `python3 tools/verify-math-font.py` checks that
  the glyph outlines are identical to the official file.
* Licence: GUST Font License (`fonts-official/GUST-FONT-LICENSE.txt`).

## File format

`.mdoksi` files are JSON: `{ app, v, title, tpl, doc }` where `doc` is the TipTap
document and `tpl` the page template. The browser version saves the same data inside an
`.html` file; the desktop app opens both, as well as `.kiadvany` files and files from the first prototype.

## Project layout

```
index.html            app shell (toolbar, dialogs, template panel)
src/main.js           app logic: toolbar, dialogs, template, save/open/print
src/editor/           TipTap extensions (math, images, lists, cells, pagination)
src/pdf.js            exact PDF export
src/pages.js          page sheets: header, footer, watermark
src/template.js       page geometry, margins, gutter, odd/even pages
src-tauri/            desktop app (Rust)
tools/                font verification
```
