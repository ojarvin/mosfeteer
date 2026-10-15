/**
 * A design's notes as HTML (core/notes.js holds what they mean): a small
 * Markdown subset -- headings, paragraphs, lists and task lists, quotes,
 * fenced code, tables, rules, emphasis, links -- with `$...$` and `$$...$$`
 * math as MathML (the labels' own TeX, `texToMathML`), mentions as links
 * to the part or net, and `[[design]]` as links to another design. Every
 * other character is escaped: notes never carry raw HTML into the page.
 */

import { texToMathML } from './render.js';
import { MENTION, normalizeNotes, tokenName } from './notes.js';

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

/** Label markup (`V_{out}`) as HTML: subscripts and superscripts. */
function markupHtml(text) {
  return escapeHtml(text)
    .replace(/_\{([^{}]*)\}/g, '<sub>$1</sub>')
    .replace(/\^\{([^{}]*)\}/g, '<sup>$1</sup>')
    .replace(/_([A-Za-z0-9])/g, '<sub>$1</sub>');
}

function mathHtml(tex, display) {
  try {
    const mathml = texToMathML(tex);
    return display ? mathml : mathml.replace('display="block"', 'display="inline"');
  } catch {
    return `<code class="note-math-error">${escapeHtml(tex)}</code>`;
  }
}

const SAFE_URL = /^(https?:|mailto:)/i;

/**
 * One line of inline Markdown as HTML. `context.mention(name)` says what a
 * mention resolves to (null: nothing), `context.design(name)` whether a
 * design of that name exists.
 */
function inlineHtml(text, context) {
  // Code spans and math first: nothing inside them is Markdown.
  const pieces = [];
  const hold = (html) => `\u0000${pieces.push(html) - 1}\u0000`;
  let source = String(text)
    .replace(/`([^`]+)`/g, (_, code) => hold(`<code>${escapeHtml(code)}</code>`))
    .replace(/\$\$([^$]+)\$\$/g, (_, tex) => hold(mathHtml(tex, true)))
    .replace(/(^|[^\\$])\$([^$\n]+?)\$/g, (_, before, tex) => before + hold(mathHtml(tex, false)));
  source = source.replace(/\[\[([^[\]\n|]+)\]\]/g, (_, name) => {
    const design = name.trim();
    const exists = context.design?.(design) ?? true;
    return hold(`<a href="#" class="note-design${exists ? '' : ' broken'}" data-design="${escapeHtml(design)}"${exists ? '' : ' title="No design of this name in the workspace"'}>${escapeHtml(design)}</a>`);
  });
  source = source.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (whole, label, url) => (SAFE_URL.test(url)
    ? hold(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`)
    : whole));
  source = source.replace(MENTION, (_, before, token) => {
    const name = tokenName(token);
    const target = context.mention?.(name) ?? null;
    const kind = target?.kind || 'missing';
    const title = target ? '' : ' title="Nothing of this name in the design"';
    return before + hold(`<a href="#" class="note-mention note-mention-${kind}" data-mention="${escapeHtml(name)}"${title}>@${markupHtml(name)}</a>`);
  });
  let html = escapeHtml(source)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  html = html.replace(/\u0000(\d+)\u0000/g, (_, n) => pieces[Number(n)]);
  return html;
}

function tableCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

/** Whether `lines[i]` and the separator after it start a table. */
function tableStart(lines, i) {
  return /^\s*\|.*\|\s*$/.test(lines[i]) && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1] || '');
}

/**
 * The notes as HTML. `context` is `{ mention(name), design(name) }`
 * (both optional): what a mention resolves to, and whether a linked design
 * exists. Blocks: `#`-`###` headings, paragraphs, `-`/`*`/`1.` lists, `>`
 * quotes, fenced code, `$$` display math, `|` tables, `---` rules.
 */
export function renderNotes(source, context = {}) {
  const lines = normalizeNotes(source).split('\n');
  const out = [];
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) out.push(`<p>${paragraph.map((line) => inlineHtml(line, context)).join('<br>')}</p>`);
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { flush(); continue; }
    const fence = line.match(/^```\s*(\S*)/);
    if (fence) {
      flush();
      const body = [];
      for (i += 1; i < lines.length && !/^```/.test(lines[i]); i++) body.push(lines[i]);
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }
    if (/^\s*\$\$/.test(line)) {
      flush();
      const body = [line.replace(/^\s*\$\$/, '')];
      let closed = /\$\$\s*$/.test(body[0]) && body[0].trim() !== '';
      if (closed) body[0] = body[0].replace(/\$\$\s*$/, '');
      while (!closed && i + 1 < lines.length) {
        i += 1;
        if (/\$\$\s*$/.test(lines[i])) { body.push(lines[i].replace(/\$\$\s*$/, '')); closed = true; } else body.push(lines[i]);
      }
      out.push(`<div class="note-display-math">${mathHtml(body.join(' '), true)}</div>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flush();
      const level = Math.min(heading[1].length + 2, 6); // the window's own title is h2
      out.push(`<h${level}>${inlineHtml(heading[2], context)}</h${level}>`);
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      out.push('<hr>');
      continue;
    }
    if (tableStart(lines, i)) {
      flush();
      const head = tableCells(line);
      const rows = [];
      for (i += 2; i < lines.length && /^\s*\|/.test(lines[i]); i++) rows.push(tableCells(lines[i]));
      i -= 1;
      out.push(`<table><thead><tr>${head.map((cell) => `<th>${inlineHtml(cell, context)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${head.map((_, k) => `<td>${inlineHtml(row[k] ?? '', context)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (/^\s*>/.test(line)) {
      flush();
      const body = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) body.push(lines[i].replace(/^\s*>\s?/, ''));
      i -= 1;
      out.push(`<blockquote>${renderNotes(body.join('\n'), context)}</blockquote>`);
      continue;
    }
    const item = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (item) {
      flush();
      const ordered = /\d/.test(item[2]);
      const items = [];
      for (; i < lines.length; i++) {
        const next = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (next && /\d/.test(next[2]) === ordered) items.push(next[3]);
        else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) items[items.length - 1] += `\n${lines[i].trim()}`;
        else break;
      }
      i -= 1;
      const tag = ordered ? 'ol' : 'ul';
      const html = items.map((text) => {
        const task = text.match(/^\[([ xX])\]\s+(.*)$/s);
        const body = (task ? task[2] : text).split('\n').map((part) => inlineHtml(part, context)).join('<br>');
        return task ? `<li class="note-task${task[1] === ' ' ? '' : ' done'}"><span class="note-check" aria-hidden="true"></span>${body}</li>` : `<li>${body}</li>`;
      }).join('');
      out.push(`<${tag}>${html}</${tag}>`);
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return out.join('\n');
}
