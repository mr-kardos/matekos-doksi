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

## Fonts

* 9 font sets (text font + matching MathJax 4 math font) and 16 further text fonts, as in Matekos Prezi
  (`src/fontsets.js`, files in `src/fonts/families/`). The template sets the document's font; the ribbon's
  font picker changes the selected text. Formulas use the math font that belongs to the text around them.
* In PDFs, TeX Gyre Bonum text is real (selectable) text; text in the other fonts is written as exact
  glyph outlines.

* `src/fonts/bonum-*.ttf` – TeX Gyre Bonum (regular, bold, italic, bold italic), converted
  to TrueType outlines for PDF embedding.
* `fonts-official/texgyrebonum-math.otf` – the official TeX Gyre Bonum Math 1.005.
  MathJax cannot read OpenType math fonts directly; it uses its own conversion of this
  font (`@mathjax/mathjax-bonum-font`). `python3 tools/verify-math-font.py` checks that
  the glyph outlines are identical to the official file.
* Licence: GUST Font License (`fonts-official/GUST-FONT-LICENSE.txt`).

## File format

`.mdoksi` files are JSON: `{ app, v, title, tpl, doc }` where `doc` is the TipTap
document and `tpl` the page template. The app also opens `.kiadvany` files and `.html` files
saved by earlier test versions.

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


## 0.6.0 – interface of Matekos Prezi
- Home screen, top bar (Fájl ▾, Exportálás ▾, Mentés / Mentés másként, undo/redo, name + status, Sablon, zoom) and ribbon of Matekos Prezi.
- The title box is the file name: Mentés writes the document's own file (asks only the first time), renaming the title renames the file.
- Formula editor of Matekos Prezi (favourites, typeset buttons, Ctrl+M/H/L, line breaking per formula).
- Paragraph settings (first line / hanging indent), line spacing with own value, letter spacing, all caps.
- Template editor in the right panel (collapsible sections, text styles for normal text and headings).
- Page list with live miniatures in the left panel.

## 0.6.1
- Header and footer are edited on the page (double-click), formatted with the ribbon; tab stops centre/right.
- Tabulators (Tab key, own tab stops left/centre/right per paragraph; default every 1.25 cm).
- Margin-to-margin line above / below a paragraph.
- Paragraph styles Normál, Főcím, Cím, Alcím with font, size, colour, B/I/U, shading, alignment, line and letter
  spacing, indents and spacing; default list symbol and numbering. Formulas take the style's font and weight.
- Paper sizes A4, A5, A6, A3 and custom; ready-made templates menu (Üres; Feladatsor, Kiadvány, Pré coming);
  collapsible page panel.

## 0.6.1
- Header/footer: three columns (equal sides, adjustable middle), opened from the template panel, own font,
  lines across the whole box, gutter applied.
- Tabulators in their own popover, with dotted / line fill; right tab at the right margin never wraps.
- Formatting marks (eye button), Matekos infinity bullet, document colours in every colour picker.
- Ready-made templates in a red box at the top of the template panel; the Sablon button opens/closes the panel.
