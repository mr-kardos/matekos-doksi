// Matekos Doksi – the editor.
//
// Its code is in the folder  src/main/ , one file per topic. When the app is built (and in "npm run dev"),
// vite.config.js joins the files listed below, in this order, into this one module – so they share one scope and
// behave exactly as one long file would. Rules that follow from this:
//   * every `import` is in 01-setup.js; paths in them are relative to src/ (this file's folder);
//   * a name declared at the top level of one part is visible in all the others (no export / import between them);
//   * a new part must be added to this list (tests/code.test.mjs checks that no file is forgotten).
//
//@part main/01-setup.js                   imports, shared state, small helpers
//@part main/02-editor.js                  the text editor and its extensions
//@part main/03-layout.js                  sheets, page breaks, free pictures and their text wrap, zoom
//@part main/04-overlays.js                picture frame, table selectors
//@part main/05-toolbar.js                 the ribbon and its commands
//@part main/06-word-count.js              word count and statistics
//@part main/07-menu-and-commands.js       right-click menu, paragraph settings, tabs, find, links, captions
//@part main/08-pictures.js                pictures
//@part main/09-header-footer.js           header and footer editing
//@part main/10-formula-editor.js          formula editor and live preview
//@part main/11-side-panels.js             page list, headings, template panel
//@part main/12-comments-and-more.js       comments, Lektor mód, hyphenation, table of contents, template undo
//@part main/13-documents.js               new / open / save / import / export, home screen, updates
//@part main/14-start.js                   start-up
