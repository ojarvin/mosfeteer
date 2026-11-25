# Vendored math font

`latinmodern-math.woff2` is Latin Modern Math (GUST e-foundry), the OpenType
successor of Knuth's Computer Modern and the font LaTeX's `unicode-math`
loads by default. It carries an OpenType `MATH` table, which is what lets
Chromium's MathML lay equations out with real TeX metrics.

- Upstream: <https://ctan.org/pkg/lm-math> (`opentype/latinmodern-math.otf`)
- Converted with `woff2_compress` from the upstream OTF; nothing else changed.
- License: GUST Font License (LPPL 1.3c) — see `GUST-FONT-LICENSE.txt`.

Shipping it is what makes the editor's equations look like LaTeX on every
machine: no system has this font installed by default, and the CSS fallbacks
(Liberation Serif here) are Times clones with no math metrics.

## Report text faces

`lmroman10-regular`, `-italic`, `-bold`, and `-bolditalic.woff2` are Latin
Modern Roman 10 (GUST e-foundry), the text face of LaTeX documents, which
a report is set in (`core/report.js`; the editor embeds them in the report,
`web/drawing-export.js` `embeddedReportFontFaces`).

- Upstream: <https://ctan.org/pkg/lm> (`fonts/opentype/public/lm/lmroman10-*.otf`)
- Converted with `woff2_compress` from the upstream OTFs; nothing else changed.
- License: GUST Font License, as above.
