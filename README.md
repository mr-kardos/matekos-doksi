# Matekos Doksi 0.9.7

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
  freely once selected, stay inside the margins and move with their paragraph (as in Word); resizing from any corner.
* Templates (right panel): page, header and footer (edited on the page, three columns, fields for page number,
  page count, date, title; first page number; odd / even / first page), watermark, paragraph styles (Normál, Főcím,
  Cím, Alcím: font, size, colour, B/I/U, shading, alignment, spacing, indents, letter spacing, tabulators, keep with
  next, no space between same-style paragraphs), default list symbols. Built-in templates Sima and Feladatsor
  (`public/presets/*.mdsab`); any template can be saved as a **Matekos Doksi Sablon** (.mdsab) and used in other
  documents.
* Comments: on text, pictures or table cells; purple marks on the page (never printed); reply, resolve, delete;
  listed in document order; saved in the document.
* Eye mode: spaces, paragraph ends, line breaks, tabs (with their stop), indents, space before / after, hidden
  table borders and differences from the paragraph styles, drawn in green over the text.
* Spell checking: Hunspell with the Hungarian Magyar Ispell dictionary, built in (works the same on every computer).
* Import: Word (.docx – text, formatting, lists, tables, MathType and Word equations as TeX), Markdown (.md).
  Export: exact PDF (text stays text, formulas as vectors), printing, Markdown.
* Saving: "Mentés" writes the document's own `.mdoksi` file (asks only the first time), "Mentés másként" writes a new
  file; autosave keeps your work if the app closes unexpectedly. Light and dark mode.

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
