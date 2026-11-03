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

## 0.6.2
- Header/footer as a table (equal-height columns, middle 50 % by default), closed only with „Kész”; full-width line
  below/above again; ribbon line inside one column. Pictures settings in one row.
- Lists: changing some items starts a new list for them; start number; inner list on the same line (1. a) …).
- Formatting marks: bigger, tab and indent sizes, differences from the paragraph styles.
- Colour settings of the template panel use the palette; Sorárnyék with „Nincs” option.
- Fixes: tabs with line shading and formulas; TeX pasted with invisible characters.

## 0.6.3
- New app icon. Find and replace (Ctrl/⌘+F), Hungarian spell check on/off, Ctrl+H / Ctrl+L for superscript / subscript.
- Your own formatting wins over the paragraph style (e.g. B switches off the bold of a heading; own line shading).
- Lists: Tab at the start of an item moves it in, elsewhere it inserts a tab; hanging indent applies to all levels.
- Eye mode: hidden table borders, line breaks, right indent, tab end positions; labels in the margins.
- The header/footer editor stays open while its settings change; Enter in the name box saves a new document.

## 0.7.0 – Word import
- Fájl → Word-dokumentum importálása (.docx): text and formatting, headings, lists (also nested), tables (merged
  cells, fills, borderless tables), pictures (PNG/JPG/GIF), page breaks, paper size and margins, base font and size.
- MathType / Equation Editor 3.0 objects become TeX formulas (`src/mtef.js`, the converter of Matekos Prezi);
  Word's own equations (OMML) too (`src/importDocx.js`). Anything not converted is listed in the import report.

## 0.7.1
- Spell check of its own: Hunspell (hunspell-wasm) + Magyar Ispell 1.9 (public/spell, MPLv2 / LGPLv3+),
  right-click for suggestions, add to dictionary, ignore. Works the same on every computer.
- Find: every match highlighted, the current one scrolled into view.
- The view no longer jumps while page breaks are recalculated.
- Lists: hanging indent of the whole list with equal gaps on every level.
- Styles: keep with next (titles by default); no space between paragraphs of the same style; lists without
  spacing between items by default.

## 0.7.2
- Word import: only text with formatting, formulas and tables, in the selected template's styling; columns of
  a portrait section become a borderless table with one column per text column (landscape: one after the other).
- Lists: numbering continues after split lists; Tab on a selected formula or several items moves them in;
  Backspace removes the inner symbol of a same-line nested list.
- Paragraph popover: no space between same-style paragraphs (and list items).
- Formula selected: the size box shows the size of the text around it. Eye mode: tab labels show the stop.
- Light / dark mode in the Fájl menu (dark by default on every computer); buttons and scroll bars follow it.

## 0.7.3
- Lists: Tab / Shift+Tab / indent buttons change exactly the selected items (nested items and items after them keep
  their level, every item keeps its symbol / numbering format); deleting an inner item keeps the next one's level;
  same-line nested lists only from the ribbon button; list symbols sit on the line's baseline (fraction line at the
  number's middle).
- Word import: numbering as in Word (continues across other paragraphs), levels from list styles, no empty items or
  stray line breaks, justified text kept, columns divided properly (a list can continue in the next column).
- Table toolbar: cell margins. Paragraph settings work in all selected cells. Formula selection as high as the
  formula. Selected text cannot be dragged.

## 0.7.4
- The window's title bar follows the light / dark mode (dark from the start).
- Lists: an item's text starts where the next level's symbols stand; the first item of a list can move in / out too.
- „Két hasáb” button next to justify: a 1×2 table with invisible borders and no cell margins (also for imported columns).
- Line shading always from margin to margin (paragraph, style and line shading); simpler icon.

## 0.7.5
- Template files (.mdsab – Matekos Doksi SABlon): save every setting of the template panel (headers and footers too)
  and use one per document; switch freely between it and the ready-made templates. New documents start without one.
- Formula editor: the 0 key on a Mac with a Hungarian layout; a click always gets back into the live field.
- Watermark off by default. Eye mode: no font / size / line-spacing differences in documents without a template.

## 0.8.0
- One-line formulas wider than the column stay visible beyond the margin; tables never get a scroll bar.
- Line and paragraph spacing come on top of the room tall formulas need (never overlapping, even with 0 spacing).
- Indent buttons: 0.8 cm – where list text starts. Value boxes always show the value in effect.
- Word import: the kind of every indent is kept, with the app's own step (everything lines up).
- Table toolbar with labels and separators; Tab never adds rows; new rows / columns take the look of their
  neighbours; cursor next to formulas in cells.
- Lists: no extra line under a final list; Enter in an empty inner item moves only it out; deleting an empty item
  never moves the others; no hidden marks on holder lines. „Üres” is now „Sima”; a saved template file is used at once.

## 0.8.1
- Fix: line-breaking formulas were drawn too small (the extra room around them shrank the drawing).

## 0.8.2
- Formulas handled as in 0.7.x; a one-line formula wider than the line stays on its line and shows beyond the margin.
- Feladatsor template (public/presets/feladatsor.mdsab). „Sablonok”, „Sima”; Matekos végtelen as template symbol.
- Tabs never end at the same place. Line spacing moved into the paragraph popover; new line-button icon.
- Table toolbar labels; red cell fill. Pictures: every point clickable, moving works; list symbols keep clear of pictures.

## 0.8.3
- Pictures: press and drag moves them straight away; dragging pictures is no longer blocked (only text is).
- 10 % more room around tall formulas. Bigger line-spacing buttons (no 3.0), text clear of the selection marker. Format painter next to the font selector.
- „Két hasáb” with text selected: the text goes into the two columns, divided evenly (list items too), formatting kept.
- Capitals and letter spacing buttons left of the text colour.

## 0.8.4
- Pictures: a move always ends where the mouse is released (the system's drag & drop can no longer take over;
  in the desktop app HTML drag & drop is handled by the page – `dragDropEnabled: false`).
- Line shading and line buttons next to the tab button. Formula editor preview in the real font of the text.
- Format painter also copies the list symbol / numbering format.

## 0.8.5
- Pictures with text wrapping: dropped exactly where they are released (the line is found with the picture
  taken out of the layout, so it no longer anchors to its own old place).

## 0.8.6
- Pictures with text wrapping move freely on their own layer, only kept inside the page margins, and are placed
  exactly where they are released (measured and corrected after placing); the text then wraps around them.

## 0.8.7
- Pictures with text wrapping and „Szabad elhelyezés” tables are pinned to a place on their page (own layer,
  independent of the text, kept inside the margins); the text wraps around them through invisible floats.
  Pictures wrapped the older way are converted automatically.
- Tables: invisible borders shown dashed while the cursor is in the table.

## 0.8.8
- Pictures: one „Körbefuttatás” button (the text goes on the side with more room) and a new „Szöveg fölött” mode
  (free, the text does not make way).
- Free tables: selection frame with the move handle at the top centre, own width (60 % unless set), horizontal
  moving, text wraps beside them; table alignment is switched off in this mode.

## 0.8.9
- Free pictures / tables at the top of a page: the text wraps there too (the invisible float comes after the page break).
- The wrapping is worked out again whenever the layout changes (fonts and formulas drawn later), not only on edits.
- Red selection frames for pictures and free tables, red dashed invisible table lines; the table's move handle above the
  column selectors. Pictures resize from the dragged corner (the opposite corner stays) and never past the page margins.

## 0.9.0
- Pictures: „Szöveg mögött” mode (Ctrl/⌘ + click selects such a picture).
- Wrapping: objects lying on each other count as one (one margin); only the lines beside an object make room, and the
  paragraph indents do not count there; list symbols keep clear of the object.
- Arrow keys step over a free table. A list item with all-bold text gets a bold number / symbol.

## 0.9.1
- Comments: „Megjegyzések” button and panel; comments on selected text, a picture or table cells; purple marks on their
  own layer (never printed / exported); listed in document order; reply, delete, resolved (greyed); saved in the .mdoksi.
- Page miniatures: free pictures / tables at their real place; working marks (spelling, find, selection) left out.

## 0.9.2
- Comments: the add box stays at the top of the panel; the selected text stays marked while the comment is typed;
  only the chosen comment is purple in the panel; tick for "resolved"; marks as high as tall formulas; icon-only button;
  eye button: hide the marks on the page while the panel is closed.

## 0.9.3
- Comment marks: one band per place (also over formulas and where several comments overlap), as high as the formula;
  several comments per text, picture or cell (pictures / cells keep the ids space-separated in `cmt`); deleting a comment
  also removes its mark from formulas; aligned panel header and card buttons.

### The comment feature in short (for porting to Matekos Prezi)
- `src/editor/extensions.js`: `CommentMark` (mark `comment`, attribute `id`, `excludes: ''` so comments may overlap);
  pictures (`image.attrs.cmt`) and table cells (`cellAttrs.cmt`) carry the id as an attribute.
- `src/main.js`, section "Comments": `docComments` ([{id, text, at, done, replies}]) saved in the file (`comments`),
  `renderComments()` (cards in document order), `drawComments()` (purple marks on `#cmtLayer` behind the text and
  `#cmtTop` over pictures / cells – never in the PDF), `addComment()`, `removeCommentAnchors()`, `panelVisible(v, 'cmt')`.
- `index.html`: `#bCmt` button, `#cmtView` in the right panel, `#cmtLayer` / `#cmtTop` in the page stack.
- `src/doksi.css`: "comments" sections.

## 0.9.4
- Line shading: hidden holder lines of lists no longer break a shaded band (no white stripe).
- A right tab stop at the right margin ends exactly where justified text ends.
- Moving a free picture never scrolls the view to its place in the text.
- Wrapping: every paragraph beside an object gets its own float; the outermost paragraph starts at the object's margin,
  the others keep only the difference of their indents; first-line / hanging indents are dropped there; a list symbol on
  a line beside the object keeps its room.
