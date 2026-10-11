#!/usr/bin/env python3
"""Checks that the math glyphs MathJax draws are the outlines of the official
TeX Gyre Bonum Math font (fonts-official/texgyrebonum-math.otf).

  pip install fonttools
  python3 tools/verify-math-font.py
"""
import re, sys, pathlib
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import DecomposingRecordingPen

root = pathlib.Path(__file__).resolve().parent.parent
f = TTFont(root / 'fonts-official' / 'texgyrebonum-math.otf')
gs, cmap = f.getGlyphSet(), f.getBestCmap()
print('Official font:', f['name'].getDebugName(4), f['name'].getDebugName(5))

def otf_numbers(glyph):
    pen = DecomposingRecordingPen(gs); gs[glyph].draw(pen)
    return [round(c) for _, pts in pen.value for p in pts for c in p]

data = (root / 'node_modules/@mathjax/mathjax-bonum-font/cjs/svg/normal.js').read_text()
same = diff = 0
for m in re.finditer(r"(0x[0-9A-F]+):\s*\[[^\]]*?p:\s*'([^']*)'", data):
    cp, path = int(m.group(1), 16), m.group(2)
    if not path or cp not in cmap: continue
    mj = [round(float(x)) for x in re.findall(r'-?\d+(?:\.\d+)?', path)]
    if mj == otf_numbers(cmap[cp]): same += 1
    else: diff += 1; print('different outline: U+%04X' % cp)
print(f'{same} glyphs identical, {diff} different')
sys.exit(1 if diff else 0)
