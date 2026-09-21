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
