import './styles.css';
import './doksi.css';
import { Editor, generateHTML } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, Color, FontSize, FontFamily } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { ListItem } from '@tiptap/extension-list';
import { NodeSelection, TextSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { undoDepth, redoDepth, closeHistory } from '@tiptap/pm/history';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { drawShadeBands } from './shading.js';

import { loadFonts } from './fonts.js';
import { FONT_SETS, fontSet, allFamilies, familyCSS, familyFromCSS, familyLabel, registerAllFamilies, loadTextFamily } from './fontsets.js';
import { startMathJax, renderInto, opts as mathOpts, clearMathCache, mathReady } from './math.js';
import { DEFAULT_TPL, normalizeTpl, geometry, GAP, MM, variantFor } from './template.js';
import { renderSheets, sheetHTML, esc, setHfHTML, setFirstPage } from './pages.js';
import { FontOverrides } from './editor/extensions.js';
import { ParaFormat, KvBulletList, KvOrderedList, ListMarkers, KvTable, KvTableRow, KvTableCell, KvTableHeader, PageBreak, MathNode, KvImage, LineShade, tableContext, ListHang, LetterSpacing, TextCase, Pins, ActiveTable, CommentMark, ListJoin, setPinSpacers, setPinTop, setDocMathFont, lookOf, lookAtDom, marksAt, TabNode, listDefaults, ListItemAttrs, changeListLevel, HunTyping, Hyphens, hyphenKey, ListGapFit } from './editor/extensions.js';
import { layoutTabs, DEFAULT_STEP, setStyleTabs } from './tabs.js';
import { drawMarks, setCellFilter } from './marks.js';
import { spellPlugin, setSpellEnabled, suggestions, addToDictionary, ignoreWord, hideSpell, showSpell } from './spell.js';
import { Pagination } from './editor/pagination.js';
import { buildPDF } from './pdf.js';
import { isTauri, saveDocument, openDocumentFile, openPathFile, watchOpenedFiles, savePdfBlob, printPdfBlob, setCurrentPath, getCurrentPath, currentFileName, titleOfFile, renameCurrentFile, currentFileExists, autosave, loadAutosave, recoverableDrafts, takeDraft, dropDraft, shelveDraft, recentFiles, forgetRecent, pickDocx, saveTemplateFile, openTemplateFile, pickMarkdown, saveMarkdown, templateFilePath, updateTemplateFile } from './files.js';
import { importMarkdown, exportMarkdown } from './markdown.js';
import { importDocx } from './importDocx.js';
import { SAMPLE_HTML } from './sample.js';
import { svg } from './icons.js';
import { checkForUpdate, openLink } from './updates.js';
import { cleanPastedHTML } from './paste.js';
import APP_ICON from '../public/app-icon.png?inline';
import MATEKOS_BULLET from './matekos-vegtelen.png?inline';
import { openMathEditor, isMathEditorOpen, applyMathEditor } from './mathEditor.js';

const $ = s => document.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const APP_VERSION = __APP_VERSION__;
const LS_DOC = 'matekosdoksi.v2.doc', LS_TPL = 'matekosdoksi.v2.tpl';
const OLD_DOC = 'kiadvany.v2.doc', OLD_TPL = 'kiadvany.v2.tpl';   // earlier test versions
const store = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };
const lsSet = (k, v) => store(k, v);
const load = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };

let tpl = normalizeTpl(DEFAULT_TPL);
let zoomMode = 'auto', scale = 1, pageCount = 1;
let tblCtx = null;                 // table + selected cells, remembered while a table popover / size field is in use
let ovRaf = 0, imgMoving = false;  // overlay redraw state
let hfEd = null;                   // header/footer editor while it is open (the ribbon then formats it)
let keepScroll = null;
let painter = null;                 // format painter: {marks, para} waiting for the next selection
let spellOn = load('matekosdoksi.spell') !== '0';
const AE = () => hfEd || editor;
const stack = $('#stack'), outer = $('#outer'), ws = $('#ws'), pagesEl = $('#pages');

