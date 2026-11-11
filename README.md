# Matekos Doksi 0.10.6

Document editor (WYSIWYG, print-ready pages) with live inline TeX, the twin of **Matekos Prezi**. Built with
**TipTap** (text editor), **MathJax 4** (formulas), **MathLive** (visual formula editor) and **Tauri 2**
(Windows/macOS app). The formula editor, `$…$` typing, pasted TeX, tables, lists, colours and fonts are the
same code as in Matekos Prezi.

Each document uses one of 9 font sets (text font + matching MathJax 4 math font), chosen in the template
panel: TeX Gyre Bonum (default), Pagella, Termes, Schola, Latin Modern, New Computer Modern, STIX Two,
Fira Sans, DejaVu Serif – plus 16 more text families for single passages. Every font was tested for the
Hungarian letters ő ű Ő Ű (also inside formulas, `\text{…}`, bold and italic). The fonts are built into the
app and embedded in every PDF, so documents look identical on every computer and on paper.

## Installers without a terminal

See **HOW-TO-MAKE-INSTALLERS.md**: GitHub builds the Windows setup wizard and the Mac .dmg for you.

## Build the desktop app yourself

You build on the system you are targeting (Windows installer on Windows, Mac app on a Mac).
One-time setup: Node.js LTS, Rust (`rustup`), and on Windows the "Microsoft C++ Build Tools"
(Desktop development with C++); on macOS `xcode-select --install`.

```
npm install
npm run tauri build
```

The installer ends up in `src-tauri/target/release/bundle/`. Development with hot reload: `npm run tauri dev`.

## Features

* Pages exactly as printed: paper size (A4, A5, A6, A3, custom), margins, gutter, mirrored margins, real line-by-line
  page breaks (keep with next, no widows / orphans), page miniatures in the left panel, zoom.
* Text: bold / italic / underline / strike, super- and subscript, capitals, letter spacing, colour, highlight,
  line shading (margin to margin), lines above / below paragraphs, alignment, indents, first-line and hanging
  indents, line spacing, space before / after, tabulators (left, centre, right; dotted or line fill; a right tab
  whose text does not fit moves to the next line at its stop), format painter, find and replace.
* Formulas: `$…$` becomes a formula when the closing `$` is typed; pasted `$…$`, `$$…$$`, `\(…\)`, `\[…\]` become
  formulas automatically; visual formula editor (MathLive) with favourites; Hungarian notation (tg, ctg, decimal
  comma); formulas take the font, size, weight and colour of the text around them.
* Lists: bullets (any symbol, a picture or the Matekos infinity sign), numbering (1. 1) a) A. i. I.), start numbers,
  nesting by Tab / Shift+Tab that moves exactly the selected items, inner lists on the same line (1. a) …).
* Tables: insert / delete rows and columns (new ones take the look of their neighbours), merge cells, fill,
  borders (also invisible – shown dashed while working in the table), widths, heights, cell margins, alignment;
  "Két hasáb": a borderless two-column layout (selected text is divided into it). Tables can also be placed freely
  on the page (move handle), with the text wrapping around them.
* Pictures: in the line, on their own line, or with text wrapping / over / behind the text; wrapped pictures move
  freely once selected, stay inside the margins and move with their paragraph (as in Word); resizing from any corner;
  picture row under the ribbon: crop, original picture, opacity, corner rounding, placement, replace, delete.
* Templates (right panel; changes stay in the document, a template file is only changed by „Sablonfájl frissítése”): page, header and footer (edited on the page, three columns, fields for page number,
  page count, date, title; first page number; odd / even / first page; own header texts for page ranges), watermark, paragraph styles (Normál, Főcím,
  Cím, Alcím: font, size, colour, B/I/U, shading, alignment, spacing, indents, letter spacing, tabulators, keep with
  next, no space between same-style paragraphs), default list symbols. Built-in templates Sima and Feladatsor
  (`public/presets/*.mdsab`); any template can be saved as a **Matekos Doksi Sablon** (.mdsab) and used in other
  documents.
* The app's own right-click menu (text, formulas, pictures, tables, lists); word count and statistics at the bottom
  of the left panel.
* Comments: on text, pictures or table cells; purple marks on the page (never printed); reply, resolve, delete;
  listed in document order; saved in the document.
* Eye mode: spaces, paragraph ends, line breaks, tabs (with their stop), indents, space before / after, hidden
  table borders and differences from the paragraph styles, drawn in green over the text.
* Spell checking: Hunspell with the Hungarian Magyar Ispell dictionary, built in (works the same on every computer).
* Import: Word (.docx – text, formatting, lists, tables, MathType and Word equations as TeX), Markdown (.md).
  Export: exact PDF (text stays text, formulas as vectors), printing, Markdown.
* Saving: "Mentés" writes the document's own `.mdoksi` file (asks only the first time), "Mentés másként" writes a new
  file; autosave keeps your work if the app closes unexpectedly. Light and dark mode.

## Changes

* 0.10.2 – safety (as in Matekos Prezi): every window keeps its own automatic draft, pictures are stored once (not
  with every change); unsaved documents of windows that are no longer running can be restored from the home screen;
  new / open / import and a double-clicked file never discard unsaved work silently; saving writes a temporary file
  first and then swaps it in; the home screen lists the recently used documents; a "new version" notice at start-up
  (`src/updates.js`, `update.json`); automated tests (`npm test`).

* 0.10.3 – checking and editing (as in Matekos Prezi):
  * comments: the reviewer's name and icon (typed once, kept by the app), open / all filter, stepping to the next /
    previous open comment, the number of open comments on the page miniatures;
  * pasted text arrives without the look of its source – paragraphs, headings, lists (also Word's), tables, bold,
    italic, underline, super- / subscript and links stay (`src/paste.js`);
  * list symbols take the size and colour their item's text starts with; only `- ` starts a list while typing;
    `"` becomes „ or ”, `--` becomes – (not inside a `$…` formula; Backspace undoes the correction);
  * find: also across formatting changes inside a paragraph, and in the TeX code of formulas (search only);
  * zoom with Ctrl/⌘ + wheel, a touchpad pinch and Ctrl/⌘ + plus / minus / 0;
  * formula editor: the "Egyéb" tab holds Space, Nagy space, Óriás space and the frame (`\boxed`).

* 0.10.4 – picture captions: a text above and / or below a picture ("Felirat…" in the picture row), centred to the
  picture and moving with it (also with freely placed pictures: the text keeps clear of the captions); their look
  (size, colour, italic, bold) is part of the template: Szövegstílusok → Képfelirat. Stored on the picture
  (`capTop`, `capBot`).

* 0.10.5 – undo / redo also cover the template (page, margins, styles, header and footer, template files), in the
  order the changes were made; page miniatures are drawn again only for the pages that changed (and each takes only
  its own line shading); the left panel can list the document's headings with their page ("Címsorok") – a click
  goes there.

* 0.10.6:
  * table of contents (ribbon, next to the page break): written from the headings (Főcím, Cím, Alcím) as ordinary
    paragraphs – text, dotted right tab, page number; the same button refreshes it, and it is refreshed before a
    PDF / printing;
  * automatic hyphenation (template → Szövegstílusok → "Automatikus elválasztás", off by default): Hungarian rules
    (the TeX patterns `hyph-hu`, through the `hyphen` package – loaded only when switched on). The text is not
    changed: the words at the start of a line get invisible break points as decorations, so the result is the same
    on Windows, on the Mac and in the PDF.

## File format

`.mdoksi` is JSON: `{ app: 'matekos-doksi', v: 2, title, tpl, doc, colors, comments, customTpl }` – `doc` is the
TipTap document, `tpl` the template. `.mdsab` (Matekos Doksi Sablon) is JSON with the template only.

## Project layout

* `src/main.js` – the app (interface, panels, files, overlays, comments, free pictures / tables)
* `src/editor/extensions.js` – TipTap extensions (paragraph formatting, lists, tables, formulas, pictures, tabs…)
* `src/editor/pagination.js` – line-by-line page breaks
* `src/pages.js`, `src/template.js` – page sheets, headers / footers, template defaults
* `src/pdf.js` – exact PDF export; `src/marks.js` – eye mode; `src/shading.js` – line shading
* `src/importDocx.js`, `src/mtef.js` – Word / MathType import; `src/markdown.js` – Markdown import / export
* `src/mathEditor.js` – the formula editor; `src/spell.js` – spell checking; `src/fontsets.js`, `src/fonts/` – fonts
* `public/presets/` – built-in templates; `public/spell/` – the Hungarian dictionary
* `src-tauri/` – the desktop app (Rust), installer settings, icons
